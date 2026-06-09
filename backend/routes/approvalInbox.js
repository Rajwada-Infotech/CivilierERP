const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const logger = require("../logger");
const { getPool, sql } = require("../db");

router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const { module } = req.query;

    const queries = [];

    if (!module || module === "purchase-orders") {
      queries.push(`
        SELECT
          'purchase-orders'        AS Module,
          'Purchase Order'         AS ModuleLabel,
          CAST(PurchaseOrderID AS NVARCHAR) AS RecordId,
          PurchaseOrderNo          AS Reference,
          PODate                   AS RecordDate,
          Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CAST(NULL AS NVARCHAR)   AS SupplierName,
          TotalAmount              AS Amount,
          CreatedBy,
          ISNULL(ApprovedBy, '')   AS ApprovedBy,
          ISNULL(CAST(ApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ISNULL(RejectedBy, '')   AS RejectedBy,
          ISNULL(RejectionNote, '') AS RejectionNote,
          UpdatedAt                AS LastModified
        FROM dbo.PurchaseOrders
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "work-orders") {
      queries.push(`
        SELECT
          'work-orders'            AS Module,
          'Work Order'             AS ModuleLabel,
          CAST(Id AS NVARCHAR)     AS RecordId,
          DocumentNumber           AS Reference,
          DocumentDate             AS RecordDate,
          Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CAST(NULL AS NVARCHAR)   AS SupplierName,
          TotalAmount              AS Amount,
          CreatedBy,
          ISNULL(ApprovedBy, '')   AS ApprovedBy,
          ISNULL(CAST(ApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ISNULL(RejectedBy, '')   AS RejectedBy,
          ISNULL(RejectionNote, '') AS RejectionNote,
          UpdatedAt                AS LastModified
        FROM dbo.WorkOrderHeader
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "payments") {
      queries.push(`
        SELECT
          'payments'               AS Module,
          'Payment'                AS ModuleLabel,
          CAST(PPaymentID AS NVARCHAR) AS RecordId,
          PPaymentName             AS Reference,
          PDate                    AS RecordDate,
          ISNULL(Status, 'Draft')  AS Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CAST(NULL AS NVARCHAR)   AS SupplierName,
          PAmount                  AS Amount,
          PCreatedBy               AS CreatedBy,
          ISNULL(PApprovedBy, '')  AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          CAST(NULL AS DATETIME2)  AS LastModified
        FROM dbo.NewPayment
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "received-payment") {
      queries.push(`
        SELECT
          'received-payment'                    AS Module,
          'Received Payment'                    AS ModuleLabel,
          CAST(RPPaymentID AS NVARCHAR)         AS RecordId,
          ISNULL(RPDocNo, CONCAT('REC/', CAST(RPPaymentID AS NVARCHAR))) AS Reference,
          RPDocDate                             AS RecordDate,
          ISNULL(RPStatus, 'Draft')             AS Status,
          CAST(NULL AS NVARCHAR)                 AS ContractorName,
          ISNULL(RPCustomerName, RPReceivedFrom) AS SupplierName,
          RPAmount                              AS Amount,
          RPCreatedBy                           AS CreatedBy,
          ISNULL(RPApprovedBy, '')              AS ApprovedBy,
          ISNULL(CAST(RPApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ISNULL(RPRejectedBy, '')              AS RejectedBy,
          ISNULL(RPRejectionNote, '')           AS RejectionNote,
          RPUpdatedAt                           AS LastModified
        FROM dbo.ReceivedPayment
        WHERE RPStatus = 'Pending'
      `);
    }

    // KEY FIX: module key is 'goods-receipt' (matches approvalService TABLE_REGISTRY)
    // ApprovalActions will call /api/grns/:id/approve|reject which is correct
    // But the Module field sent to frontend must match what ApprovalActions uses as endpoint prefix
    if (!module || module === "goods-receipt") {
      queries.push(`
        SELECT
          'goods-receipt'                           AS Module,
          'GRN'                                     AS ModuleLabel,
          CAST(grn.GRNID AS NVARCHAR)               AS RecordId,
          ISNULL(grn.DocNo, grn.GRNNo)              AS Reference,
          grn.GRNDate                               AS RecordDate,
          ISNULL(grn.Status, 'Draft')               AS Status,
          CAST(NULL AS NVARCHAR)                     AS ContractorName,
          s.LHeadName                               AS SupplierName,
          grn.TotalAmount                           AS Amount,
          ISNULL(po.PurchaseOrderNo, '')            AS CreatedBy,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ), '')                                    AS ApprovedBy,
          ISNULL(CAST((
            SELECT TOP 1 ActionAt
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Approved'
            ORDER BY ActionAt DESC
          ) AS NVARCHAR), '')                       AS ApprovedAt,
          ISNULL((
            SELECT TOP 1 ApproverEmail
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                    AS RejectedBy,
          ISNULL((
            SELECT TOP 1 Note
            FROM dbo.ApprovalAuditLog
            WHERE TableName = 'dbo.GoodsReceiptNotes'
              AND RecordId = grn.GRNID
              AND ActionStatus = 'Rejected'
            ORDER BY ActionAt DESC
          ), '')                                    AS RejectionNote,
          grn.UpdatedAt                           AS LastModified
        FROM dbo.GoodsReceiptNotes grn
        LEFT JOIN dbo.AccountHeadMaster s ON s.LHeadId = grn.SupplierID
        LEFT JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
        WHERE grn.Status = 'Pending'
      `);
    }

    if (!module || module === "expense-booking") {
      queries.push(`
        SELECT
          'expense-booking'        AS Module,
          'Expense Booking'        AS ModuleLabel,
          CAST(eb.Eid AS NVARCHAR) AS RecordId,
          ISNULL(eb.EDocNo, CONCAT('EB#', CAST(eb.Eid AS NVARCHAR))) AS Reference,
          eb.EDocDate              AS RecordDate,
          ISNULL(eb.EStatus, 'Draft') AS Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CASE
            WHEN eb.ESourceType = 'GRN' AND grn_eb.GRNID IS NOT NULL THEN ISNULL(ahm_eb.LHeadName, eb.EName)
            ELSE eb.EName
          END                      AS SupplierName,
          ISNULL(eb.ENetAmount, eb.EAmount) AS Amount,
          CAST(eb.ECreatedBy AS NVARCHAR) AS CreatedBy,
          ISNULL(CAST(eb.EApprovedBy AS NVARCHAR), '') AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          eb.EUpdatedAt            AS LastModified
        FROM dbo.ExpenseBooking eb
        LEFT JOIN dbo.GoodsReceiptNotes grn_eb
          ON eb.ESourceType = 'GRN' AND grn_eb.GRNID = TRY_CAST(eb.ESourceId AS INT)
        LEFT JOIN dbo.AccountHeadMaster ahm_eb
          ON ahm_eb.LHeadId = grn_eb.SupplierID
        WHERE eb.EStatus = 'Pending'
          AND NOT (
            ISNULL(eb.ESourceType, '') = 'GRN'
            AND ISNULL(eb.ERemarks, '') LIKE 'Auto-created for remaining items from GRN%'
          )
      `);
    }

    // Engineering → Work Done approval
    // Matches backend/services/approvalService.js MODULE_MAP: "work-done"
    if (!module || module === "work-done") {
      queries.push(`
        SELECT
          'work-done'                AS Module,
          'Work Done'               AS ModuleLabel,
          CAST(wd.ID AS NVARCHAR)   AS RecordId,
          wd.DocNo                   AS Reference,
          wd.DocDate                 AS RecordDate,
          ISNULL(wd.Status, 'Draft') AS Status,
          CAST(NULL AS NVARCHAR)     AS ContractorName,
          CAST(NULL AS NVARCHAR)     AS SupplierName,
          CAST(NULL AS DECIMAL(18,2)) AS Amount,
          wd.CreatedBy               AS CreatedBy,
          ''                         AS ApprovedBy,
          ''                         AS ApprovedAt,
          ''                         AS RejectedBy,
          ISNULL(wd.Remarks, '')    AS RejectionNote,
          wd.UpdatedAt               AS LastModified
        FROM dbo.WorkDone wd
        WHERE ISNULL(wd.Status, 'Draft') = 'Pending'
      `);
    }

    if (!module || module === "boq") {
      queries.push(`
        SELECT
          'boq'                       AS Module,
          'BOQ'                       AS ModuleLabel,
          CAST(b.BoqID AS NVARCHAR)   AS RecordId,
          COALESCE(b.DocNo, b.BoqNo)  AS Reference,
          b.BoqDate                   AS RecordDate,
          ISNULL(b.Status, 'Draft')   AS Status,
          pr.name                     AS ContractorName,
          CONCAT(
            COALESCE(pr.name, ''),
            CASE WHEN pr.name IS NOT NULL AND co.name IS NOT NULL THEN ' / ' ELSE '' END,
            COALESCE(co.name, '')
          )                           AS SupplierName,
          b.TotalAmount               AS Amount,
          b.CreatedBy                 AS CreatedBy,
          ''                          AS ApprovedBy,
          ''                          AS ApprovedAt,
          ''                          AS RejectedBy,
          ISNULL(b.Remarks, '')       AS RejectionNote,
          ISNULL(b.UpdatedAt, b.CreatedAt) AS LastModified
        FROM dbo.BOQ b
        LEFT JOIN dbo.enterprise co ON co.id = b.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = b.ProjectId
        WHERE ISNULL(b.Status, 'Draft') = 'Pending'
      `);
    }

    if (!module || module === "material-requests") {
      queries.push(`
        SELECT
          'material-requests'      AS Module,
          'Material Request'       AS ModuleLabel,
          CAST(MRId AS NVARCHAR)   AS RecordId,
          ISNULL(DocNo, CONCAT('MR#', CAST(MRId AS NVARCHAR))) AS Reference,
          RequestDate              AS RecordDate,
          Status,
          CAST(NULL AS NVARCHAR)   AS ContractorName,
          CAST(NULL AS NVARCHAR)   AS SupplierName,
          CAST(NULL AS DECIMAL(18,2)) AS Amount,
          CreatedBy,
          ''                       AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          UpdatedAt                AS LastModified
        FROM dbo.MaterialRequests
        WHERE Status = 'Pending'
      `);
    }

    if (!module || module === "material-issues") {
      queries.push(`
        SELECT
          'material-issues'                                              AS Module,
          'Material Issue'                                               AS ModuleLabel,
          CAST(mi.IssueId AS NVARCHAR)                                   AS RecordId,
          ISNULL(mi.DocNo, ISNULL(mi.IssueNo, CONCAT('ISS#', CAST(mi.IssueId AS NVARCHAR)))) AS Reference,
          mi.Date                                                        AS RecordDate,
          ISNULL(mi.Status, 'Pending')                                   AS Status,
          CAST(NULL AS NVARCHAR)                                         AS ContractorName,
          ISNULL(mi.IssuedTo, ISNULL(p.name, mi.Reason))                AS SupplierName,
          CAST(NULL AS DECIMAL(18,2))                                    AS Amount,
          mi.CreatedBy                                                   AS CreatedBy,
          ''                                                             AS ApprovedBy,
          ''                                                             AS ApprovedAt,
          ''                                                             AS RejectedBy,
          ''                                                             AS RejectionNote,
          ISNULL(mi.UpdatedAt, mi.CreatedAt)                            AS LastModified
        FROM dbo.MaterialIssues mi
        LEFT JOIN dbo.enterprise p ON p.id = mi.ProjectId
        WHERE ISNULL(mi.Status, 'Pending') = 'Pending'
      `);
    }

    if (queries.length === 0) return res.json([]);

    const fullQuery =
      queries.join(" UNION ALL ") + " ORDER BY LastModified DESC";
    const result = await pool.request().query(fullQuery);

    res.json(result.recordset);
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox error");
    res.status(500).json({
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal Server Error",
    });
  }
});

// GET /api/approval-inbox/count — lightweight badge count
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders      WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader    WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.NewPayment         WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ReceivedPayment    WHERE RPStatus = 'Pending') +
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes  WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ExpenseBooking     WHERE EStatus = 'Pending'
          AND NOT (ISNULL(ESourceType,'') = 'GRN' AND ISNULL(ERemarks,'') LIKE 'Auto-created for remaining items from GRN%')) +
        (SELECT COUNT(*) FROM dbo.WorkDone           WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.BOQ                WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.MaterialRequests   WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.MaterialIssues     WHERE ISNULL(Status,'Pending') = 'Pending')
      AS TotalPending
    `);
    res.json({ count: result.recordset[0].TotalPending ?? 0 });
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox count error");
    res.status(500).json({
      error:
        process.env.NODE_ENV === "development"
          ? err.message
          : "Internal Server Error",
    });
  }
});

module.exports = router;
