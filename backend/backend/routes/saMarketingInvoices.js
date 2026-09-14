const express = require("express");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { postSaMarketingInvoiceToGL } = require("../services/saLedger");
const { recordGLPosting } = require("../services/approvalService");

bumpCacheVersion("sa-marketing-invoices").catch(() => {});

async function invalidateMarketingInvoiceDependents() {
  await Promise.all([
    bumpCacheVersion("sa-marketing-invoices"),
    bumpCacheVersion("sa-ads"),
    bumpCacheVersion("sa-campaigns"),
  ]);
}

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
        i.ApprovalStatus, i.ApprovedBy, i.ApprovedAt, i.ApprovalNotes,
        approver.name AS ApproverName,
        i.CreatedAt, i.UpdatedAt
      FROM dbo.SaMarketingInvoice i
      LEFT JOIN dbo.SaCampaign c ON c.Id = i.CampaignId
      LEFT JOIN dbo.SaAd a ON a.Id = i.AdId
      LEFT JOIN dbo.Users approver ON approver.id = i.ApprovedBy
      ORDER BY i.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("[sa-marketing-invoices] GET error:", err.message);
    res.status(500).json({ error: "Internal server error" });
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
    await invalidateMarketingInvoiceDependents();
    res.json({ message: "Invoice added successfully" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "Invoice Number already exists" });
    console.error("[sa-marketing-invoices] POST error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT
router.put("/:id", requirePageRight("sa-marketing-invoices", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const { InvoiceNumber, VendorName, CampaignId, AdId, InvoiceDate, Amount, GstAmount, DueDate, PaymentStatus, Notes, IsActive } = req.body;
  const updatedBy = req.user?.userId || null;
  try {
    const pool = getPool();
    const cur = await pool.request().input("Id", sql.Int, id)
      .query("SELECT PaymentStatus FROM dbo.SaMarketingInvoice WHERE Id = @Id");
    const previousStatus = cur.recordset[0]?.PaymentStatus;

    await pool.request()
      .input("Id", sql.Int, id)
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
          Amount = @Amount, GstAmount = @GstAmount,
          DueDate = @DueDate,
          PaymentStatus = @PaymentStatus, Notes = @Notes, IsActive = @IsActive,
          UpdatedBy = @UpdatedBy, UpdatedAt = @UpdatedAt
        WHERE Id = @Id
      `);

    // "PAID -> REAL DISBURSEMENT" — same pattern as CRM/commissions: a
    // marketing invoice being marked Paid is real cash leaving the company,
    // not just a status flag. Only fires on the actual Pending->Paid edge,
    // and never blocks the update itself if GL posting fails.
    if (PaymentStatus === "Paid" && previousStatus !== "Paid") {
      const actorEmail = req.user?.name || req.user?.email || "system";
      try {
        const outcome = await postSaMarketingInvoiceToGL(pool, id, actorEmail);
        await recordGLPosting("sa-marketing-invoice", id, outcome, actorEmail);
      } catch (glErr) {
        console.error("[sa-marketing-invoices] GL posting failed:", glErr.message);
        await recordGLPosting("sa-marketing-invoice", id, { failed: true, reason: glErr.message }, actorEmail);
      }
    }

    await invalidateMarketingInvoiceDependents();
    res.json({ message: "Invoice updated successfully" });
  } catch (err) {
    if (err.number === 2627 || err.number === 2601)
      return res.status(409).json({ error: "Invoice Number already exists" });
    console.error("[sa-marketing-invoices] PUT error:", err.message);
    res.status(500).json({ error: "Internal server error" });
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
    await invalidateMarketingInvoiceDependents();
    res.json({ message: `Invoice "${InvoiceNumber}" deleted successfully` });
  } catch (err) {
    console.error("[sa-marketing-invoices] DELETE error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/approve
router.post("/:id/approve", requirePageRight("sa-marketing-invoices", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const actorId = req.user?.userId || null;
  const { ApprovalNotes } = req.body;
  try {
    const pool = getPool();
    const check = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Id, ApprovalStatus FROM dbo.SaMarketingInvoice WHERE Id = @Id");
    if (!check.recordset.length) return res.status(404).json({ error: "Invoice not found" });
    if (check.recordset[0].ApprovalStatus === "Approved")
      return res.status(400).json({ error: "Invoice is already approved" });
    await pool.request()
      .input("Id", sql.Int, id)
      .input("ApprovedBy", sql.Int, actorId)
      .input("ApprovedAt", sql.DateTime2(3), new Date())
      .input("ApprovalNotes", sql.NVarChar(500), ApprovalNotes || null)
      .query(`UPDATE dbo.SaMarketingInvoice SET
        ApprovalStatus = 'Approved',
        ApprovedBy     = @ApprovedBy,
        ApprovedAt     = @ApprovedAt,
        ApprovalNotes  = @ApprovalNotes,
        UpdatedAt      = GETDATE()
      WHERE Id = @Id`);
    await invalidateMarketingInvoiceDependents();
    res.json({ message: "Invoice approved" });
  } catch (err) {
    console.error("[sa-marketing-invoices] POST /approve error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /:id/reject
router.post("/:id/reject", requirePageRight("sa-marketing-invoices", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const actorId = req.user?.userId || null;
  const { ApprovalNotes } = req.body;
  try {
    const pool = getPool();
    const check = await pool.request().input("Id", sql.Int, id)
      .query("SELECT Id, ApprovalStatus FROM dbo.SaMarketingInvoice WHERE Id = @Id");
    if (!check.recordset.length) return res.status(404).json({ error: "Invoice not found" });
    if (check.recordset[0].ApprovalStatus === "Approved")
      return res.status(400).json({ error: "Approved invoice cannot be rejected" });
    if (check.recordset[0].ApprovalStatus === "Rejected")
      return res.status(400).json({ error: "Invoice is already rejected" });
    await pool.request()
      .input("Id", sql.Int, id)
      .input("ApprovedBy", sql.Int, actorId)
      .input("ApprovedAt", sql.DateTime2(3), new Date())
      .input("ApprovalNotes", sql.NVarChar(500), ApprovalNotes || null)
      .query(`UPDATE dbo.SaMarketingInvoice SET
        ApprovalStatus = 'Rejected',
        ApprovedBy     = @ApprovedBy,
        ApprovedAt     = @ApprovedAt,
        ApprovalNotes  = @ApprovalNotes,
        UpdatedAt      = GETDATE()
      WHERE Id = @Id`);
    await invalidateMarketingInvoiceDependents();
    res.json({ message: "Invoice rejected" });
  } catch (err) {
    console.error("[sa-marketing-invoices] POST /reject error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
