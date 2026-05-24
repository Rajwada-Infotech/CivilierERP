// routes/paymentPlanMaster.js
const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const { getPool, sql } = require("../db");

bumpCacheVersion("payment-plan-master").catch(() => {});

// ── GET all plans (header rows only) ─────────────────────────────────────────
router.get("/", cache("payment-plan-master", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        p.Id,
        p.PlanName,
        p.IsActive,
        p.CreatedAt,
        p.UpdatedAt,
        (
          SELECT COUNT(*)
          FROM dbo.PaymentPlanMilestone m
          WHERE m.PlanId = p.Id
        ) AS MilestoneCount,
        (
          SELECT SUM(CASE WHEN ValueType = 'P' THEN Value ELSE 0 END)
          FROM dbo.PaymentPlanMilestone m
          WHERE m.PlanId = p.Id
        ) AS TotalPercentage
      FROM dbo.PaymentPlanMaster p
      ORDER BY p.PlanName
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[payment-plan-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET single plan with milestones ─────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const planRes = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(
        "SELECT Id, PlanName, IsActive FROM dbo.PaymentPlanMaster WHERE Id = @Id",
      );

    if (!planRes.recordset.length)
      return res.status(404).json({ error: "Plan not found" });

    const milestonesRes = await pool.request().input("PlanId", sql.Int, id)
      .query(`
        SELECT Id, MilestoneNo, PaymentTerm, ValueType, Value
        FROM dbo.PaymentPlanMilestone
        WHERE PlanId = @PlanId
        ORDER BY MilestoneNo
      `);

    res.json({
      ...planRes.recordset[0],
      milestones: milestonesRes.recordset,
    });
  } catch (err) {
    console.error("[payment-plan-master] GET /:id error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST — create plan + milestones ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const { PlanName, IsActive, milestones = [] } = req.body;
  if (!PlanName?.trim())
    return res.status(400).json({ error: "PlanName is required" });

  const createdBy = req.user?.userId || null;
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    const planRes = await transaction
      .request()
      .input("PlanName", sql.NVarChar(150), PlanName.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.PaymentPlanMaster (PlanName, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@PlanName, @IsActive, @CreatedBy, @CreatedAt)
      `);

    const planId = planRes.recordset[0].Id;

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.PaymentTerm?.trim()) continue;
      await transaction
        .request()
        .input("PlanId", sql.Int, planId)
        .input("MilestoneNo", sql.Int, i + 1)
        .input("PaymentTerm", sql.NVarChar(200), m.PaymentTerm.trim())
        .input("ValueType", sql.Char(1), m.ValueType === "A" ? "A" : "P")
        .input("Value", sql.Decimal(18, 4), parseFloat(m.Value) || 0)
        .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
          INSERT INTO dbo.PaymentPlanMilestone (PlanId, MilestoneNo, PaymentTerm, ValueType, Value, CreatedAt)
          VALUES (@PlanId, @MilestoneNo, @PaymentTerm, @ValueType, @Value, @CreatedAt)
        `);
    }

    await transaction.commit();
    await bumpCacheVersion("payment-plan-master");
    res.json({ message: "Payment plan created", id: planId });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("[payment-plan-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT — update plan + replace milestones ───────────────────────────────────
router.put("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  const { PlanName, IsActive, milestones = [] } = req.body;
  if (!PlanName?.trim())
    return res.status(400).json({ error: "PlanName is required" });

  const updatedBy = req.user?.userId || null;
  const pool = getPool();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    await transaction
      .request()
      .input("Id", sql.Int, id)
      .input("PlanName", sql.NVarChar(150), PlanName.trim())
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.PaymentPlanMaster
        SET PlanName = @PlanName, IsActive = @IsActive,
            UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);

    // Replace all milestones
    await transaction
      .request()
      .input("PlanId", sql.Int, id)
      .query("DELETE FROM dbo.PaymentPlanMilestone WHERE PlanId = @PlanId");

    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (!m.PaymentTerm?.trim()) continue;
      await transaction
        .request()
        .input("PlanId", sql.Int, id)
        .input("MilestoneNo", sql.Int, i + 1)
        .input("PaymentTerm", sql.NVarChar(200), m.PaymentTerm.trim())
        .input("ValueType", sql.Char(1), m.ValueType === "A" ? "A" : "P")
        .input("Value", sql.Decimal(18, 4), parseFloat(m.Value) || 0)
        .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
          INSERT INTO dbo.PaymentPlanMilestone (PlanId, MilestoneNo, PaymentTerm, ValueType, Value, CreatedAt)
          VALUES (@PlanId, @MilestoneNo, @PaymentTerm, @ValueType, @Value, @CreatedAt)
        `);
    }

    await transaction.commit();
    await bumpCacheVersion("payment-plan-master");
    res.json({ message: "Payment plan updated" });
  } catch (err) {
    await transaction.rollback().catch(() => {});
    console.error("[payment-plan-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const existing = await pool
      .request()
      .input("Id", sql.Int, id)
      .query("SELECT PlanName FROM dbo.PaymentPlanMaster WHERE Id = @Id");

    if (!existing.recordset.length)
      return res.status(404).json({ error: "Plan not found" });

    const { PlanName } = existing.recordset[0];

    // Milestones cascade-delete via FK
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.PaymentPlanMaster WHERE Id = @Id");

    await bumpCacheVersion("payment-plan-master");
    res.json({ message: `Payment plan "${PlanName}" deleted` });
  } catch (err) {
    console.error("[payment-plan-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
