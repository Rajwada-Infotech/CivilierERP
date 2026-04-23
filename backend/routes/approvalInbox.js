const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");

// GET /api/approval-inbox
// Returns all records in Pending state across all 5 modules
// Optional: ?module=purchase-orders|work-orders|payments|grns|expense-booking
router.get("/", cache("approval-inbox", 30), async (req, res) => {
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
          NULL                     AS CreatedBy,
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
          NULL                     AS CreatedBy,
          UpdatedAt                AS LastModified
        FROM dbo.NewPayment
        WHERE ISNULL(Status, 'Draft') = 'Pending'
      `);
    }

    if (!module || module === "grns") {
      queries.push(`
        SELECT
          'grns'                   AS Module,
          'GRN'                    AS ModuleLabel,
          CAST(GRNID AS NVARCHAR)  AS RecordId,
          GRNNo                    AS Reference,
          GRNDate                  AS RecordDate,
          ISNULL(Status, 'Draft')  AS Status,
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
          NULL                     AS CreatedBy,
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
          ISNULL(Status, 'Draft')  AS Status,
          NULL                     AS ContractorName,
          NULL                     AS SupplierName,
          NULL                     AS Amount,
          NULL                     AS CreatedBy,
          NULL                     AS LastModified
        FROM dbo.ExpenseBooking
        WHERE ISNULL(Status, 'Draft') = 'Pending'
      `);
    }

    if (queries.length === 0) {
      return res.json([]);
    }

    const fullQuery = queries.join(" UNION ALL ") + " ORDER BY LastModified DESC";
    const result = await pool.request().query(fullQuery);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/approval-inbox/count  — lightweight badge count
router.get("/count", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM dbo.PurchaseOrders  WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.WorkOrderHeader  WHERE Status = 'Pending') +
        (SELECT COUNT(*) FROM dbo.NewPayment       WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.GoodsReceiptNotes WHERE ISNULL(Status,'Draft') = 'Pending') +
        (SELECT COUNT(*) FROM dbo.ExpenseBooking   WHERE ISNULL(Status,'Draft') = 'Pending')
      AS TotalPending
    `);
    res.json({ count: result.recordset[0].TotalPending ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


