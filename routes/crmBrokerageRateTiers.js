// Admin-editable brokerage commission tiers — replaces the old hardcoded
// "2% under 1Cr, 1% at 1Cr+" constants that used to live directly in
// tierBrokeragePercent (crmWorkflowGuards.js). That function now reads from
// dbo.CrmBrokerageRateTier instead, so an admin can change the thresholds
// or rates here without a code deploy. Only used as a FALLBACK default when
// staff don't type an explicit commission override % on the Application/
// Booking itself (BrokerageRatePercent) — an explicit override always wins.
const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

router.get("/", requirePageRight("crm-brokerage-rate-tiers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT Id, MinDealValue, MaxDealValue, RatePercent, IsActive, CreatedAt, UpdatedAt
      FROM dbo.CrmBrokerageRateTier
      ORDER BY MinDealValue
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-brokerage-rate-tiers] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-brokerage-rate-tiers", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const min = Number(b.MinDealValue);
    const max = b.MaxDealValue != null && b.MaxDealValue !== "" ? Number(b.MaxDealValue) : null;
    const rate = Number(b.RatePercent);
    if (!Number.isFinite(min) || min < 0) return res.status(400).json({ error: "Min Deal Value must be a non-negative number" });
    if (max != null && (!Number.isFinite(max) || max <= min)) return res.status(400).json({ error: "Max Deal Value must be greater than Min Deal Value (or left blank for no upper bound)" });
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) return res.status(400).json({ error: "Rate % must be between 0 and 10" });

    const result = await pool.request()
      .input("min", sql.Decimal(18,2), min)
      .input("max", sql.Decimal(18,2), max)
      .input("rate", sql.Decimal(5,2), rate)
      .input("cb", sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmBrokerageRateTier (MinDealValue, MaxDealValue, RatePercent, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@min, @max, @rate, 1, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    console.error("[crm-brokerage-rate-tiers] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-brokerage-rate-tiers", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const min = Number(b.MinDealValue);
    const max = b.MaxDealValue != null && b.MaxDealValue !== "" ? Number(b.MaxDealValue) : null;
    const rate = Number(b.RatePercent);
    if (!Number.isFinite(min) || min < 0) return res.status(400).json({ error: "Min Deal Value must be a non-negative number" });
    if (max != null && (!Number.isFinite(max) || max <= min)) return res.status(400).json({ error: "Max Deal Value must be greater than Min Deal Value (or left blank for no upper bound)" });
    if (!Number.isFinite(rate) || rate <= 0 || rate > 10) return res.status(400).json({ error: "Rate % must be between 0 and 10" });

    await pool.request()
      .input("id", sql.Int, id)
      .input("min", sql.Decimal(18,2), min)
      .input("max", sql.Decimal(18,2), max)
      .input("rate", sql.Decimal(5,2), rate)
      .input("active", sql.Bit, b.IsActive !== false ? 1 : 0)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmBrokerageRateTier SET
          MinDealValue = @min, MaxDealValue = @max, RatePercent = @rate, IsActive = @active,
          UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-brokerage-rate-tiers] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id", requirePageRight("crm-brokerage-rate-tiers", "delete"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.CrmBrokerageRateTier WHERE Id = @id");
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-brokerage-rate-tiers] DELETE error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
