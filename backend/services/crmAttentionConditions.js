// CRM attention conditions — "what is waiting" rules read by the CRM
// Dashboard's alert counts (routes/crmDashboard.js), kept here once so a rule
// such as "a welcome call is due" is never written twice.
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { onAccountWithAvailableSql } = require("./crmPaymentFunding");

// Alias b = dbo.CrmBooking.

// Approved booking with no 'Welcomed' call logged yet.
const WELCOME_CALL_DUE_SQL = `
  b.IsActive = 1 AND b.Status = '${CrmStatus.APPROVED}'
  AND NOT EXISTS (SELECT 1 FROM dbo.CrmWelcomeCall w WHERE w.BookingId = b.Id AND w.Outcome = 'Welcomed')`;

// Approved booking with no live agreement, or one left in Draft over 5 days.
const AGREEMENT_NEEDS_ACTION_SQL = `
  b.IsActive = 1 AND b.Status = '${CrmStatus.APPROVED}'
  AND (
    NOT EXISTS (SELECT 1 FROM dbo.CrmAgreement ag WHERE ag.BookingId = b.Id AND ag.Status <> '${CrmStatus.CANCELLED}')
    OR EXISTS (
      SELECT 1 FROM dbo.CrmAgreement ag
      WHERE ag.BookingId = b.Id AND ag.Status = '${CrmStatus.DRAFT}'
        AND DATEDIFF(DAY, ag.CreatedAt, SYSDATETIME()) > 5
    )
  )`;

// A booking whose demands still count: live, and either confirmed or still
// inside its confirmation window.
const DEMAND_BOOKING_LIVE_SQL = `
  b.IsActive = 1 AND b.Status NOT IN ${DEAD_BOOKING_SQL}
  AND (b.Status = '${CrmStatus.APPROVED}' OR b.ConfirmDeadline IS NULL OR b.ConfirmDeadline >= SYSDATETIME())`;

// A milestone (alias m) past its due date with no money for it. Money covers
// milestones in order (crmOnAccountCoverage.js): m is covered when the unpaid
// dues up to and including it fit inside the booking's verified money held On
// Account plus what is entered and waiting for Finance. The payment page's
// per-row stage (crmPayments.js GET /booking/:id) is the same rule.
const MILESTONE_OVERDUE_SQL = `m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
  AND (SELECT ISNULL(SUM(CASE WHEN p.Status = 'Waived' OR p.AmountDue <= ISNULL(p.AmountPaid, 0) THEN 0 ELSE p.AmountDue - ISNULL(p.AmountPaid, 0) END), 0)
       FROM dbo.CrmPaymentMilestone p
       WHERE p.BookingId = m.BookingId AND (p.MilestoneNo < m.MilestoneNo OR (p.MilestoneNo = m.MilestoneNo AND p.Id <= m.Id)))
    > ISNULL((SELECT SUM(o.AvailableAmount) FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = m.BookingId), 0)
      + ISNULL((SELECT SUM(rp.RPAmount) FROM dbo.ReceivedPayment rp WHERE rp.CrmBookingId = m.BookingId AND rp.RPStatus = N'Pending'), 0) + 0.009`;

module.exports = {
  WELCOME_CALL_DUE_SQL,
  AGREEMENT_NEEDS_ACTION_SQL,
  DEMAND_BOOKING_LIVE_SQL,
  MILESTONE_OVERDUE_SQL,
};
