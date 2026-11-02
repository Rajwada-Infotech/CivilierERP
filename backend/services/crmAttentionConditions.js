// CRM attention conditions — "what is waiting" rules read by the CRM
// Dashboard's alert counts (routes/crmDashboard.js), kept here once so a rule
// such as "a welcome call is due" is never written twice.
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");

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

// A milestone (alias m) past its due date and unpaid.
const MILESTONE_OVERDUE_SQL = `m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE)`;

module.exports = {
  WELCOME_CALL_DUE_SQL,
  AGREEMENT_NEEDS_ACTION_SQL,
  DEMAND_BOOKING_LIVE_SQL,
  MILESTONE_OVERDUE_SQL,
};
