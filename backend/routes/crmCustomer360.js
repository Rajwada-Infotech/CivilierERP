const express = require("express");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

// GET / — the Applicant Ledger's customer list: every customer with a
// rolled-up application/booking count and financial position, searchable by
// name/mobile/customer no. Same TotalOutstanding formula as crmCustomers.js's
// detail view (Waived milestones don't count as still-owed; a Cancelled/
// Rejected booking's balance isn't real collectible debt) so the two pages
// never disagree on what a customer actually owes.
router.get("/", requirePageRight("crm-customer-360", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { search } = req.query;
    const req0 = pool.request();
    let where = "WHERE c.IsActive = 1";
    if (search) {
      req0.input("srch", sql.NVarChar(200), `%${search}%`);
      where += " AND (c.CustomerName LIKE @srch OR c.Mobile LIKE @srch OR c.CustomerNo LIKE @srch)";
    }
    const result = await req0.query(`
      SELECT
        c.Id, c.CustomerNo, c.CustomerName, c.Mobile, c.City, c.State,
        (SELECT COUNT(*) FROM dbo.CrmApplication a WHERE a.Mobile = c.Mobile OR a.AltMobile = c.Mobile) AS ApplicationCount,
        (SELECT COUNT(*) FROM dbo.CrmBooking b JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE (a.Mobile = c.Mobile OR a.AltMobile = c.Mobile) AND b.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')) AS ActiveBookingCount,
        (SELECT ISNULL(SUM(ISNULL(m.AmountPaid, 0)), 0)
          FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE (a.Mobile = c.Mobile OR a.AltMobile = c.Mobile) AND b.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')) AS TotalPaid,
        (SELECT ISNULL(SUM(CASE WHEN m.Status NOT IN ('${CrmStatus.PAID}', 'Waived') THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE 0 END), 0)
          FROM dbo.CrmPaymentMilestone m JOIN dbo.CrmBooking b ON b.Id = m.BookingId JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
          WHERE (a.Mobile = c.Mobile OR a.AltMobile = c.Mobile) AND b.Status NOT IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}')) AS TotalOutstanding
      FROM dbo.CrmCustomer c
      ${where}
      ORDER BY c.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-customer-360] GET / error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /:mobile — full customer journey across Lead → Application → Booking →
// Agreement → Payments → Handover → Service Tickets, merged into one
// centralized ledger: invoices, payment receipts, on-account deposits, and
// broker settlements per booking, plus a customer-level financial summary.
// Restricted to admin-tier roles per the "leads visible only to marketing
// head and super admin" access rule.
router.get("/:mobile", requirePageRight("crm-customer-360", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const mobile = req.params.mobile.trim();

    const [customer, leads, apps, bookings, calls, tickets, cancellations] = await Promise.all([
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT TOP 1 Id, CustomerNo, CustomerName, Mobile, AltMobile, Email, PanNo, Address, City, State, Pincode
        FROM dbo.CrmCustomer WHERE Mobile = @mob OR AltMobile = @mob
      `),
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
        SELECT b.Id, b.BookingNo,
               COALESCE(bn.ProjectName, b.ProjectName) AS ProjectName,
               COALESCE(bn.UnitNo,      b.UnitNo)      AS UnitNo,
               b.TotalValue, b.Status,
               b.ParkingTotal, b.ExtraChargesTotal, b.GrandTotal,
               b.BookingDate, a.ApplicationNo,
               ag.Status AS AgreementStatus,
               h.Status AS HandoverStatus, h.ActualHandoverDate,
               lm.OverallStatus AS LegalMilestoneStatus,
               pp.Status AS PrePossessionStatus,
               (SELECT COUNT(*) FROM dbo.CrmNoc n WHERE n.BookingId = b.Id AND n.Status <> 'Issued') AS NocPendingCount,
               (SELECT COUNT(*) FROM dbo.CrmNoc n WHERE n.BookingId = b.Id) AS NocTotalCount,
               (SELECT ISNULL(SUM(AmountPaid),0) FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalPaid,
               (SELECT ISNULL(SUM(AmountDue),0)  FROM dbo.CrmPaymentMilestone WHERE BookingId = b.Id) AS TotalDue,
               CASE WHEN b.Status IN ('${CrmStatus.CANCELLED}', '${CrmStatus.REJECTED}') THEN 0 ELSE
                 (SELECT ISNULL(SUM(CASE WHEN m2.Status NOT IN ('${CrmStatus.PAID}', 'Waived') THEN m2.AmountDue - ISNULL(m2.AmountPaid, 0) ELSE 0 END), 0)
                  FROM dbo.CrmPaymentMilestone m2 WHERE m2.BookingId = b.Id)
               END AS TotalOutstanding,
               (SELECT COUNT(*) FROM dbo.CrmCancellation WHERE BookingId = b.Id AND Status IN ('Requested','${CrmStatus.APPROVED}')) AS HasCancellation
        FROM dbo.CrmBooking b
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
        LEFT JOIN dbo.CrmAgreement ag ON ag.BookingId = b.Id
        LEFT JOIN dbo.CrmHandover h ON h.BookingId = b.Id
        LEFT JOIN dbo.CrmLegalMilestone lm ON lm.BookingId = b.Id
        LEFT JOIN dbo.CrmPrePossession pp ON pp.BookingId = b.Id
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
      pool.request().input("mob", sql.NVarChar(20), mobile).query(`
        SELECT c.Id, c.Status, c.RefundAmount, c.CreatedAt
        FROM dbo.CrmCancellation c
        JOIN dbo.CrmBooking b ON b.Id = c.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE a.Mobile = @mob OR a.AltMobile = @mob
        ORDER BY c.CreatedAt DESC
      `),
    ]);

    if (!leads.recordset.length && !apps.recordset.length) {
      return res.status(404).json({ error: "No customer found with this mobile number" });
    }

    const bookingRows = bookings.recordset;
    const bookingIds = bookingRows.map((b) => b.Id);

    let receiptsByBooking = {}, invoicesByBooking = {}, onAccountByBooking = {}, brokerageByBooking = {}, milestonesByBooking = {};
    if (bookingIds.length) {
      const idList = bookingIds.join(",");
      const [receiptsRes, invoicesRes, onAccountRes, brokerageRes, milestonesRes] = await Promise.all([
        // Receipts are keyed off Milestone, not Booking directly — join through
        // CrmPaymentMilestone the same way the milestone-payment flow itself does.
        pool.request().query(`
          SELECT r.Id, r.ReceiptNo, r.MilestoneId, r.Amount, r.ReceivedDate, r.PaymentMode,
                 r.DepositBankName, m.MilestoneName, m.BookingId
          FROM dbo.CrmPaymentReceipt r
          JOIN dbo.CrmPaymentMilestone m ON m.Id = r.MilestoneId
          WHERE m.BookingId IN (${idList})
          ORDER BY r.ReceivedDate DESC
        `),
        // CreatedByName — "invoice history list management (per-user wise)"
        // needs to show who actually generated each invoice, not just the
        // invoice itself.
        pool.request().query(`
          SELECT i.Id, i.InvoiceNo, i.BookingId, i.InvoiceType, i.Amount, i.InvoiceDate, i.Description, i.Status,
                 cu.name AS CreatedByName
          FROM dbo.CrmInvoice i
          LEFT JOIN dbo.Users cu ON cu.id = i.CreatedBy
          WHERE i.BookingId IN (${idList})
          ORDER BY i.InvoiceDate DESC
        `),
        pool.request().query(`
          SELECT Id, ReceiptNo, BookingId, Amount, AppliedAmount, ReceivedDate, PaymentMode, DepositBankName
          FROM dbo.CrmOnAccountPayment WHERE BookingId IN (${idList})
          ORDER BY ReceivedDate DESC
        `),
        // Broker name/firm come off the booking itself (BrokerName/BrokerFirm
        // captured at brokerage-creation time), same denormalized fields
        // crmBrokerage.js's own list view reads — no separate broker master
        // join needed here.
        pool.request().query(`
          SELECT br.Id, br.BookingId, br.BrokerName, br.BrokerFirm, br.RateType, br.RateValue,
                 br.ComputedAmount, br.Status, br.TrancheLabel,
                 (SELECT ISNULL(SUM(Amount),0) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id) AS TotalPaid
          FROM dbo.CrmBrokerageMaster br
          WHERE br.BookingId IN (${idList})
        `),
        // Full milestone-wise schedule — "act like a Customer 360" means
        // showing the real payment plan step by step (done / pending /
        // upcoming / overdue), not just the booking-level Paid/Outstanding
        // totals already summarized above.
        pool.request().query(`
          SELECT Id, BookingId, MilestoneNo, MilestoneName, DueDate, AmountDue, AmountPaid, Status, [Percent]
          FROM dbo.CrmPaymentMilestone
          WHERE BookingId IN (${idList})
          ORDER BY BookingId, MilestoneNo
        `),
      ]);
      for (const r of receiptsRes.recordset) (receiptsByBooking[r.BookingId] ??= []).push(r);
      for (const inv of invoicesRes.recordset) (invoicesByBooking[inv.BookingId] ??= []).push(inv);
      for (const oa of onAccountRes.recordset) (onAccountByBooking[oa.BookingId] ??= []).push(oa);
      for (const br of brokerageRes.recordset) (brokerageByBooking[br.BookingId] ??= []).push(br);
      for (const m of milestonesRes.recordset) (milestonesByBooking[m.BookingId] ??= []).push(m);
    }

    const enrichedBookings = bookingRows.map((b) => ({
      ...b,
      receipts: receiptsByBooking[b.Id] || [],
      invoices: invoicesByBooking[b.Id] || [],
      onAccount: onAccountByBooking[b.Id] || [],
      brokerage: brokerageByBooking[b.Id] || [],
      milestones: milestonesByBooking[b.Id] || [],
    }));

    // Customer-level summary rolls up every non-Cancelled/Rejected booking's
    // figures — same exclusion rule as the per-booking TotalOutstanding above,
    // so the top-of-page tiles and the drill-down numbers always agree.
    const liveBookings = enrichedBookings.filter((b) => ![CrmStatus.CANCELLED, CrmStatus.REJECTED].includes(b.Status));
    const summary = {
      totalInvoiced: liveBookings.reduce((s, b) => s + b.invoices.reduce((si, i) => si + Number(i.Amount || 0), 0), 0),
      totalPaid: liveBookings.reduce((s, b) => s + Number(b.TotalPaid || 0), 0),
      totalOutstanding: liveBookings.reduce((s, b) => s + Number(b.TotalOutstanding || 0), 0),
      totalOnAccountBalance: liveBookings.reduce((s, b) => s + b.onAccount.reduce((si, oa) => si + (Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0)), 0), 0),
      totalBrokeragePaid: liveBookings.reduce((s, b) => s + b.brokerage.reduce((si, br) => si + Number(br.TotalPaid || 0), 0), 0),
      totalBrokerageDue: liveBookings.reduce((s, b) => s + b.brokerage.reduce((si, br) => si + Math.max(0, Number(br.ComputedAmount || 0) - Number(br.TotalPaid || 0)), 0), 0),
    };

    res.json({
      mobile,
      customer: customer.recordset[0] || null,
      summary,
      leads: leads.recordset,
      applications: apps.recordset,
      bookings: enrichedBookings,
      calls: calls.recordset,
      serviceTickets: tickets.recordset,
      cancellations: cancellations.recordset,
    });
  } catch (e) {
    console.error("[crm-customer-360] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
