const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { cache } = require("../middleware/cache");

/**
 * GET /api/finance-dashboard
 *
 * Returns all stats needed for the Finance Dashboard in a single round-trip:
 *   - Payments: total count, today's count, total amount, today's amount
 *   - Purchase Orders: total, open (Status != 'Closed'), total PO value
 *   - GRNs: total count, this-month count
 *   - Cheques: total count, pending count
 *   - Suppliers: total count (AccountHeadMaster LHeadType='S')
 *   - Customers: total count (AccountHeadMaster LHeadType='C')
 *   - General Ledger heads: total active
 *   - Recent payments: last 8 records
 *   - Recent POs: last 5 records
 */
router.get("/", cache("finance-dashboard", 60), async (req, res) => {
  try {
    const pool = getPool();

    const [
      paymentStats,
      poStats,
      grnStats,
      chequeStats,
      partyStats,
      recentPayments,
      recentPOs,
    ] = await Promise.all([
      // ── Payments ────────────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                          AS TotalCount,
          COUNT(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                            AS TodayCount,
          ISNULL(SUM(PAmount), 0)                           AS TotalAmount,
          ISNULL(SUM(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE)
                          THEN PAmount ELSE 0 END), 0)      AS TodayAmount
        FROM dbo.NewPayment
      `),

      // ── Purchase Orders ─────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                              AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') != 'Closed' THEN 1 END)
                                                                AS OpenCount,
          ISNULL(SUM(TotalAmount), 0)                           AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') != 'Closed'
                          THEN TotalAmount ELSE 0 END), 0)      AS OpenValue
        FROM dbo.PurchaseOrders
      `),

      // ── GRNs ────────────────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN YEAR(GRNDate)  = YEAR(GETDATE())
                      AND MONTH(GRNDate) = MONTH(GETDATE()) THEN 1 END)
                   AS ThisMonthCount
        FROM dbo.GoodsReceiptNotes
      `),

      // ── Cheques ─────────────────────────────────────────────────────────────
      // Status is a bit column: 1 = active/pending, 0 = cleared/inactive
      pool.request().query(`
        SELECT
          COUNT(*)                            AS TotalCount,
          COUNT(CASE WHEN Status = 'Draft' OR Status = 'Pending' OR Status IS NULL THEN 1 END) AS PendingCount
        FROM dbo.ChequeMaster
      `),

      // ── Suppliers + Customers + GL heads ────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(CASE WHEN LHeadType = 'S' THEN 1 END) AS SupplierCount,
          COUNT(CASE WHEN LHeadType = 'C' THEN 1 END) AS CustomerCount,
          COUNT(CASE WHEN LHeadType = 'GL' AND LHeadStatus = 1 THEN 1 END)
                                                        AS ActiveGLCount
        FROM dbo.AccountHeadMaster
      `),

      // ── Recent Payments (last 8) ─────────────────────────────────────────────
      pool.request().query(`
        SELECT TOP 8
          PPaymentID,
          PPaymentName,
          PMode,
          PAmount,
          PDate,
          PBankName,
          PDocType,
          PProject,
          PCreatedAt
        FROM dbo.NewPayment
        ORDER BY PCreatedAt DESC
      `),

      // ── Recent Purchase Orders (last 5) ──────────────────────────────────────
      pool.request().query(`
        SELECT TOP 5
          po.PurchaseOrderID,
          po.PurchaseOrderNo,
          po.PODate,
          po.TotalAmount,
          po.Status,
          ah.LHeadName AS SupplierName,
          po.ItemDescription
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        ORDER BY po.PurchaseOrderID DESC
      `),
    ]);

    const p = paymentStats.recordset[0];
    const po = poStats.recordset[0];
    const g = grnStats.recordset[0];
    const ch = chequeStats.recordset[0];
    const pt = partyStats.recordset[0];

    res.json({
      payments: {
        totalCount: p.TotalCount,
        todayCount: p.TodayCount,
        totalAmount: parseFloat(p.TotalAmount),
        todayAmount: parseFloat(p.TodayAmount),
      },
      purchaseOrders: {
        totalCount: po.TotalCount,
        openCount: po.OpenCount,
        totalValue: parseFloat(po.TotalValue),
        openValue: parseFloat(po.OpenValue),
      },
      grns: {
        totalCount: g.TotalCount,
        thisMonthCount: g.ThisMonthCount,
      },
      cheques: {
        totalCount: ch.TotalCount,
        pendingCount: ch.PendingCount,
      },
      parties: {
        supplierCount: pt.SupplierCount,
        customerCount: pt.CustomerCount,
        activeGLCount: pt.ActiveGLCount,
      },
      recentPayments: recentPayments.recordset,
      recentPOs: recentPOs.recordset,
    });
  } catch (err) {
    console.error("FINANCE DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

