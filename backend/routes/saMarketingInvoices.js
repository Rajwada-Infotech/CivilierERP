const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool, sql } = require("../db");

bumpCacheVersion("sa-marketing-invoices").catch(() => {});

// GET all invoices
router.get("/", cache("sa-marketing-invoices", 300), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        i.Id, i.InvoiceNumber, i.VendorName,
        i.CampaignId, c.Name AS CampaignName, c.CampaignCode,
        i.AdId, a.Name AS AdName,
        i.InvoiceDate, i.Amount, i.GstAmount, i.TotalAmount,
        i.DueDate, i.PaymentStatus, i.Notes, i.IsActive,
        i.CreatedAt, i.UpdatedAt
      FROM dbo.SaMarketingInvoice i
      LEFT JOIN dbo.SaCampaign c ON c.Id = i.CampaignId
      LEFT JOIN dbo.SaAd a ON a.Id = i.AdId
      ORDER BY i.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-marketing-invoices] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST
router.post("/", requirePageRight("sa-marketing-invoices", "create"), async (req, res) => {
  const { InvoiceNumber, VendorName, CampaignId, AdId, InvoiceDate, Amount, GstAmount, DueDate, PaymentStatus, Notes, IsActive } = req.body;
  const createdBy = req.user?.userId || null;
  if (!InvoiceNumber || !String(InvoiceNumber).trim())
    return res.status(400).json({ error: "Invoice Number is required" });
  try {
    const pool = getPool();
    await pool.request()
      .input("InvoiceNumber", sql.NVarChar(50), InvoiceNumber)
      .input("VendorName", sql.NVarChar(200), VendorName || null)
      .input("CampaignId", sql.Int, CampaignId || null)
      .input("AdId", sql.Int, AdId || null)
      .input("InvoiceDate", sql.Date, InvoiceDate || null)
      .input("Amount", sql.Decimal(18, 2), Amount || 0)
      .input("GstAmount", sql.Decimal(18, 2), GstAmount || 0)
      .input("DueDate", sql.Date, DueDate || null)
      .input("PaymentStatus", sql.NVarChar(20), PaymentStatus || "Pending")
      .input("Notes", sql.NVarChar(sql.MAX), Notes || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("CreatedBy", sql.Int, createdBy)
      .input("CreatedAt", sql.DateTime2(3), new Date()).query(`
        INSERT INTO dbo.SaMarketingInvoice
          (InvoiceNumber, VendorName, CampaignId, AdId, InvoiceDate, Amount, GstAmount,
           DueDate, PaymentStatus, Notes, IsActive, CreatedBy, CreatedAt)
        VALUES
          (@InvoiceNumber, @VendorName, @CampaignId, @AdId, @InvoiceDate, @Amount, @GstAmount,
           @DueDate, @PaymentStatus, @Notes, @IsActive, @CreatedBy, @CreatedAt)
      `);
    await bumpCacheVersion("sa-marketing-invoices");
    res.json({ message: "Invoice added successfully" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "Invoice Number already exists" });
    console.error("[sa-marketing-invoices] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT
router.put("/:id", requirePageRight("sa-marketing-invoices", "edit"), async (req, res) => {
  const { id } = req.params;
  const { InvoiceNumber, VendorName, CampaignId, AdId, InvoiceDate, Amount, GstAmount, DueDate, PaymentStatus, Notes, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    await pool.request()
      .input("Id", sql.Int, parseInt(id))
      .input("InvoiceNumber", sql.NVarChar(50), InvoiceNumber)
      .input("VendorName", sql.NVarChar(200), VendorName || null)
      .input("CampaignId", sql.Int, CampaignId || null)
      .input("AdId", sql.Int, AdId || null)
      .input("InvoiceDate", sql.Date, InvoiceDate || null)
      .input("Amount", sql.Decimal(18, 2), Amount || 0)
      .input("GstAmount", sql.Decimal(18, 2), GstAmount || 0)
      .input("DueDate", sql.Date, DueDate || null)
      .input("PaymentStatus", sql.NVarChar(20), PaymentStatus || "Pending")
      .input("Notes", sql.NVarChar(sql.MAX), Notes || null)
      .input("IsActive", sql.Bit, IsActive !== false ? 1 : 0)
      .input("UpdatedBy", sql.Int, updatedBy)
      .input("UpdatedAt", sql.DateTime2(3), new Date()).query(`
        UPDATE dbo.SaMarketingInvoice SET
          InvoiceNumber = @InvoiceNumber, VendorName = @VendorName,
          CampaignId = @CampaignId, AdId = @AdId, InvoiceDate = @InvoiceDate,
          Amount = @Amount, GstAmount = @GstAmount, DueDate = @DueDate,
          PaymentStatus = @PaymentStatus, Notes = @Notes, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);
    await bumpCacheVersion("sa-marketing-invoices");
    res.json({ message: "Invoice updated successfully" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "Invoice Number already exists" });
    console.error("[sa-marketing-invoices] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", requirePageRight("sa-marketing-invoices", "delete"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0)
    return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const existing = await pool.request()
      .input("Id", sql.Int, id)
      .query("SELECT InvoiceNumber FROM dbo.SaMarketingInvoice WHERE Id = @Id");
    if (!existing.recordset.length)
      return res.status(404).json({ error: "Invoice not found" });
    const { InvoiceNumber } = existing.recordset[0];
    await pool.request()
      .input("Id", sql.Int, id)
      .query("DELETE FROM dbo.SaMarketingInvoice WHERE Id = @Id");
    await bumpCacheVersion("sa-marketing-invoices");
    res.json({ message: `Invoice "${InvoiceNumber}" deleted successfully` });
  } catch (err) {
    console.error("[sa-marketing-invoices] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;