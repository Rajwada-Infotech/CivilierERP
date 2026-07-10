const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET /:mobile — full customer journey across Lead → Application → Booking →
// Agreement → Payments → Handover → Service Tickets, merged into one timeline.
// Restricted to admin-tier roles per the "leads visible only to marketing head
// and super admin" access rule.
router.get("/:mobile", requirePageRight("crm-customer-360", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const mobile = req.params.mobile.trim();

    const [leads, apps, bookings, calls, tickets] = await Promise.all([
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT Id, LeadUid, Status, Classification, SourceType, PlatformId,
               CreatedAt, AssignedSalespersonId
        FROM dbo.SaLead WHERE Mobile = @mob OR AltMobile = @mob
        ORDER BY CreatedAt DESC
      `),
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT a.Id, a.ApplicationNo, a.ApplicantName, a.Status, a.CreatedAt,
               a.InterestedProject, a.PropertyType, a.BhkPreference,
               u.name AS AssigneeName
        FROM dbo.CrmApplication a
        LEFT JOIN dbo.Users u ON u.id = a.AssignedTo
        WHERE a.Mobile = @mob OR a.AltMobile = @mob
        ORDER BY a.CreatedAt DESC
      `),
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT b.Id, b.BookingNo, b.ProjectName, b.UnitNo, b.TotalValue, b.Status,
               b.BookingDate, a.ApplicationNo,
               ag.Status AS AgreementStatus,
               h.Status AS HandoverStatus, h.ActualHandoverDate,
               (SELECT ISNULL(SUM(AmountPaid),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalPaid,
               (SELECT ISNULL(SUM(AmountDue),0)  FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalDue,
               (SELECT COUNT(*) FROM dbo.CrmCancellation WHERE BookingId = b.Id AND Status IN ('Requested','Approved')) AS HasCancellation
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id
        LEFT JOIN dbo.CrmHandover h ON h.BookingId = b.Id
        WHERE a.Mobile = @mob OR a.AltMobile = @mob
        ORDER BY b.CreatedAt DESC
      `),
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT c.Id, c.CallTime, c.Outcome, c.Classification, c.Remarks
        FROM dbo.SaInquiryCall c
        JOIN dbo.SaLead l ON l.Id = c.LeadId
        WHERE l.Mobile = @mob OR l.AltMobile = @mob
        ORDER BY c.CallTime DESC
      `),
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT t.Id, t.TicketNo, t.Category, t.Priority, t.Subject, t.Status, t.CreatedAt
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE a.Mobile = @mob OR a.AltMobile = @mob
        ORDER BY t.CreatedAt DESC
      `),
    ]);

    if (!leads.recordset.length && !apps.recordset.length) {
      return res.status(404).json({ error: "No customer found with this mobile number" });
    }

    res.json({
      mobile,
      leads: leads.recordset,
      applications: apps.recordset,
      bookings: bookings.recordset,
      calls: calls.recordset,
      serviceTickets: tickets.recordset,
    });
  } catch (e) {
    console.error("[crm-customer-360] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
