const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool } = require("../db");
const { multiMrReady } = require("../services/poMrLinks");
const { projectPredicate, ebResolvedProjectSql } = require("../services/projectScope");
const { redisGet, redisSet } = require("../redis");
const { checkPermissionForMethod } = require("../middleware/routePermission");

// SubModule is "MaterialDashboard", not the bare "Dashboard" — checkPermission's
// RoleRights lookup is an exact Module/SubModule match with no translation,
// but getCandidatePageKeys() (used when *saving*/reading the "material-dashboard"
// page-key grant via Menu Rights) always adds kebab(subModule) as a fallback
// candidate no matter what. A bare "Dashboard" SubModule would make that
// fallback resolve to the literal page key "dashboard" — silently also
// granting the unrelated Home Dashboard to anyone given Material Dashboard
// access. Same collision class fixed for Engineering Dashboard earlier.
router.use(checkPermissionForMethod("Material", "MaterialDashboard"));

// ── The document pipeline: MR → PO → GRN → invoice ─────────────────────────────────────────────────────────────────
// Three figures per document, each the set of records a person has to act on:
//   unapproved — not approved yet (drafts and those waiting for approval);
//   pending    — approved, but the next document isn't made: an MR with no PO, a PO with no GRN, a GRN with no invoice;
//   overdue    — late: an MR past its required-by date and not fully ordered, a PO past its expected delivery date and
//                not fully received, a GRN not invoiced GRN_INVOICE_DAYS after it was received.
// The same WHERE clauses feed the counts (GET /) and the records each figure opens (GET /pipeline/:key).
const GRN_INVOICE_DAYS = 7;
const TODAY = "CAST(GETDATE() AS DATE)";
const LIVE_PO = "ISNULL(p2.Status,'') NOT IN ('Rejected','Cancelled')";
// /*MRPO*/ becomes the PurchaseOrderMRs check (a PO merging several MRs, migration 585) once that table exists.
const MR_HAS_PO = `(EXISTS (SELECT 1 FROM dbo.PurchaseOrders p2 WHERE p2.SourceMRId = mr.MRId AND ${LIVE_PO})
  /*MRPO*/
  OR EXISTS (SELECT 1 FROM dbo.PurchaseOrders p2 JOIN dbo.Quotations q2 ON q2.QuotationId = p2.SourceQTId
             WHERE q2.SourceMRId = mr.MRId AND ${LIVE_PO}))`;
const GRN_HAS_INVOICE = `(EXISTS (SELECT 1 FROM dbo.ExpenseBooking e2
    WHERE ISNULL(e2.EStatus,'') NOT IN ('Deleted','Rejected')
      AND ((e2.ESourceType = 'GRN' AND TRY_CAST(e2.ESourceId AS INT) = g.GRNID)
        OR (e2.ESourceType IN ('PO','WO_PO') AND g.POID IS NOT NULL AND TRY_CAST(e2.ESourceId AS INT) = g.POID))))`;
const PIPELINE = {
  "mr-unapproved": { table: "mr", where: "ISNULL(mr.Status,'') IN ('','Draft','Pending')" },
  "mr-pending": { table: "mr", where: `mr.Status = 'Approved' AND NOT ${MR_HAS_PO}` },
  "mr-overdue": {
    table: "mr",
    where: `mr.RequiredByDate < ${TODAY} AND mr.ShortClosedAt IS NULL
      AND ISNULL(mr.Status,'') IN ('','Draft','Pending','Approved','Partially Fulfilled','Partially Ordered')`,
  },
  "po-unapproved": { table: "po", where: "ISNULL(po.Status,'') IN ('','Draft','Pending')" },
  "po-pending": {
    table: "po",
    where: "po.Status = 'Approved' AND NOT EXISTS (SELECT 1 FROM dbo.GoodsReceiptNotes g2 WHERE g2.POID = po.PurchaseOrderID AND ISNULL(g2.Status,'') <> 'Rejected')",
  },
  "po-overdue": {
    table: "po",
    where: `po.ExpectedDeliveryDate < ${TODAY} AND ISNULL(po.Status,'') NOT IN ('Received','Closed','Rejected','Cancelled')`,
  },
  "grn-unapproved": { table: "grn", where: "ISNULL(g.Status,'') IN ('','Draft','Pending')" },
  "grn-pending": { table: "grn", where: `g.Status = 'Approved' AND NOT ${GRN_HAS_INVOICE}` },
  "grn-overdue": {
    table: "grn",
    where: `g.Status = 'Approved' AND NOT ${GRN_HAS_INVOICE} AND CAST(g.GRNDate AS DATE) < DATEADD(DAY, -${GRN_INVOICE_DAYS}, ${TODAY})`,
  },
};
// Per table: the FROM, its project-scope filter, and the columns the opened list shows.
const PIPELINE_TABLES = {
  mr: {
    from: "dbo.MaterialRequests mr LEFT JOIN dbo.enterprise ep ON ep.id = mr.ProjectId",
    scope: (scope) => projectPredicate(scope, "mr.ProjectId"),
    cols: `mr.MRId AS Id, mr.DocNo, mr.RequestDate AS DocDate, mr.RequiredByDate AS DueDate, mr.Status, ep.name AS ProjectName,
           CAST(NULL AS NVARCHAR(200)) AS PartyName, CAST(NULL AS DECIMAL(18,2)) AS Amount`,
    order: "mr.RequiredByDate, mr.MRId",
  },
  po: {
    from: `dbo.PurchaseOrders po LEFT JOIN dbo.enterprise ep ON ep.id = po.ProjectId
           LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = po.SupplierID`,
    scope: (scope) => projectPredicate(scope, "po.ProjectId"),
    cols: `po.PurchaseOrderID AS Id, COALESCE(po.DocNo, po.PurchaseOrderNo) AS DocNo, po.PODate AS DocDate,
           po.ExpectedDeliveryDate AS DueDate, po.Status, ep.name AS ProjectName,
           ISNULL(ah.DisplayName, ah.LHeadName) AS PartyName, po.TotalAmount AS Amount`,
    order: "po.ExpectedDeliveryDate, po.PurchaseOrderID",
  },
  grn: {
    from: `dbo.GoodsReceiptNotes g LEFT JOIN dbo.PurchaseOrders gp ON gp.PurchaseOrderID = g.POID
           LEFT JOIN dbo.enterprise ep ON ep.id = gp.ProjectId
           LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = g.SupplierID`,
    scope: (scope) => (scope ? ` AND g.POID IN (SELECT PurchaseOrderID FROM dbo.PurchaseOrders WHERE 1=1${projectPredicate(scope, "ProjectId")})` : ""),
    cols: `g.GRNID AS Id, COALESCE(g.DocNo, g.GRNNo) AS DocNo, g.GRNDate AS DocDate,
           DATEADD(DAY, ${GRN_INVOICE_DAYS}, CAST(g.GRNDate AS DATE)) AS DueDate, g.Status, ep.name AS ProjectName,
           ISNULL(ah.DisplayName, ah.LHeadName) AS PartyName, g.TotalAmount AS Amount`,
    order: "g.GRNDate, g.GRNID",
  },
};
const pipelineSql = (key, scope, select, multiMr = false) => {
  const p = PIPELINE[key];
  const t = PIPELINE_TABLES[p.table];
  const where = p.where.replace(
    "/*MRPO*/",
    multiMr ? `OR EXISTS (SELECT 1 FROM dbo.PurchaseOrderMRs pm JOIN dbo.PurchaseOrders p2 ON p2.PurchaseOrderID = pm.PurchaseOrderID
                 WHERE pm.MRId = mr.MRId AND ${LIVE_PO})` : "",
  );
  return `SELECT ${select ?? t.cols} FROM ${t.from} WHERE (${where})${t.scope(scope)}`;
};

// GET /pipeline/:key — the records behind one pipeline figure (most overdue / oldest first).
router.get("/pipeline/:key", async (req, res) => {
  const key = req.params.key;
  if (!PIPELINE[key]) return res.status(404).json({ error: "Unknown figure" });
  try {
    const r = await getPool().request()
      .query(`${pipelineSql(key, req.projectScope, undefined, await multiMrReady(getPool()))} ORDER BY ${PIPELINE_TABLES[PIPELINE[key].table].order}`);
    res.json(r.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    // Project scoping: a restricted user's figures cover only their projects, so
    // the cached payload is kept per scope — never shared with other scopes.
    const scope = req.projectScope;
    const CACHE_KEY = scope
      ? `material_dashboard:ps${[...scope].map(Number).sort((a, b) => a - b).join("-")}`
      : "material_dashboard";
    const poP = projectPredicate(scope, "ProjectId");
    const woP = projectPredicate(scope, "ProjectId");
    const poAliasP = (a) => projectPredicate(scope, `${a}.ProjectId`);
    const grnP = (col) => (scope ? ` AND ${col} IN (SELECT PurchaseOrderID FROM dbo.PurchaseOrders WHERE 1=1${projectPredicate(scope, "ProjectId")})` : "");
    const ebP = projectPredicate(scope, ebResolvedProjectSql("eb"));
    const slP = (col) => (scope ? ` AND ${col} IN (SELECT GodownID FROM dbo.Godowns WHERE 1=1${projectPredicate(scope, "ProjectID")})` : "");
    const CACHE_TTL = 60;
    try {
      const cached = await redisGet(CACHE_KEY);
      if (cached) return res.json(JSON.parse(cached));
    } catch (_) {}

    const pool = getPool();
    const multiMr = await multiMrReady(pool);

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
      pipelineStats,
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
          ISNULL(SUM(CASE WHEN YEAR(GRNDate)  = YEAR(GETDATE())
                           AND MONTH(GRNDate) = MONTH(GETDATE()) THEN TotalAmount ELSE 0 END), 0) AS ThisMonthValue,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected')
                          THEN TotalAmount ELSE 0 END), 0) AS OpenValue
        FROM dbo.GoodsReceiptNotes
        WHERE 1=1${grnP("POID")}
      `),

      // ── Purchase Orders ──────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*)                                                                     AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected','Received','Cancelled') THEN 1 END) AS OpenCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Approved' THEN 1 END)                  AS ApprovedCount,
          COUNT(CASE WHEN ISNULL(Status,'') = 'Pending'  THEN 1 END)                  AS PendingCount,
          ISNULL(SUM(TotalAmount), 0)                                                  AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'') NOT IN ('Closed','Rejected','Received','Cancelled')
                          THEN TotalAmount ELSE 0 END), 0)                             AS OpenValue
        FROM dbo.PurchaseOrders
        WHERE 1=1${poP}
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
        WHERE 1=1${woP}
      `),

      // ── Material Expenses ────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Pending'  THEN 1 END) AS PendingCount,
          COUNT(CASE WHEN ISNULL(EStatus,'') = 'Approved' THEN 1 END) AS ApprovedCount,
          ISNULL(SUM(EAmount), 0) AS TotalAmount,
          ISNULL(SUM(CASE WHEN ISNULL(EStatus,'') = 'Pending' THEN EAmount ELSE 0 END), 0) AS PendingAmount
        FROM dbo.ExpenseBooking eb
        WHERE 1=1${ebP}
      `),

      // ── Stock Ledger ─────────────────────────────────────────────────
      safeQuery(`
        SELECT
          COUNT(*) AS TotalEntries,
          ISNULL(SUM(CASE WHEN Type='IN'  THEN Qty ELSE 0 END), 0) AS TotalIn,
          ISNULL(SUM(CASE WHEN Type='OUT' THEN Qty ELSE 0 END), 0) AS TotalOut,
          COUNT(DISTINCT ItemID) AS UniqueItems
        FROM dbo.StockLedger
        WHERE 1=1${slP("GodownID")}
      `),

      // ── UOM count ────────────────────────────────────────────────────
      safeQuery(`
        SELECT COUNT(*) AS TotalUOM FROM dbo.UOMMaster
      `),

      // ── Recent GRNs (last 6) ─────────────────────────────────────────
      safeQuery(`
        SELECT TOP 6
          grn.GRNID,
          grn.GRNNo,
          grn.GRNDate,
          grn.TotalAmount,
          grn.Status,
          grn.Remarks,
          grn.CreatedDate,
          ISNULL(s.LHeadName, 'N/A')       AS SupplierName,
          ISNULL(p.PurchaseOrderNo, 'N/A') AS PONumber
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId        = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders    p ON p.PurchaseOrderID = grn.POID
        WHERE 1=1${grnP("grn.POID")}
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
        WHERE 1=1${poAliasP("po")}
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
        WHERE 1=1${poAliasP("h")}
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
          ISNULL(pj.name, eb.EProjectName) AS EProjectName, eb.EDocumentType, eb.ESourceType, eb.ECreatedAt,
          ah.LHeadName AS SupplierName
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = eb.LHeadId
        LEFT JOIN dbo.enterprise pj ON pj.id = ${ebResolvedProjectSql("eb")}
        WHERE ISNULL(eb.EStatus, '') != 'Draft'${ebP}
        ORDER BY eb.Eid DESC
      `),

      // ── PO Status Breakdown ──────────────────────────────────────────
      safeQuery(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.PurchaseOrders
        WHERE 1=1${poP}
        GROUP BY Status
      `),

      // ── WO Status Breakdown ──────────────────────────────────────────
      safeQuery(`
        SELECT
          ISNULL(Status, 'Draft') AS Status,
          COUNT(*) AS Count,
          ISNULL(SUM(TotalAmount), 0) AS TotalValue
        FROM dbo.WorkOrderHeader
        WHERE 1=1${woP}
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
        LEFT JOIN dbo.Item_Master_Group img ON img.M_Id = sl.ItemID
        WHERE 1=1${slP("sl.GodownID")}
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
          ISNULL((SELECT SUM(mii.Quantity) FROM dbo.MaterialIssueItems mii WHERE mii.IssueId IN (SELECT mx.IssueId FROM dbo.MaterialIssues mx WHERE 1=1${projectPredicate(scope, "mx.ProjectId")})), 0) AS TotalQty
        FROM dbo.MaterialIssues mi
        WHERE 1=1${poAliasP("mi")}
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
        WHERE 1=1${poP}
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
        WHERE 1=1${poAliasP("mi")}
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
        WHERE 1=1${poAliasP("mr")}
        ORDER BY mr.CreatedAt DESC
      `),

      // ── GRN value — daily totals, last 14 days ─────────────────────────
      safeQuery(`
        SELECT
          CAST(GRNDate AS DATE)   AS Day,
          ISNULL(SUM(TotalAmount), 0) AS Amount
        FROM dbo.GoodsReceiptNotes
        WHERE CAST(GRNDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))${grnP("POID")}
        GROUP BY CAST(GRNDate AS DATE)
      `),

      // ── PO value — daily totals, last 14 days ──────────────────────────
      safeQuery(`
        SELECT
          CAST(PODate AS DATE)    AS Day,
          ISNULL(SUM(TotalAmount), 0) AS Amount
        FROM dbo.PurchaseOrders
        WHERE CAST(PODate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))${poP}
        GROUP BY CAST(PODate AS DATE)
      `),

      // ── The document pipeline (see PIPELINE above) ─────────────────────
      safeQuery(`SELECT ${Object.keys(PIPELINE)
        .map((k) => `(SELECT COUNT(*) FROM (${pipelineSql(k, scope, "1 AS x", multiMr)}) c) AS [${k}]`)
        .join(", ")}`),
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
        thisMonthValue: parseFloat(gr.ThisMonthValue ?? 0),
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
      // null when the pipeline query failed, so the page can say so rather than show zeros.
      pipeline: pipelineStats?.recordset[0] ?? null,
      grnInvoiceDays: GRN_INVOICE_DAYS,
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
