// backend/routes/crmInvoices.js
//
// Standalone, cross-booking Invoice list — backs the new dedicated Invoice
// menu item. Actual invoice creation still happens per-booking via
// crmBookings.js's existing POST /:id/invoices (now demand-gated, no
// auto-generation anywhere — see migration 309 / crmWorkflowGuards.js), and
// PDF download stays on crmBookings.js's GET /:id/invoices/:invoiceId/pdf.
// This file only adds the list-everything view that never existed before,
// since invoices used to only ever be looked at per-booking.
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(apiRateLimit);

router.get("/", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { type, search } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (type) { req0.input("t", sql.NVarChar(30), type); conds.push("inv.InvoiceType = @t"); }
    if (search) {
      req0.input("q", sql.NVarChar(200), `%${search}%`);
      conds.push("(a.ApplicantName LIKE @q OR b.BookingNo LIKE @q OR inv.InvoiceNo LIKE @q)");
    }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.CreatedAt,
             b.Id AS BookingId, b.BookingNo, b.ProjectName, b.UnitNo,
             a.ApplicantName, a.Mobile,
             cu.name AS CreatedByName
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
      ${where}
      ORDER BY inv.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-invoices] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
