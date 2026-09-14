const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");

// ─────────────────────────────────────────────────────────────────────────────
// Payment Terms master (Finance Setup). Description + Days — used by
// Purchase Order's Payment Terms dropdown and Invoice's real-time due-date
// calculation (Vendor Invoice Date + Days). See migration
// 251-vendor-payment-term-master.sql for why this is a separate table from
// Follow-Up's dbo.PaymentTermMaster (CRM installment/milestone plans).
// ─────────────────────────────────────────────────────────────────────────────

router.get("/", cache("vendor-payment-term", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT PaymentTermId, Description, Days, IsActive,
             CreatedBy, CreatedAt, UpdatedBy, UpdatedAt
      FROM dbo.VendorPaymentTerm
      ORDER BY Days, Description
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/options", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT PaymentTermId AS id, Description AS label, Days AS days
      FROM dbo.VendorPaymentTerm
      WHERE IsActive = 1
      ORDER BY Days, Description
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("payment-terms", "create"), async (req, res) => {
  const { Description, Days, IsActive } = req.body;
  if (!Description || !String(Description).trim())
    return res.status(400).json({ error: "Description is required" });
  const days = parseInt(Days, 10);
  if (!Number.isFinite(days) || days < 0)
    return res.status(400).json({ error: "Days must be a non-negative number" });
  try {
    const pool = getPool();
    const result = await pool
      .request()
      .input("Description", sql.NVarChar(500), String(Description).trim())
      .input("Days", sql.Int, days)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        INSERT INTO dbo.VendorPaymentTerm (Description, Days, IsActive, CreatedBy, CreatedAt)
        OUTPUT INSERTED.PaymentTermId
        VALUES (@Description, @Days, @IsActive, @CreatedBy, SYSDATETIME())
      `);
    await bumpCacheVersion("vendor-payment-term");
    res.json({ message: "Payment term added", id: result.recordset[0].PaymentTermId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("payment-terms", "edit"), async (req, res) => {
  const { Description, Days, IsActive } = req.body;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  if (!Description || !String(Description).trim())
    return res.status(400).json({ error: "Description is required" });
  const days = parseInt(Days, 10);
  if (!Number.isFinite(days) || days < 0)
    return res.status(400).json({ error: "Days must be a non-negative number" });
  try {
    const pool = getPool();
    await pool
      .request()
      .input("PaymentTermId", sql.Int, id)
      .input("Description", sql.NVarChar(500), String(Description).trim())
      .input("Days", sql.Int, days)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.NVarChar(150), req.user?.name || req.user?.email || null)
      .query(`
        UPDATE dbo.VendorPaymentTerm
        SET Description = @Description, Days = @Days, IsActive = @IsActive,
            UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE PaymentTermId = @PaymentTermId
      `);
    await bumpCacheVersion("vendor-payment-term");
    res.json({ message: "Payment term updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requirePageRight("payment-terms", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const pool = getPool();
    const delResult = await pool
      .request()
      .input("PaymentTermId", sql.Int, id)
      .query("DELETE FROM dbo.VendorPaymentTerm WHERE PaymentTermId = @PaymentTermId");
    if (delResult.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Payment term not found" });
    await bumpCacheVersion("vendor-payment-term");
    res.json({ message: "Payment term deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
