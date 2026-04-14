const express = require("express");
const router = express.Router();
const { getPool } = require("../db");

/**
 * GET /api/material-dashboard
 * Single round-trip for all Material Dashboard stats.
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const [itemStats, grnStats, poStats, woStats, recentGRNs, recentPOs] =
      await Promise.all([
        // Items + Groups
        pool.request().query(`
          SELECT
            COUNT(CASE WHEN Parent_Id IS NOT NULL OR M_IdentityCode = 1 THEN 1 END) AS ItemCount,
            COUNT(CASE WHEN Parent_Id IS NULL AND M_IdentityCode = 0 THEN 1 END)    AS GroupCount
          FROM dbo.Item_Master_Group
        `),

        // GRNs
        pool.request().query(`
          SELECT
            COUNT(*) AS TotalCount,
            COUNT(CASE WHEN YEAR(GRNDate)  = YEAR(GETDATE())
                        AND MONTH(GRNDate) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount,
            COUNT(CASE WHEN CAST(GRNDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) AS TodayCount
          FROM dbo.GoodsReceiptNotes
        `),

        // Purchase Orders
        pool.request().query(`
          SELECT
            COUNT(*)                                                          AS TotalCount,
            COUNT(CASE WHEN ISNULL(Status,'') != 'Closed' THEN 1 END)        AS OpenCount,
            ISNULL(SUM(CASE WHEN ISNULL(Status,'') != 'Closed'
                            THEN TotalAmount ELSE 0 END), 0)                  AS OpenValue
          FROM dbo.PurchaseOrders
        `),

        // Work Orders
        pool.request().query(`
          SELECT COUNT(*) AS TotalCount FROM dbo.WorkOrderHeader
        `),

        // Recent GRNs (last 5)
        pool.request().query(`
          SELECT TOP 5
            grn.GRNID, grn.GRNNo, grn.GRNDate, grn.Status,
            s.LHeadName AS SupplierName,
            p.PurchaseOrderNo AS PONumber
          FROM dbo.GoodsReceiptNotes grn
          LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
          LEFT JOIN dbo.PurchaseOrders    p ON p.PurchaseOrderID = grn.POID
          ORDER BY grn.GRNID DESC
        `),

        // Recent POs (last 5)
        pool.request().query(`
          SELECT TOP 5
            po.PurchaseOrderID, po.PurchaseOrderNo, po.PODate,
            po.TotalAmount, po.Status, po.ItemDescription,
            ah.LHeadName AS SupplierName
          FROM dbo.PurchaseOrders po
          LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID
          ORDER BY po.PurchaseOrderID DESC
        `),
      ]);

    const it = itemStats.recordset[0];
    const gr = grnStats.recordset[0];
    const po = poStats.recordset[0];
    const wo = woStats.recordset[0];

    res.json({
      items: { count: it.ItemCount, groupCount: it.GroupCount },
      grns: {
        total: gr.TotalCount,
        thisMonth: gr.ThisMonthCount,
        today: gr.TodayCount,
      },
      purchaseOrders: {
        total: po.TotalCount,
        open: po.OpenCount,
        openValue: parseFloat(po.OpenValue),
      },
      workOrders: { total: wo.TotalCount },
      recentGRNs: recentGRNs.recordset,
      recentPOs: recentPOs.recordset,
    });
  } catch (err) {
    console.error("MATERIAL DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
