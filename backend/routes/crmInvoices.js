// backend/routes/crmInvoices.js
//
// Standalone, cross-booking Invoice list — backs the dedicated Invoice menu
// item. Actual invoice creation still happens per-booking via
// crmBookings.js's POST /:id/invoices (demand-gated, no auto-generation
// anywhere) and the new bulk endpoint POST /bookings/invoices/bulk-generate
// (also in crmBookings.js, sharing the same underlying create logic); PDF
// download stays on crmBookings.js's GET /:id/invoices/:invoiceId/pdf.
//
// Two view modes, matching two different real needs:
//   - Grouped (default): paginated over BOOKINGS, not invoice rows, so a
//     booking with zero invoices yet can still appear (needed for the
//     invoicedStatus=none filter, and for the per-booking "X of Y milestones
//     invoiced" progress the CRM Invoices page shows). Each returned booking
//     carries its own invoice list.
//   - Flat: paginated over INVOICE rows directly, for Finance reconciliation
//     across every booking in one sortable table — the old page's only mode.
//
// Each view builds its filters once and uses them for the rows, the count and the summary, with the user's
// project scope in all of them (the flat view had none, and the grouped count skipped it).
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");
const { projectPredicate, projectAllowed } = require("../services/projectScope");

router.use(authMiddleware);
router.use(apiRateLimit);

const CREDIT_COLS = `
  (SELECT ISNULL(SUM(n.TotalAmount), 0) FROM dbo.CrmGstNote n WHERE n.InvoiceId = inv.Id AND n.Status IN (N'Issued', N'TimeBarred')) AS CreditedAmount,
  (SELECT TOP 1 n.Id FROM dbo.CrmGstNote n WHERE n.InvoiceId = inv.Id AND n.Status IN (N'Issued', N'TimeBarred') ORDER BY n.Id) AS CreditNoteId,
  STUFF((SELECT N', ' + n.DocNo FROM dbo.CrmGstNote n WHERE n.InvoiceId = inv.Id AND n.Status = N'Issued' AND n.DocNo IS NOT NULL FOR XML PATH('')), 1, 2, N'') AS CreditNoteNos`;
const BOOKING_JOINS = `
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId AND um.IsActive = 1
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'`;
const INVOICE_FROM = `
  FROM dbo.CrmInvoice inv
  JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
  ${BOOKING_JOINS}`;
const FLAT_SELECT = `
  SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.VoidReason, inv.CreatedAt,
         ${CREDIT_COLS},
         inv.MilestoneId, b.Id AS BookingId, b.BookingNo, b.ProjectId,
         COALESCE(proj.name, b.ProjectName) AS ProjectName,
         COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
         a.ApplicantName, a.Mobile,
         cu.name AS CreatedByName
  ${INVOICE_FROM}
  LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy`;

// Booking-level filters, shared by both views.
function bookingConds(request, query, scope) {
  const { companyId, projectId, blockId } = query;
  const w = [];
  if (scope) w.push(projectPredicate(scope, "b.ProjectId", "").trim());
  if (companyId) { w.push("b.CompanyId = @cid"); request.input("cid", sql.Int, parseInt(companyId, 10)); }
  if (projectId) { w.push("b.ProjectId = @pid"); request.input("pid", sql.Int, parseInt(projectId, 10)); }
  if (blockId)   { w.push("b.BlockId = @bkid"); request.input("bkid", sql.Int, parseInt(blockId, 10)); }
  return w;
}
// Flat view: one row per invoice.
function flatWhere(request, query, scope) {
  const { type, dateFrom, dateTo, search } = query;
  const w = bookingConds(request, query, scope);
  if (type)     { w.push("inv.InvoiceType = @t"); request.input("t", sql.NVarChar(30), type); }
  if (dateFrom) { w.push("inv.InvoiceDate >= @df"); request.input("df", sql.Date, dateFrom); }
  if (dateTo)   { w.push("inv.InvoiceDate <= @dt"); request.input("dt", sql.Date, dateTo); }
  if (search) {
    request.input("s", sql.NVarChar(200), `%${search}%`);
    w.push("(a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR inv.InvoiceNo LIKE @s)");
  }
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}
// Grouped view: one row per booking, matched when one of its invoices matches the invoice filters.
function groupedWhere(request, query, scope) {
  const { type, dateFrom, dateTo, search } = query;
  const w = bookingConds(request, query, scope);
  if (search) {
    w.push("(a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR COALESCE(proj.name, b.ProjectName) LIKE @s OR EXISTS (SELECT 1 FROM dbo.CrmInvoice i0 WHERE i0.BookingId = b.Id AND i0.InvoiceNo LIKE @s))");
    request.input("s", sql.NVarChar(200), `%${search}%`);
  }
  if (type) {
    w.push("EXISTS (SELECT 1 FROM dbo.CrmInvoice inv2 WHERE inv2.BookingId = b.Id AND inv2.InvoiceType = @t AND inv2.Status <> 'Void')");
    request.input("t", sql.NVarChar(30), type);
  }
  if (dateFrom) { w.push("EXISTS (SELECT 1 FROM dbo.CrmInvoice inv3 WHERE inv3.BookingId = b.Id AND inv3.InvoiceDate >= @df)"); request.input("df", sql.Date, dateFrom); }
  if (dateTo)   { w.push("EXISTS (SELECT 1 FROM dbo.CrmInvoice inv4 WHERE inv4.BookingId = b.Id AND inv4.InvoiceDate <= @dt)"); request.input("dt", sql.Date, dateTo); }
  return w.length ? `WHERE ${w.join(" AND ")}` : "";
}
const INVOICED_FILTER = {
  full: "WHERE x.MilestoneTotal > 0 AND x.MilestoneInvoiced = x.MilestoneTotal",
  partial: "WHERE x.MilestoneInvoiced > 0 AND x.MilestoneInvoiced < x.MilestoneTotal",
  none: "WHERE x.MilestoneInvoiced = 0",
};
const BOOKING_ROWS = (where) => `
  SELECT b.Id AS BookingId, b.BookingNo,
         COALESCE(proj.name, b.ProjectName) AS ProjectName,
         COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
         a.ApplicantName, a.Mobile,
         (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id) AS MilestoneTotal,
         (SELECT COUNT(DISTINCT m.Id) FROM dbo.CrmPaymentMilestone m
           WHERE m.BookingId = b.Id
             AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv WHERE inv.MilestoneId = m.Id AND inv.Status <> 'Void')
         ) AS MilestoneInvoiced
  FROM dbo.CrmBooking b
  ${BOOKING_JOINS}
  ${where}`;

// The invoices matching the page's invoice filters (any view): how many and how much, credited and void.
async function invoiceSummary(pool, query, scope) {
  const r = pool.request();
  const where = flatWhere(r, query, scope);
  const row = (await r.query(`
    SELECT SUM(CASE WHEN inv.Status <> 'Void' THEN 1 ELSE 0 END) AS LiveCount,
           ISNULL(SUM(CASE WHEN inv.Status <> 'Void' THEN inv.Amount ELSE 0 END), 0) AS LiveAmount,
           SUM(CASE WHEN inv.Status = 'Void' THEN 1 ELSE 0 END) AS VoidCount,
           ISNULL(SUM(CASE WHEN inv.Status <> 'Void' THEN cr.Amount ELSE 0 END), 0) AS Credited
    ${INVOICE_FROM}
    OUTER APPLY (SELECT ISNULL(SUM(n.TotalAmount), 0) AS Amount FROM dbo.CrmGstNote n WHERE n.InvoiceId = inv.Id AND n.Status IN (N'Issued', N'TimeBarred')) cr
    ${where}`)).recordset[0] || {};
  return {
    liveCount: row.LiveCount || 0, liveAmount: Number(row.LiveAmount) || 0,
    voidCount: row.VoidCount || 0, credited: Number(row.Credited) || 0,
  };
}

// GET / — view=flat (default "flat" for back-compat with any existing
// caller) | view=grouped. Shared filters: type, search, companyId, projectId, blockId,
// dateFrom, dateTo, page, pageSize. Grouped-only filter: invoicedStatus
// (all|full|partial|none).
router.get("/", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { view = "flat", invoicedStatus, page = "1", pageSize = "20" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;
    const scope = req.projectScope;
    const summary = await invoiceSummary(pool, req.query, scope);

    if (view === "grouped") {
      // Paginate over bookings (a booking with no invoice yet still appears — invoicedStatus=none, "0 of N
      // invoiced"). SQL Server can't use a SELECT alias in HAVING, so the invoiced filter wraps a derived table.
      const outerFilter = INVOICED_FILTER[invoicedStatus] || "";
      const req_ = pool.request().input("pageSize", sql.Int, pageSizeNum).input("offset", sql.Int, offset);
      const where = groupedWhere(req_, req.query, scope);
      const countReq = pool.request();
      const countWhere = groupedWhere(countReq, req.query, scope);
      // How the matching bookings stand, the invoiced filter aside — the page's invoicing-status counts.
      const statusReq = pool.request();
      const statusWhere = groupedWhere(statusReq, req.query, scope);
      const [bookingsResult, countResult, statusResult] = await Promise.all([
        req_.query(`SELECT * FROM (${BOOKING_ROWS(where)}) x ${outerFilter} ORDER BY x.BookingNo DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
        countReq.query(`SELECT COUNT(*) AS Total FROM (${BOOKING_ROWS(countWhere)}) x ${outerFilter}`),
        statusReq.query(`SELECT
            SUM(CASE WHEN x.MilestoneTotal > 0 AND x.MilestoneInvoiced = x.MilestoneTotal THEN 1 ELSE 0 END) AS FullCount,
            SUM(CASE WHEN x.MilestoneInvoiced > 0 AND x.MilestoneInvoiced < x.MilestoneTotal THEN 1 ELSE 0 END) AS PartialCount,
            SUM(CASE WHEN x.MilestoneInvoiced = 0 THEN 1 ELSE 0 END) AS NoneCount, COUNT(*) AS AllCount
          FROM (${BOOKING_ROWS(statusWhere)}) x`),
      ]);

      const bookingIds = bookingsResult.recordset.map((r) => r.BookingId);
      let invoicesByBooking = {};
      if (bookingIds.length) {
        const invReq = pool.request();
        const idParams = bookingIds.map((id, i) => { invReq.input(`b${i}`, sql.Int, id); return `@b${i}`; }).join(",");
        const invResult = await invReq.query(`
          SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.VoidReason, inv.CreatedAt,
                 ${CREDIT_COLS},
                 inv.BookingId, inv.MilestoneId,
                 cu.name AS CreatedByName
          FROM dbo.CrmInvoice inv
          LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
          WHERE inv.BookingId IN (${idParams})
          ORDER BY inv.CreatedAt DESC
        `);
        invoicesByBooking = invResult.recordset.reduce((acc, row) => {
          (acc[row.BookingId] ||= []).push(row);
          return acc;
        }, {});
      }
      const s = statusResult.recordset[0] || {};
      return res.json({
        view: "grouped",
        groups: bookingsResult.recordset.map((b) => ({ ...b, Invoices: invoicesByBooking[b.BookingId] || [] })),
        total: countResult.recordset[0]?.Total || 0,
        page: pageNum, pageSize: pageSizeNum,
        summary: { ...summary, bookings: { all: s.AllCount || 0, full: s.FullCount || 0, partial: s.PartialCount || 0, none: s.NoneCount || 0 } },
      });
    }

    // Flat: one row per invoice; sort is server-side so it applies across all pages.
    const FLAT_SORT_COLS = {
      InvoiceNo: "inv.InvoiceNo", BookingNo: "b.BookingNo", ApplicantName: "a.ApplicantName",
      ProjectName: "COALESCE(proj.name, b.ProjectName)", InvoiceType: "inv.InvoiceType", Amount: "inv.Amount",
      InvoiceDate: "inv.InvoiceDate", CreatedAt: "inv.CreatedAt",
    };
    const sortCol = FLAT_SORT_COLS[req.query.sortKey] || "inv.CreatedAt";
    const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";
    const req_ = pool.request().input("pageSize", sql.Int, pageSizeNum).input("offset", sql.Int, offset);
    const where = flatWhere(req_, req.query, scope);
    const countReq = pool.request();
    const countWhere = flatWhere(countReq, req.query, scope);
    const [result, countResult] = await Promise.all([
      req_.query(`${FLAT_SELECT} ${where} ORDER BY ${sortCol} ${sortDir} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      countReq.query(`SELECT COUNT(*) AS Total ${INVOICE_FROM} ${countWhere}`),
    ]);
    res.json({
      view: "flat", rows: result.recordset,
      total: countResult.recordset[0]?.Total || 0,
      page: pageNum, pageSize: pageSizeNum,
      summary,
    });
  } catch (e) {
    console.error("[crm-invoices] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:id — one invoice, for a ?invoiceId= link (the page looked only through the page it had loaded).
router.get("/:id", requirePageRight("crm-invoices", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const row = (await getPool().request().input("id", sql.Int, id).query(`${FLAT_SELECT} WHERE inv.Id = @id`)).recordset[0];
    if (!row) return res.status(404).json({ error: "Invoice not found" });
    if (!projectAllowed(req.projectScope, row.ProjectId)) return res.status(403).json({ error: "You don't have access to this project" });
    res.json(row);
  } catch (e) {
    console.error("[crm-invoices] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
