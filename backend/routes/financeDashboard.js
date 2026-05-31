const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const { getPool } = require("../db");
const { cache } = require("../middleware/cache");
const { checkPermissionForMethod } = require("../middleware/routePermission");

router.use(checkPermissionForMethod("Finance", "Dashboard"));

/**
 * GET /api/finance-dashboard
 *
 * Returns all stats scoped to the Finance module only:
 *   - Payments Made  (NewPayment)        : total, today count/amount
 *   - Received Payments (ReceivedPayment): total, today count/amount
 *   - Cheques (ChequeMaster)             : total, pending, cleared
 *   - Cards   (card_master)              : total, active
 *   - Banks   (AccountHeadMaster)        : total bank heads (LHeadType='B')
 *   - Recent payments made               : last 8 rows
 *   - Recent received payments           : last 8 rows
 */
router.get("/", cache("finance-dashboard", 60), async (req, res) => {
  try {
    const pool = getPool();

    const [
      paymentMadeStats,
      receivedPaymentStats,
      chequeStats,
      cardStats,
      bankStats,
      recentPaymentsMade,
      recentPaymentsReceived,
    ] = await Promise.all([
      // ── Payments Made (NewPayment) ──────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          ISNULL(SUM(PAmount), 0)                                               AS TotalAmount,
          ISNULL(SUM(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE)
                          THEN PAmount ELSE 0 END), 0)                          AS TodayAmount
        FROM dbo.NewPayment
      `),

      // ── Received Payments (ReceivedPayment) ────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN CAST(RPDocDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          ISNULL(SUM(RPAmount), 0)                                              AS TotalAmount,
          ISNULL(SUM(CASE WHEN CAST(RPDocDate AS DATE) = CAST(GETDATE() AS DATE)
                          THEN RPAmount ELSE 0 END), 0)                         AS TodayAmount,
          COUNT(CASE WHEN RPStatus = 'Approved' THEN 1 END)                     AS ApprovedCount,
          COUNT(CASE WHEN RPStatus = 'Draft' OR RPStatus IS NULL THEN 1 END)    AS DraftCount
        FROM dbo.ReceivedPayment
      `),

      // ── Cheques (ChequeMaster) ──────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN Status = 'Pending' OR Status IS NULL THEN 1 END)     AS PendingCount,
          COUNT(CASE WHEN Status = 'Draft'   THEN 1 END)                        AS DraftCount,
          COUNT(CASE WHEN Status = 'Cleared' OR Status = 'Used' THEN 1 END)    AS ClearedCount
        FROM dbo.ChequeMaster
      `),

      // ── Cards (card_master) ─────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                  AS TotalCount,
          COUNT(CASE WHEN status = 1 THEN 1 END)   AS ActiveCount,
          COUNT(CASE WHEN status = 0 THEN 1 END)   AS InactiveCount
        FROM dbo.card_master
      `),

      // ── Banks (AccountHeadMaster, LHeadType = 'B') ─────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                AS TotalCount,
          COUNT(CASE WHEN LHeadStatus = 1 THEN 1 END)            AS ActiveCount
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'B'
      `),

      // ── Recent Payments Made (last 8) ───────────────────────────────────────
      pool.request().query(`
        SELECT TOP 8
          PPaymentID,
          PPaymentName,
          PMode,
          PAmount,
          PDate,
          PBankName,
          PDocType,
          PProject,
          PCreatedAt
        FROM dbo.NewPayment
        ORDER BY PCreatedAt DESC
      `),

      // ── Recent Received Payments (last 8) ───────────────────────────────────
      pool.request().query(`
        SELECT TOP 8
          RPPaymentID,
          RPReceivedFrom,
          RPMode,
          RPAmount,
          RPDocDate,
          RPBankName,
          RPStatus,
          RPCreatedAt
        FROM dbo.ReceivedPayment
        ORDER BY RPCreatedAt DESC
      `),
    ]);

    const pm = paymentMadeStats.recordset[0];
    const rp = receivedPaymentStats.recordset[0];
    const ch = chequeStats.recordset[0];
    const cd = cardStats.recordset[0];
    const bk = bankStats.recordset[0];

    res.json({
      paymentsMade: {
        totalCount: pm.TotalCount,
        todayCount: pm.TodayCount,
        totalAmount: parseFloat(pm.TotalAmount),
        todayAmount: parseFloat(pm.TodayAmount),
      },
      receivedPayments: {
        totalCount: rp.TotalCount,
        todayCount: rp.TodayCount,
        totalAmount: parseFloat(rp.TotalAmount),
        todayAmount: parseFloat(rp.TodayAmount),
        approvedCount: rp.ApprovedCount,
        draftCount: rp.DraftCount,
      },
      cheques: {
        totalCount: ch.TotalCount,
        pendingCount: ch.PendingCount,
        draftCount: ch.DraftCount,
        clearedCount: ch.ClearedCount,
      },
      cards: {
        totalCount: cd.TotalCount,
        activeCount: cd.ActiveCount,
        inactiveCount: cd.InactiveCount,
      },
      banks: {
        totalCount: bk.TotalCount,
        activeCount: bk.ActiveCount,
      },
      recentPaymentsMade: recentPaymentsMade.recordset,
      recentPaymentsReceived: recentPaymentsReceived.recordset,
    });
  } catch (err) {
    console.error("FINANCE DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;




