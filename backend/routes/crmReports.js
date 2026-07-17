const express = require("express");
const router = express.Router();
const { getPool } = require("../db");
const authMiddleware = require("../middleware/auth");
const apiRateLimit = require("../middleware/apiRateLimit");
const { requirePageRight } = require("../middleware/requirePageRight");

const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
router.use(authMiddleware);
router.use(apiRateLimit);

function dateRangeFilter(req, column) {
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const clauses = [];
  if (req.query.from && ISO_DATE.test(req.query.from)) clauses.push(`${column} >= '${req.query.from}'`);
  if (req.query.to && ISO_DATE.test(req.query.to)) clauses.push(`${column} <= '${req.query.to}'`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

// 1. Booking Register — every booking with customer, unit & value
router.get("/booking-register", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(b.BookingDate AS DATE)");
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, a.Mobile, b.ProjectName, b.UnitNo, b.UnitType,
        b.AreaSqFt, b.TotalValue, b.BookingAmount, b.Status,
        CAST(b.BookingDate AS DATE) AS BookingDate
      FROM dbo.CrmBooking b
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where ? `${where} AND b.IsActive = 1` : "WHERE b.IsActive = 1"}
      ORDER BY b.BookingDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Payment Collection Report — milestone due/paid/balance per booking
router.get("/payment-collection", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(m.DueDate AS DATE)");
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, m.MilestoneName,
        CAST(m.DueDate AS DATE) AS DueDate, m.AmountDue, m.AmountPaid,
        (m.AmountDue - m.AmountPaid) AS Balance, m.Status
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY m.DueDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Receipt Register — actual money received
router.get("/receipt-register", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(r.ReceivedDate AS DATE)");
    const r = await pool.request().query(`
      SELECT r.ReceiptNo, b.BookingNo, a.ApplicantName, m.MilestoneName,
        r.Amount, CAST(r.ReceivedDate AS DATE) AS ReceivedDate, r.PaymentMode, r.TransactionRef
      FROM dbo.CrmPaymentReceipt r
      JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY r.ReceivedDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Overdue Payments — pending milestones past due date
router.get("/overdue-payments", requirePageRight("crm-payments", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, a.Mobile, m.MilestoneName,
        CAST(m.DueDate AS DATE) AS DueDate, m.AmountDue, m.AmountPaid,
        (m.AmountDue - m.AmountPaid) AS OverdueAmount,
        DATEDIFF(DAY, m.DueDate, SYSDATETIME()) AS DaysOverdue
      FROM dbo.CrmPaymentMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE m.Status = 'Pending' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
      ORDER BY m.DueDate ASC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 5. Brokerage Report — computed vs paid per broker
router.get("/brokerage-report", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(br.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT br.BrokerName, br.BrokerFirm, b.BookingNo, a.ApplicantName,
        br.RateType, br.RateValue, br.ComputedAmount, br.Status,
        ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0) AS TotalPaid,
        (br.ComputedAmount - ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0)) AS Balance
      FROM dbo.CrmBrokerageMaster br
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY br.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 6. Cancellation Report — refund/deduction breakdown
router.get("/cancellation-report", requirePageRight("crm-cancellations", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(c.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT c.CancellationNo, b.BookingNo, a.ApplicantName, c.Reason,
        c.AmountPaidTillDate, c.DeductionPercent, c.DeductionAmount, c.RefundAmount, c.Status,
        CAST(c.CreatedAt AS DATE) AS RequestedDate
      FROM dbo.CrmCancellation c
      JOIN dbo.CrmBooking b ON b.Id = c.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 7. Booking Status Summary — funnel counts by status
router.get("/booking-status-summary", requirePageRight("crm-bookings", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT Status, COUNT(*) AS Count, SUM(ISNULL(TotalValue,0)) AS TotalValue
      FROM dbo.CrmBooking
      WHERE IsActive = 1
      GROUP BY Status
      ORDER BY Count DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 8. Customer Master Report — all customers with contact info
router.get("/customer-report", requirePageRight("crm-customers", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(c.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT c.CustomerNo, c.CustomerName, c.Mobile, c.Email,
        (SELECT COUNT(*) FROM dbo.CrmBooking bk JOIN dbo.CrmApplication ap ON ap.Id = bk.ApplicationId WHERE ap.CustomerId = c.Id AND bk.IsActive = 1) AS TotalBookings,
        CAST(c.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmCustomer c
      ${where ? `${where} AND c.IsActive = 1` : "WHERE c.IsActive = 1"}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 9. Application Funnel — leads-to-booking conversion by status
router.get("/application-funnel", requirePageRight("crm-applications", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(a.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT a.Status,
        COUNT(*) AS Count,
        SUM(CASE WHEN bk.ApplicationId IS NOT NULL THEN 1 ELSE 0 END) AS Converted
      FROM dbo.CrmApplication a
      LEFT JOIN (SELECT DISTINCT ApplicationId FROM dbo.CrmBooking WHERE IsActive = 1) bk ON bk.ApplicationId = a.Id
      ${where ? `${where} AND a.IsActive = 1` : "WHERE a.IsActive = 1"}
      GROUP BY a.Status
      ORDER BY Count DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 10. Service Ticket Report — support tickets with SLA
router.get("/service-tickets", requirePageRight("crm-service-tickets", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(t.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT t.TicketNo, b.BookingNo, a.ApplicantName, t.Category, t.Priority, t.Subject, t.Status,
        CAST(t.SlaDueDate AS DATE) AS SlaDueDate, t.ResolvedAt, CAST(t.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmServiceTicket t
      JOIN dbo.CrmBooking b ON b.Id = t.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY t.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 11. Legal Milestone Report — title/legal clearance progress
router.get("/legal-milestones", requirePageRight("crm-legal-milestones", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, m.CurrentStep, m.OverallStatus,
        CAST(m.CreatedAt AS DATE) AS CreatedDate, CAST(m.UpdatedAt AS DATE) AS UpdatedDate
      FROM dbo.CrmLegalMilestone m
      JOIN dbo.CrmBooking b ON b.Id = m.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY m.UpdatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 12. NOC Report — bank/organisation NOC requests
router.get("/noc-report", requirePageRight("crm-noc", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(n.CreatedAt AS DATE)");
    const r = await pool.request().query(`
      SELECT n.NocNo, b.BookingNo, a.ApplicantName, n.NocType, CAST(n.NocDate AS DATE) AS NocDate,
        n.BankName, n.LoanAmount, n.Status
      FROM dbo.CrmNoc n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ${where}
      ORDER BY n.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 13. Sales Deed Report — registration & execution status
router.get("/sales-deed-report", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT d.DeedNo, b.BookingNo, a.ApplicantName, d.DeedValue, d.StampDuty, d.RegistrationFee,
        CAST(d.DeedDate AS DATE) AS DeedDate, d.RegistrationNo,
        CASE
          WHEN b.Status = 'Cancelled' THEN 'Cancelled'
          WHEN d.RegistrationNo IS NOT NULL THEN 'Registered'
          WHEN d.ExecutedBy IS NOT NULL THEN 'Executed'
          WHEN d.DeedDate IS NOT NULL AND d.DeedDate < CAST(GETDATE() AS DATE) THEN 'Overdue'
          ELSE 'Draft'
        END AS Status
      FROM dbo.CrmSalesDeed d
      JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY d.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 14. Handover Report — key handover progress
router.get("/handover-report", requirePageRight("crm-handover", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, CAST(h.ScheduledDate AS DATE) AS ScheduledDate,
        CAST(h.ActualHandoverDate AS DATE) AS ActualHandoverDate, h.Status,
        h.FinalDuesCleared, h.CustomerAcknowledged
      FROM dbo.CrmHandover h
      JOIN dbo.CrmBooking b ON b.Id = h.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY h.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 15. Agreement Report — sale agreement drafting/approval status
router.get("/agreement-report", requirePageRight("crm-agreements", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT ag.AgreementNo, b.BookingNo, a.ApplicantName, CAST(ag.AgreementDate AS DATE) AS AgreementDate,
        ag.Status, ag.SeniorApprovalStatus, ag.CustomerApprovalStatus
      FROM dbo.CrmAgreement ag
      JOIN dbo.CrmBooking b ON b.Id = ag.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY ag.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 16. Welcome Call Report — post-booking onboarding calls
router.get("/welcome-call-report", requirePageRight("crm-welcome-calls", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, CAST(wc.CallDate AS DATE) AS CallDate, wc.Outcome,
        CAST(wc.NextCallDate AS DATE) AS NextCallDate, wc.PaymentPlanConfirmed
      FROM dbo.CrmWelcomeCall wc
      JOIN dbo.CrmBooking b ON b.Id = wc.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY wc.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 17. Parking Allotment Report
router.get("/parking-report", requirePageRight("crm-parking-booking", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, pa.ParkingSlotNo, pa.Quantity, pa.TotalAmount,
        pa.PaymentStatus, CAST(pa.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmParkingAllotment pa
      LEFT JOIN dbo.CrmBooking b ON b.Id = pa.BookingId
      LEFT JOIN dbo.CrmApplication a ON a.Id = ISNULL(pa.ApplicationId, b.ApplicationId)
      WHERE pa.IsActive = 1
      ORDER BY pa.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 18. Possession Notice Report
router.get("/possession-notice-report", requirePageRight("crm-possession-notice", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT n.NoticeNo, b.BookingNo, a.ApplicantName, CAST(n.OfferedDate AS DATE) AS OfferedDate,
        CAST(n.ResponseDeadline AS DATE) AS ResponseDeadline, n.DeliveryMode, n.Status
      FROM dbo.CrmPossessionNotice n
      JOIN dbo.CrmBooking b ON b.Id = n.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY n.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 19. Pre-Possession Inspection Report
router.get("/pre-possession-report", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().query(`
      SELECT b.BookingNo, a.ApplicantName, CAST(p.ScheduledInspectionDate AS DATE) AS ScheduledInspectionDate,
        p.Status, CAST(p.CreatedAt AS DATE) AS CreatedDate
      FROM dbo.CrmPrePossession p
      JOIN dbo.CrmBooking b ON b.Id = p.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      ORDER BY p.CreatedAt DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 20. Construction Update Report — project progress log
router.get("/construction-updates", requirePageRight("crm-construction-updates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const where = dateRangeFilter(req, "CAST(u.UpdateDate AS DATE)");
    const r = await pool.request().query(`
      SELECT u.ProjectName, CAST(u.UpdateDate AS DATE) AS UpdateDate, u.PercentComplete, u.Stage, u.Summary
      FROM dbo.CrmConstructionUpdate u
      ${where}
      ORDER BY u.UpdateDate DESC
    `);
    res.json(r.recordset);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
