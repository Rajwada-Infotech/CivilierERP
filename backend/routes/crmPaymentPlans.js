const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const PLAN_SELECT = `
  SELECT p.Id, p.PlanName, p.Description, p.IsActive, p.CreatedAt,
         p.CompanyId, p.BlockId, p.UnitId,
         comp.name AS CompanyName, blk.BlockName, um.UnitName,
         (SELECT COUNT(*) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS ItemCount,
         (SELECT SUM([Percent]) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS TotalPercent
  FROM dbo.CrmPaymentPlanTemplate p
  LEFT JOIN dbo.enterprise comp ON comp.id = p.CompanyId AND comp.business_type = 'C'
  LEFT JOIN dbo.BlockMaster blk ON blk.Id = p.BlockId
  LEFT JOIN dbo.UnitMaster um ON um.Id = p.UnitId
`;

// A plan's Project scope is many-to-many (dbo.CrmPaymentPlanProject) — a plan
// with zero linked rows applies everywhere, one with 1+ rows only applies to
// those specific projects. Attaches `Projects: [{Id, Name}]` to each plan.
async function attachProjectLinks(pool, plans) {
  if (!plans.length) return plans;
  const ids = plans.map(p => p.Id);
  const result = await pool.request().query(`
    SELECT lp.PlanId, lp.ProjectId, proj.name AS ProjectName
    FROM dbo.CrmPaymentPlanProject lp
    LEFT JOIN dbo.enterprise proj ON proj.id = lp.ProjectId AND proj.business_type = 'P'
    WHERE lp.IsActive = 1 AND lp.PlanId IN (${ids.join(",")})
  `);
  const byPlan = new Map();
  for (const row of result.recordset) {
    if (!byPlan.has(row.PlanId)) byPlan.set(row.PlanId, []);
    byPlan.get(row.PlanId).push({ Id: row.ProjectId, Name: row.ProjectName });
  }
  for (const p of plans) p.Projects = byPlan.get(p.Id) || [];
  return plans;
}

// GET / — every plan (management page), or the plans applicable to a given
// Company/Project/Block/Unit scope when those query params are supplied
// (used by the Booking page's plan picker). A plan matches a scope filter if
// its own scope column/link-set is either empty (a wildcard/default plan
// available everywhere) or an exact match — so a Project-scoped plan only
// shows for its linked projects, a Unit-specific plan only for that exact
// unit, while a global plan always shows alongside them.
router.get("/", requirePageRight("crm-payment-plans", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { companyId, projectId, blockId, unitId } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (companyId) { req0.input("cid", sql.Int, parseInt(companyId)); conds.push("(p.CompanyId IS NULL OR p.CompanyId = @cid)"); }
    if (projectId) {
      req0.input("pid", sql.Int, parseInt(projectId));
      conds.push(`(
        NOT EXISTS (SELECT 1 FROM dbo.CrmPaymentPlanProject lp WHERE lp.PlanId = p.Id AND lp.IsActive = 1)
        OR EXISTS (SELECT 1 FROM dbo.CrmPaymentPlanProject lp WHERE lp.PlanId = p.Id AND lp.IsActive = 1 AND lp.ProjectId = @pid)
      )`);
    }
    if (blockId)   { req0.input("bid", sql.Int, parseInt(blockId));   conds.push("(p.BlockId IS NULL OR p.BlockId = @bid)"); }
    if (unitId)    { req0.input("uid", sql.Int, parseInt(unitId));    conds.push("(p.UnitId IS NULL OR p.UnitId = @uid)"); }
    if (companyId || projectId || blockId || unitId) conds.push("p.IsActive = 1");
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${PLAN_SELECT} ${where} ORDER BY p.CreatedAt DESC`);
    res.json(await attachProjectLinks(pool, result.recordset));
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
    const [plan] = await attachProjectLinks(pool, [planRes.recordset[0]]);
    res.json({ plan, items: itemsRes.recordset });
  } catch (e) {
    console.error("[crm-payment-plans] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create a plan template with its milestone breakdown; percentages
// must sum to 100. Scope (Company/Project/Block) is optional at every
// level — leaving all three blank creates a global default plan available
// to any booking that doesn't have a more specific one.
router.post("/", requirePageRight("crm-payment-plans", "create"), async (req, res) => {
  const pool = getPool();
  const tx = pool.transaction();
  try {
    const b = req.body;
    if (!b.PlanName?.trim()) return res.status(400).json({ error: "PlanName is required" });
    const items = Array.isArray(b.Items) ? b.Items : [];
    if (!items.length) return res.status(400).json({ error: "At least one milestone item is required" });
    const totalPct = items.reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);
    if (Math.round(totalPct * 100) !== 10000) return res.status(400).json({ error: `Milestone percentages must sum to 100 (currently ${totalPct})` });
    const projectIds = Array.isArray(b.ProjectIds) ? b.ProjectIds.map(x => parseInt(x)).filter(Boolean)
      : (b.ProjectId ? [parseInt(b.ProjectId)] : []);

    await tx.begin();
    const planResult = await tx.request()
      .input("name", sql.NVarChar(200), b.PlanName.trim())
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("cid",  sql.Int,           b.CompanyId ? parseInt(b.CompanyId) : null)
      .input("bid",  sql.Int,           b.BlockId   ? parseInt(b.BlockId)   : null)
      .input("uid",  sql.Int,           b.UnitId    ? parseInt(b.UnitId)    : null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentPlanTemplate (PlanName, Description, CompanyId, BlockId, UnitId, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@name, @desc, @cid, @bid, @uid, 1, @cb, SYSDATETIME())
      `);
    const planId = planResult.recordset[0].Id;

    for (const pid of projectIds) {
      await tx.request()
        .input("plid", sql.Int, planId)
        .input("pid",  sql.Int, pid)
        .query(`INSERT INTO dbo.CrmPaymentPlanProject (PlanId, ProjectId, IsActive, CreatedAt) VALUES (@plid, @pid, 1, SYSDATETIME())`);
    }

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
    res.status(201).json({ success: true, id: planId });
  } catch (e) {
    await tx.rollback();
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A plan with this name already exists for this company/project/block" });
    }
    console.error("[crm-payment-plans] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — updates Description/IsActive/scope as before. If an `Items`
// array is also supplied, replaces the milestone breakdown entirely (same
// sum-to-100 validation as create). This only corrects the TEMPLATE — any
// booking that already generated its CrmPaymentMilestone schedule from this
// plan keeps its existing (already-materialized) schedule untouched; only
// bookings created after this edit pick up the new split. That mirrors the
// existing booking-level guard that blocks changing a booking's own
// PaymentPlanId once a milestone has a real payment against it — a plan
// template is a stamp, not a live binding.
router.put("/:id", requirePageRight("crm-payment-plans", "edit"), async (req, res) => {
  const pool = getPool();
  const id = parseInt(req.params.id);
  const b = req.body;
  const items = Array.isArray(b.Items) ? b.Items : null;
  if (items) {
    if (!items.length) return res.status(400).json({ error: "At least one milestone item is required" });
    const totalPct = items.reduce((s, i) => s + (parseFloat(i.Percent) || 0), 0);
    if (Math.round(totalPct * 100) !== 10000) return res.status(400).json({ error: `Milestone percentages must sum to 100 (currently ${totalPct})` });
  }

  const projectIds = Array.isArray(b.ProjectIds) ? b.ProjectIds.map(x => parseInt(x)).filter(Boolean)
    : (b.ProjectId !== undefined ? (b.ProjectId ? [parseInt(b.ProjectId)] : []) : null);

  const tx = pool.transaction();
  try {
    await tx.begin();
    await tx.request()
      .input("id",   sql.Int,  id)
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("active", sql.Bit, b.IsActive !== false ? 1 : 0)
      .input("cid",  sql.Int,  b.CompanyId ? parseInt(b.CompanyId) : null)
      .input("bid",  sql.Int,  b.BlockId   ? parseInt(b.BlockId)   : null)
      .input("uid",  sql.Int,  b.UnitId    ? parseInt(b.UnitId)    : null)
      .query(`
        UPDATE dbo.CrmPaymentPlanTemplate SET
          Description = @desc, IsActive = @active,
          CompanyId = @cid, BlockId = @bid, UnitId = @uid
        WHERE Id = @id
      `);

    if (projectIds !== null) {
      await tx.request().input("id", sql.Int, id)
        .query("UPDATE dbo.CrmPaymentPlanProject SET IsActive = 0 WHERE PlanId = @id");
      for (const pid of projectIds) {
        await tx.request()
          .input("plid", sql.Int, id)
          .input("pid",  sql.Int, pid)
          .query(`
            MERGE dbo.CrmPaymentPlanProject AS tgt
            USING (SELECT @plid AS PlanId, @pid AS ProjectId) AS src
            ON tgt.PlanId = src.PlanId AND tgt.ProjectId = src.ProjectId
            WHEN MATCHED THEN UPDATE SET IsActive = 1
            WHEN NOT MATCHED THEN INSERT (PlanId, ProjectId, IsActive, CreatedAt) VALUES (src.PlanId, src.ProjectId, 1, SYSDATETIME());
          `);
      }
    }

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

    const usage = await pool.request().input("id", sql.Int, id)
      .query("SELECT COUNT(*) AS Cnt FROM dbo.CrmBooking WHERE PaymentPlanId = @id AND IsActive = 1");
    res.json({ success: true, bookingsUsingPlan: usage.recordset[0].Cnt });
  } catch (e) {
    await tx.rollback();
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique")) {
      return res.status(409).json({ error: "A plan with this name already exists for this company/project/block" });
    }
    console.error("[crm-payment-plans] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
