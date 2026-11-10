// CRM attention conditions — "what is waiting" rules read by the CRM
// Dashboard's alert counts (routes/crmDashboard.js), kept here once so a rule
// such as "a welcome call is due" is never written twice.
const { CrmStatus, DEAD_BOOKING_SQL } = require("../constants/crmStatuses");
const { onAccountWithAvailableSql, recordedMoneySql } = require("./crmPaymentFunding");

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
// Account, what is entered and waiting for Finance, and what is entered but not yet with Finance. The payment page's
// per-row stage (crmPayments.js GET /booking/:id) is the same rule.
const MILESTONE_DUES_UPTO_SQL = `(SELECT ISNULL(SUM(CASE WHEN p.Status = 'Waived' OR p.AmountDue <= ISNULL(p.AmountPaid, 0) THEN 0 ELSE p.AmountDue - ISNULL(p.AmountPaid, 0) END), 0)
       FROM dbo.CrmPaymentMilestone p
       WHERE p.BookingId = m.BookingId AND (p.MilestoneNo < m.MilestoneNo OR (p.MilestoneNo = m.MilestoneNo AND p.Id <= m.Id)))`;
const BOOKING_MONEY_IN_SQL = `ISNULL((SELECT SUM(o.AvailableAmount) FROM ${onAccountWithAvailableSql("o")} WHERE o.BookingId = m.BookingId), 0)
      + ISNULL((SELECT SUM(rp.RPAmount) FROM dbo.ReceivedPayment rp WHERE rp.CrmBookingId = m.BookingId AND rp.RPStatus = N'Pending'), 0)
      + ${recordedMoneySql("m.BookingId")}`;
const MILESTONE_DUE_DATE_PASSED_SQL = `m.Status = '${CrmStatus.PENDING}' AND m.DueDate < CAST(SYSDATETIME() AS DATE)`;
const MILESTONE_OVERDUE_SQL = `${MILESTONE_DUE_DATE_PASSED_SQL}
  AND ${MILESTONE_DUES_UPTO_SQL}
    > ${BOOKING_MONEY_IN_SQL} + 0.009`;

// The same rule for a list of milestones: one CROSS APPLY, then whether each is overdue and how much of it is missing.
const MILESTONE_COVER_APPLY = `CROSS APPLY (SELECT ${MILESTONE_DUES_UPTO_SQL} AS Upto, ${BOOKING_MONEY_IN_SQL} AS MoneyIn) cov`;
const COVER_OVERDUE_TEST = `${MILESTONE_DUE_DATE_PASSED_SQL} AND cov.Upto > cov.MoneyIn + 0.009`;
const COVER_IS_OVERDUE_SQL = `CASE WHEN ${COVER_OVERDUE_TEST} THEN 1 ELSE 0 END`;
// How much of a milestone is still to come, overdue or not: the Balance to collect on Payment Milestones, line by line.
const COVER_MISSING_SQL = `CASE WHEN m.Status <> '${CrmStatus.PENDING}' OR cov.Upto - cov.MoneyIn <= 0.009 THEN 0
  WHEN cov.Upto - cov.MoneyIn >= m.AmountDue - ISNULL(m.AmountPaid, 0) THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE cov.Upto - cov.MoneyIn END`;
const COVER_OVERDUE_SHORT_SQL = `CASE WHEN NOT (${COVER_OVERDUE_TEST}) THEN 0
  WHEN cov.Upto - cov.MoneyIn >= m.AmountDue - ISNULL(m.AmountPaid, 0) THEN m.AmountDue - ISNULL(m.AmountPaid, 0) ELSE cov.Upto - cov.MoneyIn END`;

// ── Sent back / resubmitted ─────────────────────────────────────────────────
// Read-only. Finds, from what each flow already records, the entries a checker
// or approver sent back (the maker must update them) and the ones corrected
// and sent in again (the checker must look again). Nothing here changes any
// workflow; every list, banner and count reads these same rows.
const SENT_BACK = "SentBack";       // with the maker, to update
const RESUBMITTED = "Resubmitted";  // with the checker, to recheck
const LIVE_BOOKING_SQL = `b.IsActive = 1 AND b.Status NOT IN ${DEAD_BOOKING_SQL}`;

// Approvals run by the shared engine (approvalService MODULE_MAP gives each
// one's table / key / status column): what names the record, which booking
// it belongs to, and where it opens.
const ENGINE_SENT_BACK = {
  "crm-agreements":          { area: "Agreement",                path: "/crm/agreements",        no: "AgreementNo",    booking: "BookingId",     link: "/crm/agreements?id={id}" },
  "crm-agreement-date":      { area: "Agreement date",           path: "/crm/agreements",        no: "AgreementNo",    booking: "BookingId",     link: "/crm/agreements?id={id}" },
  "crm-cancellations":       { area: "Cancellation",             path: "/crm/cancellations",     no: "CancellationNo", booking: "BookingId",     link: "/crm/cancellations?bookingId={bookingId}" },
  "crm-refunds":             { area: "Refund",                   path: "/crm/refunds",           no: "RefundNo",       booking: "BookingId",     link: "/crm/refunds?search={no}" },
  "crm-resales":             { area: "Resale",                   path: "/crm/resales",           no: null,             booking: "FromBookingId", link: "/crm/resales/{id}" },
  "crm-ownership-changes":   { area: "Ownership change",         path: "/crm/ownership-changes", no: "ChangeNo",       booking: "BookingId",     link: "/crm/ownership-changes?id={id}" },
  "crm-credit-notes":        { area: "Credit note",              path: "/crm/credit-notes",      no: "DocNo",          booking: "BookingId",     link: "/crm/credit-notes?id={id}" },
  "crm-credit-note-cancel":  { area: "Credit note cancellation", path: "/crm/credit-notes",      no: "DocNo",          booking: "BookingId",     link: "/crm/credit-notes?id={id}" },
  "crm-transfer-deeds":      { area: "Transfer deed",            path: "/crm/transfer-deeds",    no: "DeedNo",         booking: "BookingId",     link: "/crm/transfer-deeds?id={id}" },
  "crm-transfer-deed-date":  { area: "Transfer deed date",       path: "/crm/transfer-deeds",    no: "DeedNo",         booking: "BookingId",     link: "/crm/transfer-deeds?id={id}" },
  "crm-milestone-waiver":    { area: "Milestone waiver",         path: "/crm/payments",          no: null,             booking: "BookingId",     link: "/crm/payments?bookingId={bookingId}" },
  "crm-noc":                 { area: "NOC",                      path: "/crm/noc",               no: "NocNo",          booking: "BookingId",     link: "/crm/noc?bookingId={bookingId}" },
  "crm-sales-deed-senior":   { area: "Sale deed",                path: "/crm/sales-deed",        no: "DeedNo",         booking: "BookingId",     link: "/crm/sales-deed?deedId={id}" },
  "crm-sales-deed-director": { area: "Sale deed (Director)",     path: "/crm/sales-deed",        no: "DeedNo",         booking: "BookingId",     link: "/crm/sales-deed?deedId={id}" },
  "crm-brokerage":           { area: "Brokerage",                path: "/crm/brokerage",         no: null,             booking: "BookingId",     link: "/crm/brokerage?view={id}" },
};
// The three flows that keep their own record of a send-back.
const OWN_SENT_BACK = {
  // Both also show on Applications: a booking sent back, or a flagged
  // data-review item, is corrected by the preparer on the application.
  booking: { area: "Booking approval",    path: "/crm/bookings", also: "/crm/applications", link: "/crm/bookings?view={bookingId}" },
  review:  { area: "Booking data review", path: "/crm/bookings", also: "/crm/applications", link: "/crm/bookings?view={bookingId}" },
  payment: { area: "Payment",             path: "/crm/payments", link: "/crm/payments?bookingId={bookingId}" },
};

// Every source as one row shape:
//   Kind, RecordId, RecordNo, BookingId, BookingNo, ProjectId, ApplicationId, Stage, FromStage, State, Item, ItemKey, Reason, ByName, At
function sentBackRowsSql() {
  const { MODULE_MAP } = require("./approvalService");
  const engine = Object.entries(ENGINE_SENT_BACK).map(([key, m]) => {
    const mm = MODULE_MAP[key];
    if (!mm) return null;
    const table = mm.table.replace("dbo.", "");
    const x = (c) => `x.[${c}]`;
    return `
    SELECT N'${key}' AS Kind, ${x(mm.pk)} AS RecordId, ${m.no ? `CAST(${x(m.no)} AS NVARCHAR(60))` : "b.BookingNo"} AS RecordNo,
           b.Id AS BookingId, b.BookingNo, b.ProjectId, b.ApplicationId, b.WorkflowStage AS Stage, b.RejectedFromStage AS FromStage,
           CASE WHEN ${x(mm.status)} = 'Rejected' THEN '${SENT_BACK}' ELSE '${RESUBMITTED}' END AS State,
           CAST(NULL AS NVARCHAR(200)) AS Item, CAST(NULL AS NVARCHAR(50)) AS ItemKey, al.Note AS Reason, al.ApproverEmail AS ByName, al.ActionAt AS At
    FROM ${mm.table} x
    JOIN dbo.CrmBooking b ON b.Id = ${x(m.booking)}
    OUTER APPLY (SELECT TOP 1 l.Note, l.ApproverEmail, l.ActionAt FROM dbo.ApprovalAuditLog l
                 WHERE l.TableName = N'${table}' AND l.RecordId = ${x(mm.pk)} AND l.ActionStatus = 'Rejected'
                 ORDER BY l.ActionAt DESC) al
    WHERE ${LIVE_BOOKING_SQL} AND (${x(mm.status)} = 'Rejected' OR (${x(mm.status)} = 'Pending' AND al.ActionAt IS NOT NULL))`;
  }).filter(Boolean);

  return [
    // Booking approval: a reject bounces it back one stage and stamps
    // RejectedFromStage + StageRemarks; sent again, it is back at the stage
    // that bounced it until that stage approves.
    `SELECT N'booking' AS Kind, b.Id AS RecordId, b.BookingNo AS RecordNo, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.ApplicationId, b.WorkflowStage AS Stage, b.RejectedFromStage AS FromStage,
            CASE WHEN b.RejectedFromStage IS NOT NULL THEN '${SENT_BACK}' ELSE '${RESUBMITTED}' END AS State,
            CAST(NULL AS NVARCHAR(200)) AS Item, CAST(NULL AS NVARCHAR(50)) AS ItemKey,
            CASE WHEN b.RejectedFromStage IS NOT NULL THEN b.StageRemarks ELSE lg.Remarks END AS Reason,
            COALESCE(CASE WHEN b.RejectedFromStage IS NOT NULL THEN ru.name END, lu.name) AS ByName,
            CASE WHEN b.RejectedFromStage IS NOT NULL THEN b.RejectedAt ELSE lg.CreatedAt END AS At
     FROM dbo.CrmBooking b
     OUTER APPLY (SELECT TOP 1 g.Stage, g.Remarks, g.ActorId, g.CreatedAt FROM dbo.CrmBookingStageLog g
                  WHERE g.BookingId = b.Id AND g.Action = 'BouncedBackForCorrection' ORDER BY g.CreatedAt DESC) lg
     LEFT JOIN dbo.Users ru ON ru.id = b.RejectedBy
     LEFT JOIN dbo.Users lu ON lu.id = lg.ActorId
     WHERE ${LIVE_BOOKING_SQL} AND (b.RejectedFromStage IS NOT NULL OR (lg.Stage IS NOT NULL AND b.WorkflowStage = lg.Stage))`,
    // Data review: a flagged item keeps its reason in Remarks; the
    // preparer's resubmit puts it back to Pending with that reason on it.
    `SELECT N'review' AS Kind, c.Id AS RecordId, b.BookingNo AS RecordNo, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.ApplicationId, b.WorkflowStage AS Stage, b.RejectedFromStage AS FromStage,
            CASE WHEN c.CheckStatus = 'NeedsRecheck' THEN '${SENT_BACK}' ELSE '${RESUBMITTED}' END AS State,
            CAST(c.ItemLabel AS NVARCHAR(200)) AS Item, CAST(c.ItemKey AS NVARCHAR(50)) AS ItemKey, c.Remarks AS Reason, cu.name AS ByName, c.CheckedAt AS At
     FROM dbo.CrmApplicationVerificationChecklist c
     JOIN dbo.CrmBooking b ON b.ApplicationId = c.ApplicationId
     LEFT JOIN dbo.Users cu ON cu.id = c.CheckedBy
     WHERE ${LIVE_BOOKING_SQL}
       AND (c.CheckStatus = 'NeedsRecheck' OR (c.CheckStatus = 'Pending' AND NULLIF(LTRIM(c.Remarks), '') IS NOT NULL))`,
    // Payments Finance returned: open until a newer entry for the same
    // milestone (or the booking's account) is made; that newer entry is then
    // "resubmitted" while it waits for Finance.
    `SELECT N'payment' AS Kind, rp.RPPaymentID AS RecordId, CAST(rp.RPDocNo AS NVARCHAR(60)) AS RecordNo, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.ApplicationId, b.WorkflowStage AS Stage, b.RejectedFromStage AS FromStage,
            '${SENT_BACK}' AS State, CAST(ISNULL(m.MilestoneName, N'On Account') AS NVARCHAR(200)) AS Item, CAST(NULL AS NVARCHAR(50)) AS ItemKey,
            rp.RPRejectionNote AS Reason, rp.RPRejectedBy AS ByName, rp.RPRejectedAt AS At
     FROM dbo.ReceivedPayment rp
     JOIN dbo.CrmBooking b ON b.Id = rp.CrmBookingId
     LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
     WHERE ${LIVE_BOOKING_SQL} AND rp.RPStatus = N'Rejected'
       AND NOT EXISTS (SELECT 1 FROM dbo.ReceivedPayment n WHERE n.CrmBookingId = rp.CrmBookingId
                       AND ISNULL(n.CrmMilestoneId, 0) = ISNULL(rp.CrmMilestoneId, 0)
                       AND n.RPPaymentID > rp.RPPaymentID AND n.RPStatus <> N'Rejected')`,
    `SELECT N'payment' AS Kind, rp.RPPaymentID AS RecordId, CAST(rp.RPDocNo AS NVARCHAR(60)) AS RecordNo, b.Id AS BookingId, b.BookingNo, b.ProjectId, b.ApplicationId, b.WorkflowStage AS Stage, b.RejectedFromStage AS FromStage,
            '${RESUBMITTED}' AS State, CAST(ISNULL(m.MilestoneName, N'On Account') AS NVARCHAR(200)) AS Item, CAST(NULL AS NVARCHAR(50)) AS ItemKey,
            prev.RPRejectionNote AS Reason, prev.RPRejectedBy AS ByName, prev.RPRejectedAt AS At
     FROM dbo.ReceivedPayment rp
     JOIN dbo.CrmBooking b ON b.Id = rp.CrmBookingId
     LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = rp.CrmMilestoneId
     CROSS APPLY (SELECT TOP 1 o.RPRejectionNote, o.RPRejectedBy, o.RPRejectedAt FROM dbo.ReceivedPayment o
                  WHERE o.CrmBookingId = rp.CrmBookingId AND ISNULL(o.CrmMilestoneId, 0) = ISNULL(rp.CrmMilestoneId, 0)
                    AND o.RPPaymentID < rp.RPPaymentID AND o.RPStatus = N'Rejected' ORDER BY o.RPPaymentID DESC) prev
     WHERE ${LIVE_BOOKING_SQL} AND rp.RPStatus = N'Pending'`,
    ...engine,
  ].join("\n    UNION ALL\n");
}

// A list filter: bookings / applications (column) with a booking approval or
// data review entry in this state. The same rows as everything else here.
const SENT_BACK_FILTERS = [SENT_BACK, RESUBMITTED];
function sentBackFilterSql(state, column, idField) {
  if (!SENT_BACK_FILTERS.includes(state)) return null;
  return `${column} IN (SELECT r.${idField} FROM (${sentBackRowsSql()}) r WHERE r.Kind IN (N'booking', N'review') AND r.State = '${state}')`;
}

// Where each row shows (menu path) and opens (link), from its Kind.
function describeSentBack(row) {
  const m = ENGINE_SENT_BACK[row.Kind] || OWN_SENT_BACK[row.Kind];
  if (!m) return null;
  const link = m.link.replace("{id}", row.RecordId).replace("{bookingId}", row.BookingId)
    .replace("{no}", encodeURIComponent(row.RecordNo || ""));
  return { area: m.area, path: m.path, also: m.also || null, link };
}

module.exports = {
  SENT_BACK,
  RESUBMITTED,
  sentBackRowsSql,
  describeSentBack,
  SENT_BACK_FILTERS,
  sentBackFilterSql,
  WELCOME_CALL_DUE_SQL,
  AGREEMENT_NEEDS_ACTION_SQL,
  DEMAND_BOOKING_LIVE_SQL,
  MILESTONE_OVERDUE_SQL,
  MILESTONE_COVER_APPLY,
  COVER_IS_OVERDUE_SQL,
  COVER_OVERDUE_SHORT_SQL,
  COVER_MISSING_SQL,
};
