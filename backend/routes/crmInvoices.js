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
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { projectPredicate, projectAllowed, crmProjectGuards } = require("../services/projectScope");
const { DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { round2 } = require("../services/bookingUnits");
const { gstSplitByRatio } = require("../services/crmLedger");
const { getFinalStatementPdfBuffer } = require("../services/invoicePdf");
const { onAccountWithAvailableSql } = require("../services/crmPaymentFunding");
const { getBookingWaivers, getMilestoneMoneyStages } = require("../services/crmOnAccountCoverage");
const { applyPagination } = require("../services/crmListPagination");

router.use(authMiddleware);

// Guard /:id — verify the caller can access this invoice's project before any
// handler runs. The SQL resolves the project via the booking join.
crmProjectGuards(router, "SELECT b.ProjectId FROM dbo.CrmInvoice i JOIN dbo.CrmBooking b ON b.Id = i.BookingId WHERE i.Id = @id");

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
         inv.MilestoneId, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.TotalGstAmount, b.GrandTotal,
         COALESCE(proj.name, b.ProjectName) AS ProjectName,
         COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
         a.ApplicantName, a.Mobile,
         cu.name AS CreatedByName
  ${INVOICE_FROM}
  LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy`;

// An invoice row with its taxable value and GST, the same split its PDF prints (getGstSplit).
function withGst(row) {
  const { TotalGstAmount, GrandTotal, ...rest } = row;
  const { gstAmount, baseAmount } = gstSplitByRatio(Number(row.Amount) || 0, TotalGstAmount, GrandTotal);
  return { ...rest, GstAmount: gstAmount, TaxableValue: baseAmount };
}

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
  if (query.status === "void") w.push("inv.Status = 'Void'");
  if (query.status === "live") w.push("inv.Status <> 'Void'");
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
  const w = ["b.IsActive = 1", ...bookingConds(request, query, scope)];
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
// One row per booking: what its plan is worth, what is invoiced against it, and what could be. A Final invoice bills the
// whole plan in one document with no milestone link, so it counts every milestone as invoiced. A waived milestone is
// not billable. "Ready" is a demand raised with no invoice yet, as getMilestoneInsight says on the page. A Non-Invoice
// customer takes no milestone invoices (requireInvoiceableCustomer in crmBookings.js): their one Final invoice falls
// due when no milestone has money outstanding, and until then nothing is waiting to be billed to them.
const LIVE_INVOICE = "i.Status <> 'Void'";
const ledgerSelect = (where) => `
  SELECT z.*, fd.FinalDue,
         CASE WHEN z.NonInvoice = 0 AND z.Closed = 0 AND z.HasFinal = 0 AND z.MilestoneTotal > 0 AND z.OpenCount = 0 AND z.MilestoneLinked = z.MilestoneTotal THEN 1 ELSE 0 END AS StatementDue,
         CASE WHEN fd.FinalDue = 1 THEN z.PlanDue WHEN z.HasFinal = 1 OR z.Closed = 1 OR z.NonInvoice = 1 THEN 0 ELSE z.ReadyRaw END AS ReadyAmount,
         CASE WHEN z.HasFinal = 1 OR z.Closed = 1 OR z.NonInvoice = 1 THEN 0 ELSE z.ReadyRawCount END AS ReadyCount,
         CASE WHEN z.HasFinal = 1 THEN z.MilestoneTotal ELSE z.MilestoneLinked END AS MilestoneInvoiced,
         CASE WHEN z.Closed = 0 AND z.PlanDue - z.PlanInvoiced > 0 THEN z.PlanDue - z.PlanInvoiced ELSE 0 END AS NotInvoiced,
         CASE WHEN z.Closed = 0 AND z.Approved - z.PlanDue > 0.009 THEN z.Approved - z.PlanDue ELSE 0 END AS ExcessOnAccount,
         CASE WHEN z.Closed = 0 AND (z.NonInvoice = 0 OR fd.FinalDue = 1) AND (CASE WHEN z.Approved < z.PlanDue THEN z.Approved ELSE z.PlanDue END) - z.PlanInvoiced > 0.009
              THEN (CASE WHEN z.Approved < z.PlanDue THEN z.Approved ELSE z.PlanDue END) - z.PlanInvoiced ELSE 0 END AS ReceivedNotInvoiced
  FROM (
    SELECT b.Id AS BookingId, b.BookingNo, b.Status AS BookingStatus, b.ApplicationId,
           CASE WHEN b.Status IN ${DEAD_BOOKING_SQL} THEN 1 ELSE 0 END AS Closed,
           CASE WHEN cust.InvoiceMode = N'NonInvoice' THEN 1 ELSE 0 END AS NonInvoice, ISNULL(ms.OpenCount, 0) AS OpenCount,
           COALESCE(proj.name, b.ProjectName) AS ProjectName, COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
           a.ApplicantName, a.Mobile, u.name AS AssignedToName,
           ISNULL(ms.PlanDue, 0) AS PlanDue, ISNULL(ms.Waived, 0) AS Waived, b.GrandTotal, ISNULL(ms.MilestoneTotal, 0) AS MilestoneTotal, ISNULL(ms.Linked, 0) AS MilestoneLinked,
           ISNULL(ms.ReadyRaw, 0) AS ReadyRaw, ISNULL(ms.ReadyRawCount, 0) AS ReadyRawCount, ISNULL(ms.Adjusted, 0) + ISNULL(oa.Held, 0) AS Approved,
           ISNULL(iv.Invoiced, 0) AS Invoiced, ISNULL(iv.PlanInvoiced, 0) AS PlanInvoiced, ISNULL(iv.OtherInvoiced, 0) AS OtherInvoiced,
           ISNULL(iv.LiveCount, 0) AS LiveCount, ISNULL(iv.VoidCount, 0) AS VoidCount, ISNULL(iv.HasFinal, 0) AS HasFinal, iv.LastInvoiceDate,
           ISNULL(cr.Credited, 0) AS Credited, ISNULL(iv.Invoiced, 0) - ISNULL(cr.Credited, 0) AS NetInvoiced
    FROM dbo.CrmBooking b
    ${BOOKING_JOINS}
    LEFT JOIN dbo.Users u ON u.id = b.AssignedTo
    LEFT JOIN dbo.CrmCustomer cust ON cust.Id = a.CustomerId
    OUTER APPLY (SELECT SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE m.AmountDue END) AS PlanDue,
                        SUM(CASE WHEN m.Status NOT IN ('Paid', 'Waived') THEN 1 ELSE 0 END) AS OpenCount,
                        SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE 1 END) AS MilestoneTotal,
                        SUM(CASE WHEN m.Status = 'Waived' THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END) AS Waived,
                        SUM(ISNULL(m.AmountPaid, 0)) AS Adjusted,
                        SUM(CASE WHEN m.Status <> 'Waived' AND li.Has = 1 THEN 1 ELSE 0 END) AS Linked,
                        SUM(CASE WHEN m.Status <> 'Waived' AND m.DemandStatus <> 'Pending' AND li.Has IS NULL THEN m.AmountDue ELSE 0 END) AS ReadyRaw,
                        SUM(CASE WHEN m.Status <> 'Waived' AND m.DemandStatus <> 'Pending' AND li.Has IS NULL THEN 1 ELSE 0 END) AS ReadyRawCount
                 FROM dbo.CrmPaymentMilestone m
                 OUTER APPLY (SELECT TOP 1 1 AS Has FROM dbo.CrmInvoice i WHERE i.MilestoneId = m.Id AND ${LIVE_INVOICE}) li
                 WHERE m.BookingId = b.Id) ms
    OUTER APPLY (SELECT SUM(CASE WHEN ${LIVE_INVOICE} THEN i.Amount ELSE 0 END) AS Invoiced,
                        SUM(CASE WHEN ${LIVE_INVOICE} AND (i.MilestoneId IS NOT NULL OR i.InvoiceType = 'Final') THEN i.Amount ELSE 0 END) AS PlanInvoiced,
                        SUM(CASE WHEN ${LIVE_INVOICE} AND i.MilestoneId IS NULL AND i.InvoiceType <> 'Final' THEN i.Amount ELSE 0 END) AS OtherInvoiced,
                        SUM(CASE WHEN ${LIVE_INVOICE} THEN 1 ELSE 0 END) AS LiveCount, SUM(CASE WHEN i.Status = 'Void' THEN 1 ELSE 0 END) AS VoidCount,
                        MAX(CASE WHEN ${LIVE_INVOICE} AND i.InvoiceType = 'Final' THEN 1 ELSE 0 END) AS HasFinal,
                        MAX(CASE WHEN ${LIVE_INVOICE} THEN i.InvoiceDate END) AS LastInvoiceDate
                 FROM dbo.CrmInvoice i WHERE i.BookingId = b.Id) iv
    OUTER APPLY (SELECT SUM(n.TotalAmount) AS Credited FROM dbo.CrmGstNote n JOIN dbo.CrmInvoice i ON i.Id = n.InvoiceId
                 WHERE i.BookingId = b.Id AND ${LIVE_INVOICE} AND n.Status IN (N'Issued', N'TimeBarred')) cr
    OUTER APPLY (SELECT SUM(o.AvailableAmount) AS Held FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = b.Id) oa
    ${where}
  ) z
  CROSS APPLY (SELECT CASE WHEN z.NonInvoice = 1 AND z.Closed = 0 AND z.HasFinal = 0 AND z.MilestoneTotal > 0 AND z.OpenCount = 0 THEN 1 ELSE 0 END AS FinalDue) fd`;
// The milestones ready to invoice on the given bookings, for generating them in one go.
const readyMilestonesSql = (ids) => `
  SELECT m.BookingId, m.Id FROM dbo.CrmPaymentMilestone m
  WHERE m.BookingId IN (${ids}) AND m.Status <> 'Waived' AND m.DemandStatus <> 'Pending'
    AND NOT EXISTS (SELECT 1 FROM dbo.CrmInvoice i WHERE i.MilestoneId = m.Id AND ${LIVE_INVOICE})
  ORDER BY m.BookingId, m.MilestoneNo, m.Id`;
const LEDGER_FOCUS = {
  everything: "1 = 1",
  ready: "y.ReadyAmount > 0",
  final: "y.FinalDue = 1",
  uninvoiced: "y.ReceivedNotInvoiced > 0",
  none: "y.Closed = 0 AND y.MilestoneInvoiced = 0",
  partial: "y.Closed = 0 AND y.MilestoneInvoiced > 0 AND y.MilestoneInvoiced < y.MilestoneTotal",
  full: "y.Closed = 0 AND y.MilestoneTotal > 0 AND y.MilestoneInvoiced = y.MilestoneTotal",
  closed: "y.Closed = 1",
};
const LEDGER_SORT = {
  ApplicantName: "y.ApplicantName", BookingNo: "y.BookingNo", PlanDue: "y.PlanDue", Invoiced: "y.Invoiced", NetInvoiced: "y.NetInvoiced",
  Credited: "y.Credited", ReadyAmount: "y.ReadyAmount", ReceivedNotInvoiced: "y.ReceivedNotInvoiced", NotInvoiced: "y.NotInvoiced",
  LastInvoiceDate: "y.LastInvoiceDate", AssignedToName: "y.AssignedToName",
};

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

// GET /ledger — one page of bookings with their billing (one query: the rows and their total together). Without ?page,
// the rows alone (for the export).
router.get("/ledger", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const req0 = getPool().request();
    const BASE = ledgerSelect(groupedWhere(req0, req.query, req.projectScope));
    const focus = Object.hasOwn(LEDGER_FOCUS, req.query.focus) ? req.query.focus : "everything";
    const sortCol = Object.hasOwn(LEDGER_SORT, req.query.sortKey) ? LEDGER_SORT[req.query.sortKey] : null;
    const orderBy = sortCol
      ? `ORDER BY ${sortCol} ${req.query.sortDir === "asc" ? "ASC" : "DESC"}, y.BookingId DESC`
      // First what can be invoiced now, then money received with no invoice, then the newest booking.
      : "ORDER BY y.Closed ASC, y.ReadyAmount DESC, y.ReceivedNotInvoiced DESC, y.BookingId DESC";
    if (!req.query.page) {
      const all = await req0.query(`SELECT y.* FROM (${BASE}) y WHERE ${LEDGER_FOCUS[focus]} ${orderBy}`);
      return res.json(all.recordset);
    }
    const { page, pageSize, offset } = applyPagination(req, 25);
    req0.input("offset", sql.Int, offset);
    req0.input("pageSize", sql.Int, pageSize);
    const rows = (await req0.query(`SELECT y.*, COUNT(*) OVER () AS TotalRows FROM (${BASE}) y WHERE ${LEDGER_FOCUS[focus]} ${orderBy} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`)).recordset;
    const readyIds = rows.filter((r) => r.ReadyCount > 0).map((r) => Number(r.BookingId));
    if (readyIds.length) {
      const ready = (await getPool().request().query(readyMilestonesSql(readyIds.join(",")))).recordset;
      for (const r of rows) r.ReadyMilestoneIds = ready.filter((m) => m.BookingId === r.BookingId).map((m) => m.Id);
    }
    res.json({ rows, total: rows[0]?.TotalRows || 0, page, pageSize });
  } catch (e) {
    console.error("[crm-invoices] GET /ledger error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /ledger/summary — the tab counts and the money across live bookings, plus the invoice types in use. Its own call, so
// paging and sorting never work these out again.
router.get("/ledger/summary", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const sumReq = pool.request();
    const BASE = ledgerSelect(groupedWhere(sumReq, req.query, req.projectScope));
    const liveSum = (c) => `SUM(CASE WHEN y.Closed = 0 THEN y.${c} ELSE 0 END) AS S_${c}`;
    const countOf = (k) => `SUM(CASE WHEN ${LEDGER_FOCUS[k]} THEN 1 ELSE 0 END) AS C_${k}`;
    const [sumRes, invoices, types] = await Promise.all([
      sumReq.query(`SELECT ${Object.keys(LEDGER_FOCUS).map(countOf).join(", ")},
          ${["PlanDue", "PlanInvoiced", "OtherInvoiced", "Invoiced", "Credited", "NetInvoiced", "ReadyAmount", "ReadyCount", "NotInvoiced", "ReceivedNotInvoiced"].map(liveSum).join(", ")}
        FROM (${BASE}) y`),
      invoiceSummary(pool, req.query, req.projectScope),
      pool.request().query("SELECT DISTINCT InvoiceType FROM dbo.CrmInvoice WHERE InvoiceType IS NOT NULL ORDER BY InvoiceType"),
    ]);
    const sm = sumRes.recordset[0] || {};
    const money = (k) => round2(Number(sm[`S_${k}`]) || 0);
    res.json({
      counts: Object.fromEntries(Object.keys(LEDGER_FOCUS).map((k) => [k, sm[`C_${k}`] || 0])),
      planDue: money("PlanDue"), planInvoiced: money("PlanInvoiced"), otherInvoiced: money("OtherInvoiced"), invoiced: money("Invoiced"), credited: money("Credited"),
      netInvoiced: money("NetInvoiced"), ready: money("ReadyAmount"), readyCount: sm.S_ReadyCount || 0, notInvoiced: money("NotInvoiced"), receivedNotInvoiced: money("ReceivedNotInvoiced"),
      invoices, types: types.recordset.map((t) => t.InvoiceType),
    });
  } catch (e) {
    console.error("[crm-invoices] GET /ledger/summary error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId/statement — the Final Statement PDF, once every milestone is invoiced and paid. Reads only: it is
// not a tax invoice, so it takes no number and books nothing.
router.get("/booking/:bookingId/statement", requirePageRight("crm-invoices", "view"), async (req, res) => {
  const bid = parseInt(req.params.bookingId, 10);
  if (!Number.isInteger(bid) || bid <= 0) return res.status(400).json({ error: "Invalid booking" });
  try {
    const pool = getPool();
    const head = (await pool.request().input("bid", sql.Int, bid).query(`SELECT y.StatementDue, y.BookingNo FROM (${ledgerSelect("WHERE b.Id = @bid")}) y`)).recordset[0];
    if (!head) return res.status(404).json({ error: "Booking not found" });
    if (!head.StatementDue) return res.status(409).json({ error: "The final statement is available once every milestone is invoiced and paid." });
    const pdf = await getFinalStatementPdfBuffer(pool, bid);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Final-Statement-${head.BookingNo}.pdf"`);
    res.send(pdf);
  } catch (e) {
    console.error("[crm-invoices] GET /booking/:id/statement error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /booking/:bookingId — one booking's billing: every invoice (void ones too), each milestone with its demand, invoice and
// money, and the credit notes.
router.get("/booking/:bookingId", requirePageRight("crm-invoices", "view"), async (req, res) => {
  const bid = parseInt(req.params.bookingId, 10);
  if (!Number.isInteger(bid) || bid <= 0) return res.status(400).json({ error: "Invalid booking" });
  try {
    const pool = getPool();
    const headReq = pool.request().input("bid", sql.Int, bid);
    const [headRes, invRes, msRes, noteRes, staged, waivers] = await Promise.all([
      headReq.query(`SELECT y.* FROM (${ledgerSelect("WHERE b.Id = @bid")}) y`),
      pool.request().input("bid", sql.Int, bid).query(`${FLAT_SELECT} WHERE inv.BookingId = @bid ORDER BY inv.InvoiceDate DESC, inv.Id DESC`),
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT m.Id, m.MilestoneNo, m.MilestoneName, m.AmountDue, m.AmountPaid, m.Status, m.DueDate, m.DemandStatus, m.DemandNo, m.DemandRaisedOn
        FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = @bid ORDER BY m.MilestoneNo, m.Id`),
      pool.request().input("bid", sql.Int, bid).query(`
        SELECT n.Id, n.DocNo, n.DocType, n.Status, n.DocDate, n.TotalAmount, n.TaxableValue, n.GstAmount, i.InvoiceNo
        FROM dbo.CrmGstNote n JOIN dbo.CrmInvoice i ON i.Id = n.InvoiceId WHERE i.BookingId = @bid ORDER BY n.Id DESC`),
      getMilestoneMoneyStages(pool, bid),
      getBookingWaivers(pool, bid),
    ]);
    const head = headRes.recordset[0];
    if (!head) return res.status(404).json({ error: "Booking not found" });
    const stageOf = new Map(staged.milestones.map((m) => [m.Id, m]));
    // What came in against an invoice: its milestone's money, or for a Final invoice all of it, in milestone order.
    const receivedOn = (m) => (m ? round2((Number(m.AmountPaid) || 0) + (m.HeldOnAccount || 0) + (m.WithFinanceCover || 0) + (m.RecordedCover || 0)) : null);
    const allReceived = round2(staged.milestones.reduce((n, m) => n + (m.Status === "Waived" ? 0 : receivedOn(m)), 0));
    res.json({
      booking: head,
      waivers,
      invoices: invRes.recordset.map(withGst).map((i) => {
        const received = i.Status === "Void" ? null : i.InvoiceType === "Final" ? allReceived : i.MilestoneId ? receivedOn(stageOf.get(i.MilestoneId)) : null;
        return { ...i, Received: received, Balance: received == null ? null : Math.max(0, round2(Number(i.Amount) - received)) };
      }),
      creditNotes: noteRes.recordset,
      milestones: msRes.recordset.map((m) => {
        const c = stageOf.get(m.Id) || {};
        return { ...m, HeldOnAccount: c.HeldOnAccount || 0, WithFinanceCover: c.WithFinanceCover || 0, RecordedCover: c.RecordedCover || 0, MoneyStage: c.MoneyStage ?? null };
      }),
    });
  } catch (e) {
    console.error("[crm-invoices] GET /booking/:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET / — every invoice, one row each. Filters: type, status (live / void), search, companyId, projectId, blockId, dateFrom,
// dateTo; the sort is on the server so it applies across all pages. Without ?page, the rows alone (for the export).
router.get("/", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const scope = req.projectScope;
    const FLAT_SORT_COLS = {
      InvoiceNo: "inv.InvoiceNo", BookingNo: "b.BookingNo", ApplicantName: "a.ApplicantName",
      ProjectName: "COALESCE(proj.name, b.ProjectName)", InvoiceType: "inv.InvoiceType", Amount: "inv.Amount",
      InvoiceDate: "inv.InvoiceDate", CreatedAt: "inv.CreatedAt", Status: "inv.Status", CreatedByName: "cu.name",
    };
    const sortCol = Object.hasOwn(FLAT_SORT_COLS, req.query.sortKey) ? FLAT_SORT_COLS[req.query.sortKey] : "inv.CreatedAt";
    const orderBy = `ORDER BY ${sortCol} ${req.query.sortDir === "asc" ? "ASC" : "DESC"}, inv.Id DESC`;
    const req_ = pool.request();
    const where = flatWhere(req_, req.query, scope);
    if (!req.query.page) return res.json((await req_.query(`${FLAT_SELECT} ${where} ${orderBy}`)).recordset.map(withGst));
    const { page, pageSize, offset } = applyPagination(req, 25);
    req_.input("offset", sql.Int, offset).input("pageSize", sql.Int, pageSize);
    const countReq = pool.request();
    const countWhere = flatWhere(countReq, req.query, scope);
    const [result, countResult] = await Promise.all([
      req_.query(`${FLAT_SELECT} ${where} ${orderBy} OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`),
      countReq.query(`SELECT COUNT(*) AS Total ${INVOICE_FROM} ${countWhere}`),
    ]);
    res.json({ rows: result.recordset.map(withGst), total: countResult.recordset[0]?.Total || 0, page, pageSize });
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
    res.json(withGst(row));
  } catch (e) {
    console.error("[crm-invoices] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
