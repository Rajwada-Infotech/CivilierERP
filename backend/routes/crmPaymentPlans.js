const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// Shared by POST / and PUT /:id. `items` here is everything AFTER Booking
// (Booking itself is item #0 on the frontend and is never part of this
// array's %-pool — see CrmPaymentPlans.tsx). Returns an error string, or
// null if the items are valid.
function validateItems(items) {
  if (!items.length) return "At least one milestone item is required";
  const totalPct = items.reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);
  if (Math.round(totalPct * 100) !== 10000) return `Milestone percentages must sum to 100 (currently ${totalPct})`;
  // Guard against the same master milestone (e.g. "Foundation") being picked
  // more than once across rows in the same plan — the Source dropdown is
  // meant to offer each milestone at most once per plan.
  const seenMasterIds = new Set();
  for (const it of items) {
    const mmid = it.MilestoneMasterId ? parseInt(it.MilestoneMasterId) : null;
    if (mmid == null) continue;
    if (seenMasterIds.has(mmid)) return `"${it.MilestoneName}" is selected more than once — each milestone can only appear once per plan`;
    seenMasterIds.add(mmid);
  }
  return null;
}

// A plan can be tagged to 1+ Projects (dbo.CrmPaymentPlanProject,
// many-to-many, optional — an untagged plan just never appears in a
// Project/Block-filtered dropdown but is still offered as part of the
// final "all active plans" fallback everywhere). This is the TOP tier of
// the Project -> Block -> Unit cascade Unit Master's own tags
// (dbo.CrmUnitPaymentPlan) and the new Block tags
// (dbo.CrmBlockPaymentPlan) sit below — see
// crmEntityCreation.js's getApplicablePaymentPlans/resolveApplicationPaymentPlan
// for the single place that walks the whole cascade.
const PLAN_SELECT = `
  SELECT p.Id, p.PlanName, p.Description, p.BookingAmount, p.IsActive, p.CreatedAt,
         (SELECT COUNT(*) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS ItemCount,
         (SELECT SUM([Percent]) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS TotalPercent,
         (SELECT i.MilestoneName AS name, i.[Percent] AS pct
          FROM dbo.CrmPaymentPlanTemplateItem i
          WHERE i.PlanTemplateId = p.Id
          ORDER BY i.MilestoneNo
          FOR JSON PATH) AS MilestonesJson,
         proj.ProjectIds, proj.ProjectNames
  FROM dbo.CrmPaymentPlanTemplate p
  OUTER APPLY (
    SELECT STRING_AGG(CAST(cpp.ProjectId AS VARCHAR(20)), ',') AS ProjectIds,
           STRING_AGG(e.name, ', ') AS ProjectNames
    FROM dbo.CrmPaymentPlanProject cpp
    JOIN dbo.enterprise e ON e.id = cpp.ProjectId AND e.business_type = 'P'
    WHERE cpp.PlanId = p.Id AND cpp.IsActive = 1
  ) proj
`;

// Same deactivate-then-MERGE pattern as unitMaster.js's own
// syncUnitPaymentPlanTags, one tier up the hierarchy.
async function syncPaymentPlanProjectTags(pool, planId, projectIds) {
  await pool.request().input("pid", sql.Int, planId)
    .query("UPDATE dbo.CrmPaymentPlanProject SET IsActive = 0 WHERE PlanId = @pid");
  for (const projectId of projectIds) {
    if (!Number.isFinite(projectId)) continue;
    await pool.request()
      .input("pid", sql.Int, planId)
      .input("proj", sql.Int, projectId)
      .query(`
        MERGE dbo.CrmPaymentPlanProject AS tgt
        USING (SELECT @pid AS PlanId, @proj AS ProjectId) AS src
        ON tgt.PlanId = src.PlanId AND tgt.ProjectId = src.ProjectId
        WHEN MATCHED THEN UPDATE SET IsActive = 1
        WHEN NOT MATCHED THEN INSERT (PlanId, ProjectId, IsActive, CreatedAt) VALUES (src.PlanId, src.ProjectId, 1, SYSDATETIME());
      `);
  }
}

// GET / — every plan. ?isActive=1 filters to active-only (used by Unit
// Master's tag picker and the Application wizard's dropdown); the plan
// management page itself omits the param so it can still see/reactivate
// inactive plans.
router.get("/", requirePageRight("crm-payment-plans", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = req.query.isActive != null ? "WHERE p.IsActive = 1" : "";
    const result = await pool.request().query(`${PLAN_SELECT} ${where} ORDER BY p.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-payment-plans] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id", requirePageRight("crm-payment-plans", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [planRes, itemsRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${PLAN_SELECT} WHERE p.Id = @id`),
      pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @id ORDER BY MilestoneNo"),
    ]);
    if (!planRes.recordset[0]) return res.status(404).json({ error: "Payment plan not found" });
    res.json({ plan: planRes.recordset[0], items: itemsRes.recordset });
  } catch (e) {
    console.error("[crm-payment-plans] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create a plan template with its milestone breakdown; percentages
// must sum to 100. No scope to set anymore — every plan is available to be
// tagged onto any unit from Unit Master.
router.post("/", requirePageRight("crm-payment-plans", "create"), async (req, res) => {
  const pool = getPool();
  const tx = pool.transaction();
  try {
    const b = req.body;
    if (!b.PlanName?.trim()) return res.status(400).json({ error: "PlanName is required" });
    // Booking is a fixed ₹ amount decided at plan-creation time, not typed
    // fresh per booking and not a % of the plan (see CrmPaymentPlans.tsx).
    const bookingAmount = parseFloat(b.BookingAmount);
    if (!(bookingAmount >= 0)) return res.status(400).json({ error: "Booking Amount is required" });
    const items = Array.isArray(b.Items) ? b.Items : [];
    const itemsError = validateItems(items);
    if (itemsError) return res.status(400).json({ error: itemsError });

    await tx.begin();
    const planResult = await tx.request()
      .input("name", sql.NVarChar(200), b.PlanName.trim())
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("bamt", sql.Decimal(18,2), bookingAmount)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentPlanTemplate (PlanName, Description, BookingAmount, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@name, @desc, @bamt, 1, @cb, SYSDATETIME())
      `);
    const planId = planResult.recordset[0].Id;

    for (let idx = 0; idx < items.length; idx++) {
      await tx.request()
        .input("pid",  sql.Int,           planId)
        .input("mno",  sql.Int,           idx + 1)
        .input("mname",sql.NVarChar(200), items[idx].MilestoneName)
        .input("mmid", sql.Int,           items[idx].MilestoneMasterId ? parseInt(items[idx].MilestoneMasterId) : null)
        .input("pct",  sql.Decimal(5,2),  parseFloat(items[idx].Percent))
        .query(`
          INSERT INTO dbo.CrmPaymentPlanTemplateItem (PlanTemplateId, MilestoneNo, MilestoneName, MilestoneMasterId, [Percent])
          VALUES (@pid, @mno, @mname, @mmid, @pct)
        `);
    }

    await tx.commit();

    const projectIds = Array.isArray(b.ProjectIds) ? b.ProjectIds.map((x) => parseInt(x, 10)) : [];
    if (projectIds.length) await syncPaymentPlanProjectTags(pool, planId, projectIds);

    res.status(201).json({ success: true, id: planId });
  } catch (e) {
    await tx.rollback();
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A plan with this name already exists" });
    }
    console.error("[crm-payment-plans] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — updates Name/Description/IsActive. If an `Items` array is also
// supplied, replaces the milestone breakdown entirely (same sum-to-100
// validation as create). This only corrects the TEMPLATE — any booking that
// already generated its CrmPaymentMilestone schedule from this plan keeps
// its existing (already-materialized) schedule untouched; only bookings
// created after this edit pick up the new split.
router.put("/:id", requirePageRight("crm-payment-plans", "edit"), async (req, res) => {
  const pool = getPool();
  const id = parseInt(req.params.id);
  const b = req.body;
  const items = Array.isArray(b.Items) ? b.Items : null;
  if (items) {
    const itemsError = validateItems(items);
    if (itemsError) return res.status(400).json({ error: itemsError });
  }
  // Only touch BookingAmount if the caller actually sent one — PUT is also
  // used for lightweight Name/Description/IsActive edits that don't resend
  // the whole form.
  const bookingAmountProvided = b.BookingAmount != null && b.BookingAmount !== "";
  const bookingAmount = bookingAmountProvided ? parseFloat(b.BookingAmount) : null;
  if (bookingAmountProvided && !(bookingAmount >= 0)) return res.status(400).json({ error: "Booking Amount must be a valid non-negative number" });

  const tx = pool.transaction();
  try {
    await tx.begin();
    await tx.request()
      .input("id",   sql.Int,  id)
      .input("name", sql.NVarChar(200), b.PlanName?.trim() || null)
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("bamt", sql.Decimal(18,2), bookingAmount)
      .input("bamtProvided", sql.Bit, bookingAmountProvided ? 1 : 0)
      .input("active", sql.Bit, b.IsActive !== false ? 1 : 0)
      .query(`
        UPDATE dbo.CrmPaymentPlanTemplate SET
          PlanName = ISNULL(@name, PlanName),
          Description = @desc,
          BookingAmount = CASE WHEN @bamtProvided = 1 THEN @bamt ELSE BookingAmount END,
          IsActive = @active
        WHERE Id = @id
      `);

    if (items) {
      await tx.request().input("id", sql.Int, id)
        .query("DELETE FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @id");
      for (let idx = 0; idx < items.length; idx++) {
        await tx.request()
          .input("pid",  sql.Int,           id)
          .input("mno",  sql.Int,           idx + 1)
          .input("mname",sql.NVarChar(200), items[idx].MilestoneName)
          .input("mmid", sql.Int,           items[idx].MilestoneMasterId ? parseInt(items[idx].MilestoneMasterId) : null)
          .input("pct",  sql.Decimal(5,2),  parseFloat(items[idx].Percent))
          .query(`
            INSERT INTO dbo.CrmPaymentPlanTemplateItem (PlanTemplateId, MilestoneNo, MilestoneName, MilestoneMasterId, [Percent])
            VALUES (@pid, @mno, @mname, @mmid, @pct)
          `);
      }
    }

    await tx.commit();

    // Only touches Project tags if the caller actually sent the array — same
    // "don't clobber on a partial edit" reasoning as BookingAmount above.
    if (Array.isArray(b.ProjectIds)) {
      const projectIds = b.ProjectIds.map((x) => parseInt(x, 10));
      await syncPaymentPlanProjectTags(pool, id, projectIds);
    }

    const usage = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmBooking WHERE PaymentPlanId = @id AND IsActive = 1");
    res.json({ success: true, bookingsUsingPlan: usage.recordset[0].Cnt });
  } catch (e) {
    await tx.rollback();
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A plan with this name already exists" });
    }
    console.error("[crm-payment-plans] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;