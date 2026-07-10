const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — CRM-wide pipeline stats: application/booking funnel, payment
// collection health, ticket/cancellation load, legal & closure progress.
router.get("/", requirePageRight("crm-dashboard", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [apps, bookings, payments, tickets, cancellations, legal, noc, deeds, handovers] = await Promise.all([
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count FROM dbo.CrmApplication WHERE IsActive = 1 GROUP BY Status
      `),
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count, SUM(ISNULL(TotalValue,0)) AS TotalValue
        FROM dbo.CrmBooking WHERE IsActive = 1 GROUP BY Status
      `),
      pool.request().query(`
        SELECT
          ISNULL(SUM(AmountDue), 0)  AS TotalDue,
          ISNULL(SUM(AmountPaid), 0) AS TotalPaid,
          SUM(CASE WHEN Status = 'Pending' AND DueDate < CAST(SYSDATETIME() AS DATE) THEN 1 ELSE 0 END) AS OverdueCount
        FROM dbo.CrmPaymentMilestone
      `),
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count FROM dbo.CrmServiceTicket GROUP BY Status
      `),
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count, ISNULL(SUM(RefundAmount),0) AS TotalRefund
        FROM dbo.CrmCancellation GROUP BY Status
      `),
      pool.request().query(`
        SELECT OverallStatus, COUNT(*) AS Count FROM dbo.CrmLegalMilestone GROUP BY OverallStatus
      `),
      pool.request().query(`
        SELECT NocType, Status, COUNT(*) AS Count FROM dbo.CrmNoc GROUP BY NocType, Status
      `),
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count FROM dbo.CrmSalesDeed GROUP BY Status
      `),
      pool.request().query(`
        SELECT Status, COUNT(*) AS Count FROM dbo.CrmHandover GROUP BY Status
      `),
    ]);

    res.json({
      applications: apps.recordset,
      bookings: bookings.recordset,
      payments: payments.recordset[0],
      serviceTickets: tickets.recordset,
      cancellations: cancellations.recordset,
      legalMilestones: legal.recordset,
      noc: noc.recordset,
      salesDeeds: deeds.recordset,
      handovers: handovers.recordset,
    });
  } catch (e) {
    console.error("[crm-dashboard] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
