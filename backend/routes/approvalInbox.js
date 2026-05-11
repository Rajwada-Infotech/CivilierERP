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
        WHERE ISNULL(Status, 'Draft') = 'Pending'
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
        WHERE ISNULL(RPStatus, 'Draft') = 'Pending'
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
        WHERE ISNULL(Status,'Draft') = 'Pending'
      `);
    }

    if (!module || module === "expense-booking") {
      queries.push(`
        SELECT
          'expense-booking'        AS Module,
          'Expense Booking'        AS ModuleLabel,
          CAST(Eid AS NVARCHAR)    AS RecordId,
          CAST(Eid AS NVARCHAR)    AS Reference,
          NULL                     AS RecordDate,
          ISNULL(EStatus, 'Draft') AS Status,
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
          NULL                     AS CreatedBy,
          ISNULL(CAST(EApprovedBy AS NVARCHAR), '') AS ApprovedBy,
          ''                       AS ApprovedAt,
          ''                       AS RejectedBy,
          ''                       AS RejectionNote,
          EUpdatedAt               AS LastModified
        FROM dbo.ExpenseBooking
        WHERE ISNULL(EStatus, 'Draft') = 'Pending'
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
      error: process.env.NODE_ENV === "development" ? err.message : "Internal Server Error",
    });
  }
});

// GET /api/approval-inbox/count — lightweight badge count
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders    WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader    WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.NewPayment         WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ReceivedPayment    WHERE ISNULL(RPStatus,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes  WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ExpenseBooking     WHERE ISNULL(EStatus,'Draft') = 'Pending')
      AS TotalPending
    `);
    res.json({ count: result.recordset[0].TotalPending ?? 0 });
  } catch (err) {
    logger.error({ err, requestId: req.id }, "approval-inbox count error");
    res.status(500).json({
      error: process.env.NODE_ENV === "development" ? err.message : "Internal Server Error",
    });
  }
});

module.exports = router;
