const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

router.get("/", requirePageRight("crm-payment-plans", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT p.Id, p.PlanName, p.Description, p.IsActive, p.CreatedAt,
             (SELECT COUNT(*) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS ItemCount,
             (SELECT SUM([Percent]) FROM dbo.CrmPaymentPlanTemplateItem i WHERE i.PlanTemplateId = p.Id) AS TotalPercent
      FROM dbo.CrmPaymentPlanTemplate p
      ORDER BY p.CreatedAt DESC
    `);
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
      pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmPaymentPlanTemplate WHERE Id = @id"),
      pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmPaymentPlanTemplateItem WHERE PlanTemplateId = @id ORDER BY MilestoneNo"),
    ]);
    if (!planRes.recordset[0]) return res.status(404).json({ error: "Payment plan not found" });
    res.json({ plan: planRes.recordset[0], items: itemsRes.recordset });
  } catch (e) {
    console.error("[crm-payment-plans] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — create a plan template with its milestone breakdown; percentages must sum to 100
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

    await tx.begin();
    const planResult = await tx.request()
      .input("name", sql.NVarChar(200), b.PlanName.trim())
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("cb",   sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmPaymentPlanTemplate (PlanName, Description, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@name, @desc, 1, @cb, SYSDATETIME())
      `);
    const planId = planResult.recordset[0].Id;

    for (let idx = 0; idx < items.length; idx++) {
      await tx.request()
        .input("pid",  sql.Int,           planId)
        .input("mno",  sql.Int,           idx + 1)
        .input("mname",sql.NVarChar(200), items[idx].MilestoneName)
        .input("pct",  sql.Decimal(5,2),  parseFloat(items[idx].Percent))
        .query(`
          INSERT INTO dbo.CrmPaymentPlanTemplateItem (PlanTemplateId, MilestoneNo, MilestoneName, [Percent])
          VALUES (@pid, @mno, @mname, @pct)
        `);
    }

    await tx.commit();
    res.status(201).json({ success: true, id: planId });
  } catch (e) {
    await tx.rollback();
    console.error("[crm-payment-plans] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-payment-plans", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    await pool.request()
      .input("id",   sql.Int,  id)
      .input("desc", sql.NVarChar(500), b.Description || null)
      .input("active", sql.Bit, b.IsActive !== false ? 1 : 0)
      .query("UPDATE dbo.CrmPaymentPlanTemplate SET Description = @desc, IsActive = @active WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-payment-plans] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
