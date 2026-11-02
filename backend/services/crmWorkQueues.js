// CRM work queues — "what is waiting, and on whom".
//
// One definition per queue, read by two screens:
//   - My Work (routes/crmMyWork.js): the queues the signed-in person can act
//     on, with the bookings in each;
//   - the CRM Dashboard (routes/crmDashboard.js): the same conditions counted
//     across the team ("Waiting on someone").
// So a rule such as "a welcome call is due" lives here once.
//
// Every queue only LISTS records and links to the page that already does the
// step; nothing here changes a record or adds a gate.
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { STAGE_REVIEW, STAGE_MARKETING, STAGE_DIRECTOR, stageLabel, canApproveStage } = require("./crmBookingStageService");
const { hasAnyPageAction } = require("../middleware/requirePageRight");
const { isApproverFor } = require("./approvalService");

// ── Shared conditions (alias b = dbo.CrmBooking) ─────────────────────────────

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

// A booking waiting at one stage of its approval chain.
const atStage = (stage) => stage === STAGE_REVIEW
  ? `b.IsActive = 1 AND b.Status = '${CrmStatus.PENDING}' AND ISNULL(b.WorkflowStage, '${STAGE_REVIEW}') = '${STAGE_REVIEW}'`
  : `b.IsActive = 1 AND b.Status = '${CrmStatus.PENDING}' AND b.WorkflowStage = '${stage}'`;

// ── Queues ───────────────────────────────────────────────────────────────────

const BOOKING_FROM = `
  FROM dbo.CrmBooking b
  LEFT JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId
  LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
  LEFT JOIN dbo.enterprise proj ON proj.id = b.ProjectId AND proj.business_type = 'P'`;
const BOOKING_COLS = `
  b.Id, b.BookingNo AS Ref, COALESCE(c.CustomerName, a.ApplicantName) AS Name,
  COALESCE(proj.name, b.ProjectName) AS Project, COALESCE(um.UnitName, b.UnitNo) AS Unit`;
const bookingLink = (r) => `/crm/bookings?view=${r.Id}`;

const can = (pageKey, ...actions) => (req) => hasAnyPageAction(req, pageKey, actions);
const userIdOf = (req) => Number(req.user?.userId ?? req.user?.id) || null;

// Each queue: who may act (permit), which records (from/where), how long they
// have waited (since; sinceIs "overdue" when it is a due date), where a row
// opens (link, default the booking) and where the full list is (listLink).
// Order = the order of the sale, so the page reads like the journey.
const QUEUES = [
  {
    key: "applications-draft",
    title: "Applications to finish",
    note: "Started but not submitted",
    action: "Resume",
    permit: can("crm-applications", "create", "edit"),
    from: `
      FROM dbo.CrmApplication a
      LEFT JOIN dbo.CrmCustomer c ON c.Id = a.CustomerId`,
    cols: `a.Id, a.ApplicationNo AS Ref, COALESCE(c.CustomerName, a.ApplicantName) AS Name,
           a.InterestedProject AS Project, a.InterestedUnit AS Unit`,
    where: `a.IsActive = 1 AND a.Status = '${CrmStatus.DRAFT}'
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.ApplicationId = a.Id AND bk.IsActive = 1 AND bk.Status NOT IN ${DEAD_BOOKING_SQL})`,
    since: "COALESCE(a.UpdatedAt, a.CreatedAt)",
    projectColumn: "a.ProjectId",
    link: (r) => `/crm/applications?edit=${r.Id}`,
    listLink: "/crm/applications",
  },
  {
    key: "bookings-sent-back",
    listLink: "/crm/bookings",
    title: "Bookings sent back to you",
    note: "Returned for correction — fix and send again",
    action: "Fix",
    permit: can("crm-bookings", "edit"),
    where: `${atStage(STAGE_REVIEW)} AND b.RejectedFromStage IS NOT NULL`,
    since: "b.RejectedAt",
    extra: "b.StageRemarks AS Remark",
  },
  {
    key: "data-review",
    listLink: "/crm/bookings",
    title: stageLabel(STAGE_REVIEW),
    note: "Verify each tab, then send for approval",
    action: "Review",
    permit: (req) => isApproverFor("crm-booking-verification", userIdOf(req), req.user?.role),
    where: `${atStage(STAGE_REVIEW)} AND b.RejectedFromStage IS NULL`,
    since: "COALESCE(b.UpdatedAt, b.CreatedAt)",
  },
  {
    key: "marketing-approval",
    listLink: "/crm/bookings",
    title: stageLabel(STAGE_MARKETING),
    note: "Waiting for your approval",
    action: "Approve",
    permit: (req) => canApproveStage(req.user?.role, STAGE_MARKETING, userIdOf(req)),
    where: atStage(STAGE_MARKETING),
    since: "b.ReadyForApprovalAt",
    extra: "b.StageRemarks AS Remark",
  },
  {
    key: "director-approval",
    listLink: "/crm/bookings",
    title: stageLabel(STAGE_DIRECTOR),
    note: "Waiting for your approval",
    action: "Approve",
    permit: (req) => canApproveStage(req.user?.role, STAGE_DIRECTOR, userIdOf(req)),
    where: atStage(STAGE_DIRECTOR),
    since: "b.ReadyForApprovalAt",
  },
  {
    key: "welcome-calls",
    title: "Welcome calls due",
    note: "Approved bookings with no welcome call yet",
    action: "Call",
    permit: can("crm-welcome-calls", "view"),
    where: WELCOME_CALL_DUE_SQL,
    since: "COALESCE(b.ConfirmedAt, b.UpdatedAt)",
    link: (r) => `/crm/welcome-calls?bookingId=${r.Id}`,
    listLink: "/crm/welcome-calls",
  },
  {
    key: "agreements",
    title: "Agreements to prepare",
    note: "None drawn up, or in draft over 5 days",
    action: "Open",
    permit: can("crm-agreements", "view"),
    where: AGREEMENT_NEEDS_ACTION_SQL,
    since: "COALESCE(b.ConfirmedAt, b.UpdatedAt)",
    link: (r) => `/crm/agreements?bookingId=${r.Id}`,
    listLink: "/crm/agreements",
  },
  {
    key: "overdue-payments",
    title: "Overdue payments",
    note: "A demand is past its due date",
    action: "Open",
    permit: can("crm-payments", "view"),
    where: `${DEMAND_BOOKING_LIVE_SQL}
      AND EXISTS (SELECT 1 FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND ${MILESTONE_OVERDUE_SQL})`,
    since: `(SELECT MIN(m.DueDate) FROM dbo.CrmPaymentMilestone m WHERE m.BookingId = b.Id AND ${MILESTONE_OVERDUE_SQL})`,
    link: (r) => `/crm/payments?bookingId=${r.Id}`,
    listLink: "/crm/payments",
    sinceIs: "overdue",
  },
];

module.exports = {
  QUEUES,
  BOOKING_FROM,
  BOOKING_COLS,
  bookingLink,
  WELCOME_CALL_DUE_SQL,
  AGREEMENT_NEEDS_ACTION_SQL,
  DEMAND_BOOKING_LIVE_SQL,
  MILESTONE_OVERDUE_SQL,
};
