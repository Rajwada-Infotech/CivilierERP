const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const { cache } = require("../middleware/cache");
const authMiddleware = require("../middleware/auth");

router.use(authMiddleware);

/**
 * GET /api/material-dashboard
 * Single round-trip for all Material Dashboard stats.
 * Covers: Items, GRNs, POs, Work Orders, Expenses, Stock, UOM, T&C
 */
router.get("/", cache("material-dashboard", 60), async (req, res) => {
  try {
    const pool = getPool();

    const [
      itemStats,
      grnStats,
      poStats,
      woStats,
      expenseStats,
      stockStats,
      uomStats,
      recentGRNs,
      recentPOs,
      recentWOs,
      recentExpenses,
      poStatusBreakdown,
      woStatusBreakdown,
      topItems,
    ] = await Promise.all([
      // ── Items + Groups ──────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(CASE WHEN Parent_Id IS NOT NULL OR M_IdentityCode = 1 THEN 1 END) AS ItemCount,
          COUNT(CASE WHEN Parent_Id IS NULL AND M_IdentityCode = 0 THEN 1 END)    AS GroupCount
        FROM dbo.Item_Master_Group
      `),

      // ── GRNs ────────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)  AS TotalCount,
          COUNT(CASE WHEN YEAR(GRNDate)  = YEAR(GETDATE())
                      AND MONTH(GRNDate) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount,
          COUNT(CASE WHEN CAST(GRNDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) AS TodayCount,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue,
          ISNULL(SUM(CASE WHEN YEAR(GRNDate) = YEAR(GETDATE())
                           AND MONTH(GRNDate) = MONTH(GETDATE())
                          THEN TotalAmount ELSE 0 END), 0) AS ThisMonthValue
        FROM dbo.GoodsReceiptNotes
      `),

      // ── Purchase Orders ──────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                             AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected') THEN 1 END) AS OpenCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Approved' THEN 1 END)         AS ApprovedCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Pending'  THEN 1 END)         AS PendingCount,
          ISNULL(SUM(TotalAmount), 0)                                          AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected')
                          THEN TotalAmount ELSE 0 END), 0)                    AS OpenValue
        FROM dbo.PurchaseOrders
      `),

      // ── Work Orders ──────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Cancelled') THEN 1 END) AS OpenCount,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue,
          COUNT(CASE WHEN YEAR(CreatedAt) = YEAR(GETDATE())
                      AND MONTH(CreatedAt) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount
        FROM dbo.WorkOrderHeader
      `),

      // ── Material Expenses ────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Pending'  THEN 1 END) AS PendingCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Approved' THEN 1 END) AS ApprovedCount,
          ISNULL(SUM(EAmount), 0) AS TotalAmount,
          ISNULL(SUM(CASE WHEN ISNULL(EStatus,'') = 'Pending' THEN EAmount ELSE 0 END), 0) AS PendingAmount
        FROM dbo.ExpenseBooking
      `),

      // ── Stock Ledger ─────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*) AS TotalEntries,
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE 0 END), 0) AS TotalIn,
          ISNULL(SUM(CASE WHEN Type='OUT' THEN Qty ELSE 0 END), 0) AS TotalOut,
          COUNT(DISTINCT ItemID) AS UniqueItems
        FROM dbo.StockLedger
      `),

      // ── UOM count ────────────────────────────────────────────────────
      pool.request().query(`
        SELECT COUNT(*) AS TotalUOM FROM dbo.UOMMaster
      `),

      // ── Recent GRNs (last 6) ─────────────────────────────────────────
      pool.request().query(`
        SELECT TOP 6
          grn.GRNID, grn.GRNNo, grn.GRNDate, grn.Status,
          grn.TotalAmount,
          s.LHeadName  AS SupplierName,
          p.PurchaseOrderNo AS PONumber
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders    p ON p.PurchaseOrderID = grn.POID
        ORDER BY grn.GRNID DESC
      `),

      // ── Recent POs (last 6) ──────────────────────────────────────────
      pool.request().query(`
        SELECT TOP 6
          po.PurchaseOrderID, po.PurchaseOrderNo, po.PODate,
          po.TotalAmount, po.Status,
          ah.LHeadName AS SupplierName,
          en.name      AS ProjectName
        FROM dbo.PurchaseOrders po
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
        LEFT JOIN dbo.enterprise        en ON en.id      = po.ProjectId
        ORDER BY po.PurchaseOrderID DESC
      `),

      // ── Recent Work Orders (last 6) ──────────────────────────────────
      pool.request().query(`
        SELECT TOP 6
          h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          ec.name AS CompanyName,
          ep.name AS ProjectName,
          con.LHeadName AS ContractorName
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id     = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id     = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster con ON con.LHeadId = h.ContractorId
        ORDER BY h.Id DESC
      `),

      // ── Recent Expenses (last 6) ─────────────────────────────────────
      pool.request().query(`
        SELECT TOP 6
          Eid, EDocNo, EDocDate, EAmount, EStatus,
          EProjectName, EDocumentType, ECreatedAt
        FROM dbo.ExpenseBooking
        ORDER BY Eid DESC
      `),

      // ── PO Status Breakdown ──────────────────────────────────────────
      pool.request().query(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.PurchaseOrders
        GROUP BY Status
      `),

      // ── WO Status Breakdown ──────────────────────────────────────────
      pool.request().query(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.WorkOrderHeader
        GROUP BY Status
      `),

      // ── Top 5 Items by GRN receipts ──────────────────────────────────
      pool.request().query(`
        SELECT TOP 5
          sl.ItemID,
          img.M_Name AS ItemName,
          SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END) AS TotalIn,
          SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END) AS TotalOut,
          SUM(CASE WHEN sl.Type='IN'  THEN sl.Qty ELSE 0 END) -
          SUM(CASE WHEN sl.Type='OUT' THEN sl.Qty ELSE 0 END) AS NetStock
        FROM dbo.StockLedger sl
        LEFT JOIN dbo.Item_Master_Group img ON img.M_Code = sl.ItemID
        GROUP BY sl.ItemID, img.M_Name
        ORDER BY TotalIn DESC
      `),
    ]);

    // ?? {} guards against empty tables returning undefined for recordset[0]
    const it = itemStats.recordset[0] ?? {};
    const gr = grnStats.recordset[0] ?? {};
    const po = poStats.recordset[0] ?? {};
    const wo = woStats.recordset[0] ?? {};
    const ex = expenseStats.recordset[0] ?? {};
    const st = stockStats.recordset[0] ?? {};
    const um = uomStats.recordset[0] ?? {};

    res.json({
      items: {
        count: it.ItemCount ?? 0,
        groupCount: it.GroupCount ?? 0,
      },
      grns: {
        total: gr.TotalCount ?? 0,
        thisMonth: gr.ThisMonthCount ?? 0,
        today: gr.TodayCount ?? 0,
        totalValue: parseFloat(gr.TotalValue ?? 0),
        thisMonthValue: parseFloat(gr.ThisMonthValue ?? 0),
      },
      purchaseOrders: {
        total: po.TotalCount ?? 0,
        open: po.OpenCount ?? 0,
        approved: po.ApprovedCount ?? 0,
        pending: po.PendingCount ?? 0,
        totalValue: parseFloat(po.TotalValue ?? 0),
        openValue: parseFloat(po.OpenValue ?? 0),
      },
      workOrders: {
        total: wo.TotalCount ?? 0,
        open: wo.OpenCount ?? 0,
        thisMonth: wo.ThisMonthCount ?? 0,
        totalValue: parseFloat(wo.TotalValue ?? 0),
      },
      expenses: {
        total: ex.TotalCount ?? 0,
        pending: ex.PendingCount ?? 0,
        approved: ex.ApprovedCount ?? 0,
        totalAmount: parseFloat(ex.TotalAmount ?? 0),
        pendingAmount: parseFloat(ex.PendingAmount ?? 0),
      },
      stock: {
        totalEntries: st.TotalEntries ?? 0,
        totalIn: parseFloat(st.TotalIn ?? 0),
        totalOut: parseFloat(st.TotalOut ?? 0),
        uniqueItems: st.UniqueItems ?? 0,
      },
      uom: { total: um.TotalUOM ?? 0 },
      recentGRNs: recentGRNs.recordset,
      recentPOs: recentPOs.recordset,
      recentWOs: recentWOs.recordset,
      recentExpenses: recentExpenses.recordset,
      poStatusBreakdown: poStatusBreakdown.recordset,
      woStatusBreakdown: woStatusBreakdown.recordset,
      topItems: topItems.recordset,
    });
  } catch (err) {
    console.error("MATERIAL DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
