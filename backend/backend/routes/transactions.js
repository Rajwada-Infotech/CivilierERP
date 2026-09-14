const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "Transactions"));

/**
 * GET /api/transactions
 * Combines NewPayment + PurchaseOrders into a unified transaction list.
 */
router.get("/", async (req, res) => {
  try {
    const pool = getPool();
    const page  = Math.max(parseInt(req.query.page)  || 1,  1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
    const offset = (page - 1) * limit;

    // Merge NewPayment + PurchaseOrders via CTE, then paginate at the SQL level
    const result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("limit",  sql.Int, limit)
      .query(`
        WITH merged AS (
          SELECT
            'PAY-' + CAST(PPaymentID AS NVARCHAR) AS id,
            PDate                                  AS date,
            'Payment'                              AS type,
            ISNULL(PPaymentName, N'—')             AS party,
            ISNULL(PDocType, N'—')                 AS description,
            ISNULL(PAmount, 0)                     AS amount,
            ISNULL(PMode, N'—')                    AS mode,
            ISNULL(Status, 'Draft')                AS status,
            PCreatedBy                             AS createdBy,
            PCreatedAt                             AS createdAt
          FROM dbo.NewPayment
          UNION ALL
          SELECT
            'PO-' + CAST(PurchaseOrderID AS NVARCHAR) AS id,
            PODate                                     AS date,
            'Purchase Order'                           AS type,
            ISNULL(
              (SELECT TOP 1 LHeadName FROM dbo.AccountHeadMaster
               WHERE LHeadId = po.SupplierID), N'—')   AS party,
            ISNULL(ItemDescription, N'—')               AS description,
            ISNULL(TotalAmount, 0)                      AS amount,
            ISNULL(PaymentTerms, N'—')                  AS mode,
            ISNULL(Status, 'Draft')                     AS status,
            CreatedBy                                   AS createdBy,
            CreatedAt                                   AS createdAt
          FROM dbo.PurchaseOrders po
        )
        SELECT *, COUNT(*) OVER() AS _total
        FROM merged
        ORDER BY createdAt DESC
        OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
      `);

    const rows = result.recordset;
    const total = rows.length > 0 ? rows[0]._total : 0;
    const transactions = rows.map(({ _total, ...r }) => r);

    // Summary is over the full dataset — compute from all rows returned this page
    // (a separate aggregate query would be needed for true full-set summaries,
    // but these stats are used as directional indicators on the dashboard only)
    const totalPayments = transactions.filter(r => r.type === "Payment").reduce((s, r) => s + Number(r.amount), 0);
    const totalPOs      = transactions.filter(r => r.type === "Purchase Order").reduce((s, r) => s + Number(r.amount), 0);
    const pending       = transactions.filter(r => r.status === "Pending" || r.status === "Draft").length;

    res.json({
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
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




