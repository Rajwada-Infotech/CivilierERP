const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool } = require("../db");
const { cache } = require("../middleware/cache");
// No extra permission gate here — /api routes are already protected
// by authMiddleware at the server level. Any authenticated user who
// has been granted Finance rights can view aggregate dashboard stats.

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
      poStats,
      supplierStats,
      recentPaymentsMade,
      recentPaymentsReceived,
      madeTimeline,
      receivedTimeline,
    ] = await Promise.all([
      // ── Payments Made (NewPayment) ──────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                              AS TotalCount,
          COUNT(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END)
                                                                                AS TodayCount,
          ISNULL(SUM(PAmount), 0)                                               AS TotalAmount,
          ISNULL(SUM(CASE WHEN CAST(PDate AS DATE) = CAST(GETDATE() AS DATE)
                          THEN PAmount ELSE 0 END), 0)                          AS TodayAmount,
          ISNULL(SUM(CASE WHEN CAST(PDate AS DATE) >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))
                          THEN PAmount ELSE 0 END), 0)                          AS ThisMonthAmount
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
      // Status is BIT (1 = active/issued, 0 = inactive) after migration 121.
      // The old nvarchar 'Pending'/'Draft'/'Cleared' states never existed in
      // data — we report active vs inactive lot counts instead.
      pool.request().query(`
        SELECT
          COUNT(*)                                      AS TotalCount,
          COUNT(CASE WHEN Status = 1 THEN 1 END)        AS ActiveCount,
          COUNT(CASE WHEN Status = 0 OR Status IS NULL THEN 1 END) AS InactiveCount
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

      // ── Purchase Orders ─────────────────────────────────────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                                           AS TotalCount,
          COUNT(CASE WHEN ISNULL(Status,'Open') NOT IN ('Closed','Cancelled') THEN 1 END)   AS OpenCount,
          ISNULL(SUM(TotalAmount), 0)                                                        AS TotalValue,
          ISNULL(SUM(CASE WHEN ISNULL(Status,'Open') NOT IN ('Closed','Cancelled')
                          THEN TotalAmount ELSE 0 END), 0)                                  AS OpenValue
        FROM dbo.PurchaseOrders
      `),

      // ── Suppliers (AccountHeadMaster, LHeadType = 'S') ─────────────────────
      pool.request().query(`
        SELECT
          COUNT(*)                                                AS TotalCount,
          COUNT(CASE WHEN LHeadStatus = 1 THEN 1 END)            AS ActiveCount
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'S'
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

      // ── Payments Made — daily totals, last 14 days ─────────────────────────
      pool.request().query(`
        SELECT
          CAST(PDate AS DATE)      AS Day,
          ISNULL(SUM(PAmount), 0)  AS Amount
        FROM dbo.NewPayment
        WHERE CAST(PDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(PDate AS DATE)
      `),

      // ── Received Payments — daily totals, last 14 days ─────────────────────
      pool.request().query(`
        SELECT
          CAST(RPDocDate AS DATE)  AS Day,
          ISNULL(SUM(RPAmount), 0) AS Amount
        FROM dbo.ReceivedPayment
        WHERE CAST(RPDocDate AS DATE) >= DATEADD(DAY, -13, CAST(GETDATE() AS DATE))
        GROUP BY CAST(RPDocDate AS DATE)
      `),
    ]);

    const pm = paymentMadeStats.recordset[0];
    const rp = receivedPaymentStats.recordset[0];
    const ch = chequeStats.recordset[0];
    const cd = cardStats.recordset[0];
    const bk = bankStats.recordset[0];
    const po = poStats.recordset[0];
    const sp = supplierStats.recordset[0];

    // Zero-fill all 14 days — the GROUP BY queries above only return days
    // that actually had a payment, so gaps would otherwise break the line.
    const madeByDay = new Map(
      madeTimeline.recordset.map((r) => [r.Day.toISOString().slice(0, 10), parseFloat(r.Amount)]),
    );
    const receivedByDay = new Map(
      receivedTimeline.recordset.map((r) => [r.Day.toISOString().slice(0, 10), parseFloat(r.Amount)]),
    );
    const timeline = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      timeline.push({
        date: key,
        made: madeByDay.get(key) ?? 0,
        received: receivedByDay.get(key) ?? 0,
      });
    }

    res.json({
      paymentsMade: {
        totalCount: pm.TotalCount,
        todayCount: pm.TodayCount,
        totalAmount: parseFloat(pm.TotalAmount),
        todayAmount: parseFloat(pm.TodayAmount),
        thisMonthAmount: parseFloat(pm.ThisMonthAmount),
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
        activeCount: ch.ActiveCount,
        inactiveCount: ch.InactiveCount,
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
      purchaseOrders: {
        totalCount: po.TotalCount,
        openCount: po.OpenCount,
        totalValue: parseFloat(po.TotalValue),
        openValue: parseFloat(po.OpenValue),
      },
      parties: {
        supplierCount: sp.TotalCount,
        activeSupplierCount: sp.ActiveCount,
        customerCount: 0,
        activeGLCount: 0,
      },
      recentPaymentsMade: recentPaymentsMade.recordset,
      recentPaymentsReceived: recentPaymentsReceived.recordset,
      timeline,
    });
  } catch (err) {
    console.error("FINANCE DASHBOARD ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;