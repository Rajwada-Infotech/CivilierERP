const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "Transactions"));

/**
 * GET /api/transactions
 * Combines NewPayment + PurchaseOrders into a unified transaction list.
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();

    const [paymentsResult, posResult] = await Promise.all([
      pool.request().query(`
        SELECT
          'PAY-' + CAST(PPaymentID AS NVARCHAR) AS id,
          PDate                                  AS date,
          'Payment'                              AS type,
          ISNULL(PPaymentName, '—')              AS party,
          ISNULL(PDocType, '—')                  AS description,
          ISNULL(PAmount, 0)                     AS amount,
          ISNULL(PMode, '—')                     AS mode,
          ISNULL(Status, 'Draft')                AS status,
          PCreatedBy                             AS createdBy,
          PCreatedAt                             AS createdAt
        FROM dbo.NewPayment
        ORDER BY PCreatedAt DESC
      `),

      pool.request().query(`
        SELECT
          'PO-' + CAST(PurchaseOrderID AS NVARCHAR) AS id,
          PODate                                     AS date,
          'Purchase Order'                           AS type,
          ISNULL(
            (SELECT TOP 1 LHeadName FROM dbo.AccountHeadMaster
             WHERE LHeadId = po.SupplierID), '—')    AS party,
          ISNULL(ItemDescription, '—')               AS description,
          ISNULL(TotalAmount, 0)                     AS amount,
          ISNULL(PaymentTerms, '—')                  AS mode,
          ISNULL(Status, 'Draft')                    AS status,
          CreatedBy                                  AS createdBy,
          CreatedAt                                  AS createdAt
        FROM dbo.PurchaseOrders po
        ORDER BY CreatedAt DESC
      `),
    ]);

    const payments = paymentsResult.recordset;
    const pos = posResult.recordset;

    // Merge and sort by date descending
    const all = [...payments, ...pos].sort((a, b) => {
      return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
    });

    // Summary stats
    const totalPayments = payments.reduce((s, r) => s + Number(r.amount), 0);
    const totalPOs = pos.reduce((s, r) => s + Number(r.amount), 0);
    const pending = all.filter(
      (r) => r.status === "Pending" || r.status === "Draft",
    ).length;

    res.json({
      transactions: all,
      summary: {
        totalPayments,
        totalPOs,
        netCashFlow: totalPOs - totalPayments,
        pendingCount: pending,
      },
    });
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




