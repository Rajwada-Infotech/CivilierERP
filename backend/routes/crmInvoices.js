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
const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(apiRateLimit);

// GET / — view=flat (default "flat" for back-compat with any existing
// caller) | view=grouped. Shared filters: type, search, projectId, blockId,
// dateFrom, dateTo, page, pageSize. Grouped-only filter: invoicedStatus
// (all|full|partial|none).
router.get("/", requirePageRight("crm-invoices", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const {
      view = "flat", type, search, projectId, blockId, dateFrom, dateTo,
      invoicedStatus, page = "1", pageSize = "20",
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20));
    const offset = (pageNum - 1) * pageSizeNum;

    if (view === "grouped") {
      // Paginate over bookings first (base = CrmBooking, not CrmInvoice, so
      // a booking with zero invoices is still eligible to appear — required
      // for invoicedStatus=none and for showing "0 of N invoiced").
      const req_ = pool.request().input("pageSize", sql.Int, pageSizeNum).input("offset", sql.Int, offset);
      let where = "WHERE 1=1";
      if (projectId) { where += " AND b.ProjectId = @pid"; req_.input("pid", sql.Int, parseInt(projectId, 10)); }
      if (blockId)   { where += " AND um.BlockId = @bkid"; req_.input("bkid", sql.Int, parseInt(blockId, 10)); }
      if (search) {
        where += " AND (a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR COALESCE(proj.name, b.ProjectName) LIKE @s)";
        req_.input("s", sql.NVarChar(200), `%${search}%`);
      }
      if (type) {
        where += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv2 WHERE inv2.BookingId = b.Id AND inv2.InvoiceType = @t AND inv2.Status <> 'Void')";
        req_.input("t", sql.NVarChar(30), type);
      }
      if (dateFrom) { where += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv3 WHERE inv3.BookingId = b.Id AND inv3.InvoiceDate >= @df)"; req_.input("df", sql.Date, dateFrom); }
      if (dateTo)   { where += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv4 WHERE inv4.BookingId = b.Id AND inv4.InvoiceDate <= @dt)"; req_.input("dt", sql.Date, dateTo); }

      // Milestone counts exclude MilestoneNo=1 (Booking Amount) — it's
      // invoiced from the Booking page itself, not part of this flow, same
      // exclusion the Generate Invoice modal's own eligibility check uses.
      // SQL Server can't reference a SELECT-list alias for a correlated
      // subquery inside HAVING (aliases aren't bound yet at that point in
      // query evaluation) — wrap the aggregation in a derived table and
      // filter that with a plain WHERE instead, same technique already used
      // below for the count query.
      const outerFilter = (() => {
        if (invoicedStatus === "full") return "WHERE x.MilestoneTotal > 0 AND x.MilestoneInvoiced = x.MilestoneTotal";
        if (invoicedStatus === "partial") return "WHERE x.MilestoneInvoiced > 0 AND x.MilestoneInvoiced < x.MilestoneTotal";
        if (invoicedStatus === "none") return "WHERE x.MilestoneInvoiced = 0";
        return "";
      })();

      const bookingsResult = await req_.query(`
        SELECT * FROM (
          SELECT b.Id AS BookingId, b.BookingNo,
                 COALESCE(proj.name, b.ProjectName) AS ProjectName,
                 COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
                 a.ApplicantName, a.Mobile,
                 (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND m.MilestoneNo <> 1) AS MilestoneTotal,
                 (SELECT COUNT(DISTINCT m.Id) FROM dbo.CrmPaymentMilestone m
                   WHERE m.BookingId = b.Id AND m.MilestoneNo <> 1
                     AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv WHERE inv.MilestoneId = m.Id AND inv.Status <> 'Void')
                 ) AS MilestoneInvoiced
          FROM dbo.CrmBooking b
          JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
          LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
          ${where}
        ) x
        ${outerFilter}
        ORDER BY x.BookingNo DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `);

      const countReq = pool.request();
      let countWhere = "WHERE 1=1";
      if (projectId) { countWhere += " AND b.ProjectId = @pid"; countReq.input("pid", sql.Int, parseInt(projectId, 10)); }
      if (blockId)   { countWhere += " AND um.BlockId = @bkid"; countReq.input("bkid", sql.Int, parseInt(blockId, 10)); }
      if (search) {
        countWhere += " AND (a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR COALESCE(proj.name, b.ProjectName) LIKE @s)";
        countReq.input("s", sql.NVarChar(200), `%${search}%`);
      }
      if (type) {
        countWhere += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv2 WHERE inv2.BookingId = b.Id AND inv2.InvoiceType = @t AND inv2.Status <> 'Void')";
        countReq.input("t", sql.NVarChar(30), type);
      }
      if (dateFrom) { countWhere += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv3 WHERE inv3.BookingId = b.Id AND inv3.InvoiceDate >= @df)"; countReq.input("df", sql.Date, dateFrom); }
      if (dateTo)   { countWhere += " AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv4 WHERE inv4.BookingId = b.Id AND inv4.InvoiceDate <= @dt)"; countReq.input("dt", sql.Date, dateTo); }
      // The invoicedStatus HAVING filter can't be reused verbatim in a plain
      // COUNT(*) — re-derive it as a wrapped subquery so paging's total stays
      // accurate against the same filter.
      const countResult = await countReq.query(`
        SELECT COUNT(*) AS Total FROM (
          SELECT b.Id,
                 (SELECT COUNT(*) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND m.MilestoneNo <> 1) AS MilestoneTotal,
                 (SELECT COUNT(DISTINCT m.Id) FROM dbo.CrmPaymentMilestone m
                   WHERE m.BookingId = b.Id AND m.MilestoneNo <> 1
                     AND EXISTS (SELECT 1 FROM dbo.CrmInvoice inv WHERE inv.MilestoneId = m.Id AND inv.Status <> 'Void')
                 ) AS MilestoneInvoiced
          FROM dbo.CrmBooking b
          JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
          LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
          ${countWhere}
        ) x
        ${invoicedStatus === "full" ? "WHERE x.MilestoneTotal > 0 AND x.MilestoneInvoiced = x.MilestoneTotal"
          : invoicedStatus === "partial" ? "WHERE x.MilestoneInvoiced > 0 AND x.MilestoneInvoiced < x.MilestoneTotal"
          : invoicedStatus === "none" ? "WHERE x.MilestoneInvoiced = 0"
          : ""}
      `);

      const bookingIds = bookingsResult.recordset.map((r) => r.BookingId);
      let invoicesByBooking = {};
      if (bookingIds.length) {
        const invReq = pool.request();
        const idParams = bookingIds.map((id, i) => { invReq.input(`b${i}`, sql.Int, id); return `@b${i}`; }).join(",");
        const invResult = await invReq.query(`
          SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.VoidReason, inv.CreatedAt,
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

      const groups = bookingsResult.recordset.map((b) => ({
        ...b,
        Invoices: invoicesByBooking[b.BookingId] || [],
      }));

      return res.json({
        view: "grouped", groups,
        total: countResult.recordset[0]?.Total || 0,
        page: pageNum, pageSize: pageSizeNum,
      });
    }

    // Flat mode — paginated invoice rows across every booking, for
    // reconciliation. Same filter set, minus invoicedStatus (meaningless per
    // individual invoice row).
    const req_ = pool.request().input("pageSize", sql.Int, pageSizeNum).input("offset", sql.Int, offset);
    let where = "WHERE 1=1";
    if (type)       { where += " AND inv.InvoiceType = @t"; req_.input("t", sql.NVarChar(30), type); }
    if (projectId)  { where += " AND b.ProjectId = @pid"; req_.input("pid", sql.Int, parseInt(projectId, 10)); }
    if (blockId)    { where += " AND um.BlockId = @bkid"; req_.input("bkid", sql.Int, parseInt(blockId, 10)); }
    if (dateFrom)   { where += " AND inv.InvoiceDate >= @df"; req_.input("df", sql.Date, dateFrom); }
    if (dateTo)     { where += " AND inv.InvoiceDate <= @dt"; req_.input("dt", sql.Date, dateTo); }
    if (search) {
      req_.input("s", sql.NVarChar(200), `%${search}%`);
      where += " AND (a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR inv.InvoiceNo LIKE @s)";
    }

    const result = await req_.query(`
      SELECT inv.Id, inv.InvoiceNo, inv.InvoiceType, inv.Amount, inv.InvoiceDate, inv.Description, inv.Status, inv.VoidReason, inv.CreatedAt,
             b.Id AS BookingId, b.BookingNo,
             COALESCE(proj.name, b.ProjectName) AS ProjectName,
             COALESCE(um.UnitName, b.UnitNo) AS UnitNo,
             a.ApplicantName, a.Mobile,
             cu.name AS CreatedByName
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      LEFT JOIN dbo.Users cu ON cu.id = inv.CreatedBy
      ${where}
      ORDER BY inv.CreatedAt DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const countReq = pool.request();
    let countWhere = "WHERE 1=1";
    if (type)      { countWhere += " AND inv.InvoiceType = @t"; countReq.input("t", sql.NVarChar(30), type); }
    if (projectId) { countWhere += " AND b.ProjectId = @pid"; countReq.input("pid", sql.Int, parseInt(projectId, 10)); }
    if (blockId)   { countWhere += " AND um.BlockId = @bkid"; countReq.input("bkid", sql.Int, parseInt(blockId, 10)); }
    if (dateFrom)  { countWhere += " AND inv.InvoiceDate >= @df"; countReq.input("df", sql.Date, dateFrom); }
    if (dateTo)    { countWhere += " AND inv.InvoiceDate <= @dt"; countReq.input("dt", sql.Date, dateTo); }
    if (search) {
      countReq.input("s", sql.NVarChar(200), `%${search}%`);
      countWhere += " AND (a.ApplicantName LIKE @s OR b.BookingNo LIKE @s OR inv.InvoiceNo LIKE @s)";
    }
    const countResult = await countReq.query(`
      SELECT COUNT(*) AS Total
      FROM dbo.CrmInvoice inv
      JOIN dbo.CrmBooking b ON b.Id = inv.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
      LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'
      ${countWhere}
    `);

    res.json({
      view: "flat", rows: result.recordset,
      total: countResult.recordset[0]?.Total || 0,
      page: pageNum, pageSize: pageSizeNum,
    });
  } catch (e) {
    console.error("[crm-invoices] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
