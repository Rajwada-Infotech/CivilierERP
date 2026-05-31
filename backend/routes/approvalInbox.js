const express = require("express");
const router = express.Router();
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
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
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
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
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
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          PAmount                  AS Amount,
          PCreatedBy               AS CreatedBy,
          ISNULL(PApprovedBy, '')  AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          NULL                     AS LastModified
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
          NULL                                  AS ContractorName,
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
          'goods-receipt'          AS Module,
          'GRN'                    AS ModuleLabel,
          CAST(GRNID AS NVARCHAR)  AS RecordId,
          GRNNo                    AS Reference,
          GRNDate                  AS RecordDate,
          ISNULL(Status, 'Draft')  AS Status,
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
          NULL                     AS CreatedBy,
          ISNULL(ApprovedBy, '')   AS ApprovedBy,
          ISNULL(CAST(ApprovedAt AS NVARCHAR), '') AS ApprovedAt,
          ISNULL(RejectedBy, '')   AS RejectedBy,
          ISNULL(RejectionNote, '') AS RejectionNote,
          UpdatedAt                AS LastModified
        FROM dbo.GoodsReceiptNotes
        WHERE Status = 'Pending'
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
          NULL                     AS ContractorName,
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
          NULL                       AS ContractorName,
          NULL                       AS SupplierName,
          NULL                       AS Amount,
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
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
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
          'material-issues'        AS Module,
          'Material Issue'         AS ModuleLabel,
          CAST(IssueId AS NVARCHAR) AS RecordId,
          ISNULL(DocNo, ISNULL(IssueNo, CONCAT('ISS#', CAST(IssueId AS NVARCHAR)))) AS Reference,
          Date                     AS RecordDate,
          ISNULL(Status, 'Pending') AS Status,
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
          NULL                     AS CreatedBy,
          ''                       AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          NULL                     AS LastModified
        FROM dbo.MaterialIssues
        WHERE ISNULL(Status, 'Pending') = 'Pending'
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
