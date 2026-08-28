const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
// No extra permission gate here — /api routes are already protected
// by authMiddleware at the server level. Any authenticated user who
// has been granted Sales rights can view aggregate dashboard stats.

/**
 * GET /api/sales-dashboard
 *
 * Returns all stats scoped to the Sales module only:
 *   - Sale Orders (SaleOrders)     : total, today, by status, total value
 *   - Sale Invoices (SaleInvoices) : total, today, payment status, amounts
 *   - Recent sale orders           : last 8 rows
 *   - Recent sale invoices         : last 8 rows
 */
router.get("/", cache("sales-dashboard", 60), async (req, res) => {
  // companyId is optional — omitting it (the dashboard's own default, no
  // company picker on the page anymore) aggregates across every company
  // instead of requiring one to be chosen before anything loads.
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  try {
    const pool = getPool();

    const [
      saleOrderStats,
      saleInvoiceStats,
      recentSaleOrders,
      recentSaleInvoices,
    ] = await Promise.all([
      // ── Sale Orders ──────────────────────────────────────────────────────────
      pool.request().input("CompanyId", sql.Int, companyId).query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          ISNULL(SUM(TotalAmount), 0)                                           AS TotalAmount,
          COUNT(CASE WHEN ISNULL(Status, 'Draft') = 'Draft' THEN 1 END)        AS DraftCount,
          COUNT(CASE WHEN Status = 'Pending' THEN 1 END)                       AS PendingCount,
          COUNT(CASE WHEN Status = 'Approved' THEN 1 END)                      AS ApprovedCount,
          COUNT(CASE WHEN Status = 'Rejected' THEN 1 END)                      AS RejectedCount
        FROM dbo.SaleOrders
        WHERE (@CompanyId IS NULL OR FromCompanyID = @CompanyId)
      `),

      // ── Sale Invoices ────────────────────────────────────────────────────────
      pool.request().input("CompanyId", sql.Int, companyId).query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          ISNULL(SUM(Amount), 0)                                                AS TotalAmount,
          ISNULL(SUM(AmountReceived), 0)                                        AS TotalReceived,
          COUNT(CASE WHEN PaymentStatus = 'Paid' THEN 1 END)                    AS PaidCount,
          COUNT(CASE WHEN ISNULL(PaymentStatus, 'Pending Payment') <> 'Paid' THEN 1 END)
                                                                                AS PendingCount
        FROM dbo.SaleInvoices
        WHERE ISNULL(IsDeleted, 0) = 0 AND (@CompanyId IS NULL OR CompanyId = @CompanyId)
      `),

      // ── Recent Sale Orders (last 8) ──────────────────────────────────────────
      pool.request().input("CompanyId", sql.Int, companyId).query(`
        SELECT TOP 8
          so.SaleOrderID,
          so.DocNo,
          so.OrderDate,
          so.TotalAmount,
          so.Status,
          tc.name AS ToCompanyName,
          so.CreatedAt
        FROM dbo.SaleOrders so
        LEFT JOIN dbo.enterprise tc ON tc.id = so.ToCompanyID
        WHERE (@CompanyId IS NULL OR so.FromCompanyID = @CompanyId)
        ORDER BY so.CreatedAt DESC
      `),

      // ── Recent Sale Invoices (last 8) ───────────────────────────────────────
      pool.request().input("CompanyId", sql.Int, companyId).query(`
        SELECT TOP 8
          si.SaleInvoiceID,
          si.SaleInvoiceNo,
          si.InvoiceDate,
          si.Amount,
          si.AmountReceived,
          si.PaymentStatus,
          ah.LHeadName AS CustomerName,
          si.CreatedAt
        FROM dbo.SaleInvoices si
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = si.CustomerID
        WHERE ISNULL(si.IsDeleted, 0) = 0 AND (@CompanyId IS NULL OR si.CompanyId = @CompanyId)
        ORDER BY si.CreatedAt DESC
      `),
    ]);

    const so = saleOrderStats.recordset[0];
    const si = saleInvoiceStats.recordset[0];

    res.json({
      saleOrders: {
        totalCount: so.TotalCount,
        todayCount: so.TodayCount,
        totalAmount: parseFloat(so.TotalAmount),
        draftCount: so.DraftCount,
        pendingCount: so.PendingCount,
        approvedCount: so.ApprovedCount,
        rejectedCount: so.RejectedCount,
      },
      saleInvoices: {
        totalCount: si.TotalCount,
        todayCount: si.TodayCount,
        totalAmount: parseFloat(si.TotalAmount),
        totalReceived: parseFloat(si.TotalReceived),
        paidCount: si.PaidCount,
        pendingCount: si.PendingCount,
      },
      recentSaleOrders: recentSaleOrders.recordset,
      recentSaleInvoices: recentSaleInvoices.recordset,
    });
  } catch (err) {
    console.error("SALES DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
