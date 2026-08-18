const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const { redisGet, redisSet } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Material", "Dashboard"));

router.get("/", async (req, res) => {
  try {
    const CACHE_KEY = "material_dashboard";
    const CACHE_TTL = 60;
    try {
      const cached = await redisGet(CACHE_KEY);
      if (cached) return res.json(JSON.parse(cached));
    } catch (_) {}

    const pool = getPool();

    const safeQuery = async (sql) => {
      try {
        return await pool.request().query(sql);
      } catch (err) {
        console.error(
          "MATERIAL DASHBOARD QUERY ERROR:",
          err.message,
          "\nSQL:",
          sql.trim().slice(0, 120),
        );
        return null;
      }
    };

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
      materialIssueStats,
      materialRequestStats,
      recentIssues,
      recentRequests,
      grnTimeline,
      poTimeline,
    ] = await Promise.all([
      // ── Items + Groups ──────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(CASE WHEN Parent_Id IS NOT NULL OR M_IdentityCode = 1 THEN 1 END) AS ItemCount,
          COUNT(CASE WHEN Parent_Id IS NULL AND M_IdentityCode = 0 THEN 1 END)    AS GroupCount
        FROM dbo.Item_Master_Group
      `),

      // ── GRNs ────────────────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN YEAR(GRNDate)  = YEAR(GETDATE())
                      AND MONTH(GRNDate) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount,
          COUNT(CASE WHEN CAST(GRNDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) AS TodayCount,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected')
                          THEN TotalAmount ELSE 0 END), 0) AS OpenValue
        FROM dbo.GoodsReceiptNotes
      `),

      // ── Purchase Orders ──────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*)                                                                     AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected') THEN 1 END)  AS OpenCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Approved' THEN 1 END)                  AS ApprovedCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Pending'  THEN 1 END)                  AS PendingCount,
          ISNULL(SUM(TotalAmount), 0)                                                  AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected')
                          THEN TotalAmount ELSE 0 END), 0)                             AS OpenValue
        FROM dbo.PurchaseOrders
      `),

      // ── Work Orders ──────────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Cancelled') THEN 1 END) AS OpenCount,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue,
          COUNT(CASE WHEN YEAR(CreatedAt) = YEAR(GETDATE())
                      AND MONTH(CreatedAt) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount
        FROM dbo.WorkOrderHeader
      `),

      // ── Material Expenses ────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Pending'  THEN 1 END) AS PendingCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Approved' THEN 1 END) AS ApprovedCount,
          ISNULL(SUM(EAmount), 0) AS TotalAmount,
          ISNULL(SUM(CASE WHEN ISNULL(EStatus,'') = 'Pending' THEN EAmount ELSE 0 END), 0) AS PendingAmount
        FROM dbo.ExpenseBooking
      `),

      // ── Stock Ledger ─────────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalEntries,
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE 0 END), 0) AS TotalIn,
          ISNULL(SUM(CASE WHEN Type='OUT' THEN Qty ELSE 0 END), 0) AS TotalOut,
          COUNT(DISTINCT ItemID) AS UniqueItems
        FROM dbo.StockLedger
      `),

      // ── UOM count ────────────────────────────────────────────────────
      safeQuery(`
        SELECT COUNT(*) AS TotalUOM FROM dbo.UOMMaster
      `),

      // ── Recent GRNs (last 6) ─────────────────────────────────────────
      // FIX: removed TotalAmount (column doesn't exist), use correct POID casing
      safeQuery(`
        SELECT TOP 6
          grn.GRNID,
          grn.GRNNo,
          grn.GRNDate,
          grn.Status,
          grn.Remarks,
          grn.CreatedDate,
          ISNULL(s.LHeadName, 'N/A')       AS SupplierName,
          ISNULL(p.PurchaseOrderNo, 'N/A') AS PONumber
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId        = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders    p ON p.PurchaseOrderID = grn.POID
        ORDER BY grn.GRNID DESC
      `),

      // ── Recent POs (last 6) ──────────────────────────────────────────
      safeQuery(`
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
      safeQuery(`
        SELECT TOP 6
          h.Id, h.DocumentNumber, h.DocumentDate, h.TotalAmount, h.Status,
          ec.name AS CompanyName,
          ep.name AS ProjectName,
          con.LHeadName AS ContractorName
        FROM dbo.WorkOrderHeader h
        LEFT JOIN dbo.enterprise        ec  ON ec.id       = h.CompanyId
        LEFT JOIN dbo.enterprise        ep  ON ep.id       = h.ProjectId
        LEFT JOIN dbo.AccountHeadMaster con ON con.LHeadId = h.ContractorId
        ORDER BY h.Id DESC
      `),

      // ── Recent Expenses (last 6) ─────────────────────────────────────
      // ESourceType='TOD' identifies "Other Expenses" (direct, no linked
      // PO/GRN/WO) — EDocumentType is unreliable for this (sometimes holds
      // a doc-type code like "INV-2026-00001" instead of the source kind).
      // LHeadId is the supplier/contractor tagged directly on a TOD booking
      // (no source document to derive it from otherwise).
      safeQuery(`
        SELECT TOP 6
          eb.Eid, eb.EDocNo, eb.EDocDate, eb.EAmount, eb.EStatus,
          eb.EProjectName, eb.EDocumentType, eb.ESourceType, eb.ECreatedAt,
          ah.LHeadName AS SupplierName
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = eb.LHeadId
        WHERE ISNULL(eb.EStatus, '') != 'Draft'
        ORDER BY eb.Eid DESC
      `),

      // ── PO Status Breakdown ──────────────────────────────────────────
      safeQuery(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.PurchaseOrders
        GROUP BY Status
      `),

      // ── WO Status Breakdown ──────────────────────────────────────────
      safeQuery(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.WorkOrderHeader
        GROUP BY Status
      `),

      // ── Top 5 Items by stock ──────────────────────────────────────────
      safeQuery(`
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

      // ── Material Issues ───────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN YEAR(CreatedAt) = YEAR(GETDATE())
                      AND MONTH(CreatedAt) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount,
          COUNT(CASE WHEN CAST(CreatedAt AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) AS TodayCount,
          ISNULL((SELECT SUM(mii.Quantity) FROM dbo.MaterialIssueItems mii), 0) AS TotalQty
        FROM dbo.MaterialIssues mi
      `),

      // ── Material Requests ─────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Pending'           THEN 1 END) AS PendingCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Approved'          THEN 1 END) AS ApprovedCount,
          COUNT(CASE WHEN ISNULL(Status,'') IN ('Draft','')        THEN 1 END) AS DraftCount,
          COUNT(CASE WHEN ISNULL(Status,'') IN ('Ordered','Completed') THEN 1 END) AS OrderedCount,
          COUNT(CASE WHEN ISNULL(Status,'') IN ('Partially Ordered','Partially Fulfilled') THEN 1 END) AS PartiallyOrderedCount,
          COUNT(CASE WHEN YEAR(CreatedAt) = YEAR(GETDATE())
                      AND MONTH(CreatedAt) = MONTH(GETDATE()) THEN 1 END) AS ThisMonthCount
        FROM dbo.MaterialRequests
      `),

      // ── Recent Issues (last 6) ────────────────────────────────────────
      safeQuery(`
        SELECT TOP 6
          mi.IssueId, mi.DocNo, mi.IssueNo, mi.Date AS IssueDate,
          mi.Status, mi.Reason,
          ec.name AS CompanyName,
          ep.name AS ProjectName,
          (SELECT COUNT(*) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId = mi.IssueId) AS ItemCount
        FROM dbo.MaterialIssues mi
        LEFT JOIN dbo.enterprise ec ON ec.id = mi.CompanyId
        LEFT JOIN dbo.enterprise ep ON ep.id = mi.ProjectId
        ORDER BY mi.CreatedAt DESC
      `),

      // ── Recent Requests (last 6) ──────────────────────────────────────
      safeQuery(`
        SELECT TOP 6
          mr.MRId, mr.DocNo, mr.RequestDate, mr.Status, mr.Priority, mr.Reason,
          ec.name AS CompanyName,
          ep.name AS ProjectName,
          (SELECT COUNT(*) FROM dbo.MaterialRequestItems mri WHERE mri.MRId = mr.MRId) AS ItemCount
        FROM dbo.MaterialRequests mr
        LEFT JOIN dbo.enterprise ec ON ec.id = mr.CompanyId
        LEFT JOIN dbo.enterprise ep ON ep.id = mr.ProjectId
        ORDER BY mr.CreatedAt DESC
      `),

      // ── GRN value — daily totals, last 14 days ─────────────────────────
      safeQuery(`
        SELECT
          CAST(GRNDate AS DATE)   AS Day,
          ISNULL(SUM(TotalAmount), 0) AS Amount
        FROM dbo.GoodsReceiptNotes
        WHERE CAST(GRNDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(GRNDate AS DATE)
      `),

      // ── PO value — daily totals, last 14 days ──────────────────────────
      safeQuery(`
        SELECT
          CAST(PODate AS DATE)    AS Day,
          ISNULL(SUM(TotalAmount), 0) AS Amount
        FROM dbo.PurchaseOrders
        WHERE CAST(PODate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(PODate AS DATE)
      `),
    ]);

    const it = itemStats?.recordset[0] ?? {};
    const gr = grnStats?.recordset[0] ?? {};
    const po = poStats?.recordset[0] ?? {};
    const wo = woStats?.recordset[0] ?? {};
    const ex = expenseStats?.recordset[0] ?? {};
    const st = stockStats?.recordset[0] ?? {};
    const um = uomStats?.recordset[0] ?? {};
    const mi = materialIssueStats?.recordset[0] ?? {};
    const mr = materialRequestStats?.recordset[0] ?? {};

    // Zero-fill all 14 days — the GROUP BY queries above only return days
    // that actually had a GRN/PO, so gaps would otherwise break the line.
    const grnByDay = new Map(
      (grnTimeline?.recordset ?? []).map((r) => [r.Day.toISOString().slice(0, 10), parseFloat(r.Amount)]),
    );
    const poByDay = new Map(
      (poTimeline?.recordset ?? []).map((r) => [r.Day.toISOString().slice(0, 10), parseFloat(r.Amount)]),
    );
    const timeline = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      timeline.push({
        date: key,
        grn: grnByDay.get(key) ?? 0,
        po: poByDay.get(key) ?? 0,
      });
    }

    const responseObj = {
      items: {
        count: it.ItemCount ?? 0,
        groupCount: it.GroupCount ?? 0,
      },
      grns: {
        total: gr.TotalCount ?? 0,
        thisMonth: gr.ThisMonthCount ?? 0,
        today: gr.TodayCount ?? 0,
        totalValue: parseFloat(gr.TotalValue ?? 0),
        openValue: parseFloat(gr.OpenValue ?? 0),
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
      recentGRNs: recentGRNs?.recordset ?? [],
      recentPOs: recentPOs?.recordset ?? [],
      recentWOs: recentWOs?.recordset ?? [],
      recentExpenses: recentExpenses?.recordset ?? [],
      poStatusBreakdown: poStatusBreakdown?.recordset ?? [],
      woStatusBreakdown: woStatusBreakdown?.recordset ?? [],
      topItems: topItems?.recordset ?? [],
      materialIssues: {
        total: mi.TotalCount ?? 0,
        thisMonth: mi.ThisMonthCount ?? 0,
        today: mi.TodayCount ?? 0,
        totalQty: parseFloat(mi.TotalQty ?? 0),
      },
      materialRequests: {
        total: mr.TotalCount ?? 0,
        pending: mr.PendingCount ?? 0,
        approved: mr.ApprovedCount ?? 0,
        draft: mr.DraftCount ?? 0,
        ordered: mr.OrderedCount ?? 0,
        partiallyOrdered: mr.PartiallyOrderedCount ?? 0,
        thisMonth: mr.ThisMonthCount ?? 0,
      },
      recentIssues: recentIssues?.recordset ?? [],
      recentRequests: recentRequests?.recordset ?? [],
      timeline,
    };

    try {
      await redisSet(CACHE_KEY, JSON.stringify(responseObj), CACHE_TTL);
    } catch (_) {}

    res.json(responseObj);
  } catch (err) {
    console.error("MATERIAL DASHBOARD FATAL ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
