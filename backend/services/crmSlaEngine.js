/**
 * Generic, registry-based SLA/reminder engine for the CRM module.
 *
 * Unlike backend/escalationEngine.js (hardcoded to 4 legacy "Followup"
 * tables, one bespoke function per table, no way to add an entity without
 * writing new code), this engine covers any CRM entity with a due-date
 * column purely by adding a REGISTRY entry — no new function, no new
 * schema check, no code change to the runner itself.
 *
 * Each registry entry declares:
 *   entityType   — stable string key, also the CrmSlaEscalationLog tag
 *   query        — SQL selecting overdue rows not yet escalated (joins its
 *                  own de-dup check against CrmSlaEscalationLog so entries
 *                  stay self-contained)
 *   notify(pool, row) — how to notify for one overdue row
 *
 * Runs on a schedule (see startCrmSlaEngine) and is also reachable on
 * demand via POST /api/crm/sla-engine/run for manual/admin-triggered runs.
 */
const { getPool, sql } = require("../db");
const { emitNotification } = require("./notify");

// Phone apps that show CRM follow-up work; SLA reminders are pushed to these only.
const SLA_PUSH = { push: true, apps: ["follow-up", "admin"] };
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly, same cadence as escalationEngine.js

const COOLDOWN_HOURS = 24; // don't re-notify the same overdue record within this window

// Shared de-dup clause: an entity is only "due for escalation" if it hasn't
// already been escalated within the cooldown window.
const NOT_RECENTLY_ESCALATED = (entityTypeParam, idExpr) => `
  NOT EXISTS (
    SELECT 1 FROM dbo.CrmSlaEscalationLog l
    WHERE l.EntityType = ${entityTypeParam} AND l.EntityId = ${idExpr}
      AND l.EscalatedAt > DATEADD(HOUR, -${COOLDOWN_HOURS}, SYSDATETIME())
  )
`;

const REGISTRY = [
  {
    entityType: "crm-service-ticket",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT t.Id, t.TicketNo, t.Subject, t.SlaDueDate, t.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmServiceTicket t
        JOIN dbo.CrmBooking b ON b.Id = t.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE t.SlaDueDate < SYSDATETIME() AND t.Status NOT IN ('Resolved', 'Closed')
          AND ${NOT_RECENTLY_ESCALATED("'crm-service-ticket'", "t.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      if (!row.AssignedTo) return false;
      await emitNotification(pool, row.AssignedTo, "sla_ticket_overdue",
        "Ticket SLA Breached",
        `${row.TicketNo}: ${row.Subject} (${row.ApplicantName} · ${row.BookingNo}) is past its SLA due date.`,
        row.Id, "service_ticket", SLA_PUSH);
      return true;
    },
  },
  {
    entityType: "crm-payment-milestone",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT m.Id, m.MilestoneName, m.AmountDue, m.AmountPaid, m.DueDate, b.BookingNo, b.AssignedTo, a.ApplicantName
        FROM dbo.CrmPaymentMilestone m
        JOIN dbo.CrmBooking b ON b.Id = m.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE m.Status = 'Pending' AND m.DueDate < CAST(SYSDATETIME() AS DATE)
          AND ${NOT_RECENTLY_ESCALATED("'crm-payment-milestone'", "m.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      if (!row.AssignedTo) return false;
      const balance = (row.AmountDue || 0) - (row.AmountPaid || 0);
      await emitNotification(pool, row.AssignedTo, "sla_payment_overdue",
        "Payment Overdue",
        `${row.ApplicantName} · ${row.BookingNo} — ${row.MilestoneName} overdue (₹${balance.toLocaleString("en-IN")} pending)`,
        row.Id, "payment_milestone", SLA_PUSH);
      return true;
    },
  },
  {
    entityType: "crm-welcome-call-followup",
    async fetch(pool) {
      // Only the latest call per booking matters — an older call's
      // NextCallDate is moot once a newer call has been logged.
      const r = await pool.request().query(`
        SELECT wc.Id, wc.NextCallDate, b.AssignedTo, b.BookingNo, a.ApplicantName
        FROM dbo.CrmWelcomeCall wc
        JOIN dbo.CrmBooking b ON b.Id = wc.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE wc.Outcome <> 'Welcomed' AND wc.NextCallDate < CAST(SYSDATETIME() AS DATE)
          AND wc.Id = (SELECT TOP 1 Id FROM dbo.CrmWelcomeCall WHERE BookingId = wc.BookingId ORDER BY CallDate DESC, CreatedAt DESC)
          AND ${NOT_RECENTLY_ESCALATED("'crm-welcome-call-followup'", "wc.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      if (!row.AssignedTo) return false;
      await emitNotification(pool, row.AssignedTo, "sla_followup_call_due",
        "Follow-up Call Overdue",
        `${row.ApplicantName} · ${row.BookingNo} — scheduled follow-up call is overdue.`,
        row.Id, "crm_booking", SLA_PUSH);
      return true;
    },
  },
  {
    // Notifies the assigned salesperson when a Sale Deed's RegistrationDeadline
    // passes without a RegistrationNo being recorded (C6 — RERA compliance).
    // Status is re-derived on each GET by deriveDeedStatus(), so no status
    // mutation needed here — just the notification.
    entityType: "crm-sales-deed-registration",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT d.Id, d.DeedNo, d.RegistrationDeadline, b.BookingNo, b.AssignedTo, a.ApplicantName
        FROM dbo.CrmSalesDeed d
        JOIN dbo.CrmBooking b ON b.Id = d.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE d.RegistrationDeadline IS NOT NULL
          AND d.RegistrationDeadline < CAST(SYSDATETIME() AS DATE)
          AND d.RegistrationNo IS NULL
          AND d.Status NOT IN ('Registered','Cancelled')
          AND b.IsActive = 1
          AND ${NOT_RECENTLY_ESCALATED("'crm-sales-deed-registration'", "d.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      if (!row.AssignedTo) return false;
      const deadline = row.RegistrationDeadline ? new Date(row.RegistrationDeadline).toLocaleDateString("en-IN") : "—";
      await emitNotification(pool, row.AssignedTo, "sla_registration_overdue",
        "Sale Deed Registration Overdue",
        `${row.DeedNo} (${row.BookingNo} · ${row.ApplicantName}) — registration deadline was ${deadline}. RegistrationNo not yet recorded.`,
        row.Id, "crm_sales_deed", SLA_PUSH);
      return true;
    },
  },
  {
    // C9 — Possession notice response overdue: fires when ResponseDeadline passes
    // and the notice is still in 'Sent' status (customer hasn't acknowledged or disputed).
    entityType: "crm-possession-response-overdue",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT pn.Id, pn.NoticeNo, pn.BookingId, pn.ResponseDeadline,
               b.BookingNo, b.AssignedTo, a.ApplicantName
        FROM dbo.CrmPossessionNotice pn
        JOIN dbo.CrmBooking b ON b.Id = pn.BookingId
        JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
        WHERE pn.Status = 'Sent'
          AND pn.ResponseDeadline < CAST(GETDATE() AS DATE)
          AND b.IsActive = 1
          AND ${NOT_RECENTLY_ESCALATED("'crm-possession-response-overdue'", "pn.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      if (!row.AssignedTo) return false;
      const deadline = row.ResponseDeadline
        ? new Date(row.ResponseDeadline).toLocaleDateString("en-IN")
        : "—";
      await emitNotification(pool, row.AssignedTo, "sla_possession_response_overdue",
        "Possession Notice Response Overdue",
        `${row.NoticeNo} (${row.BookingNo} · ${row.ApplicantName}) — response deadline was ${deadline} and the customer has neither acknowledged nor disputed.`,
        row.Id, "crm_possession_notice", SLA_PUSH);
      return true;
    },
  },
];

async function logEscalation(pool, entityType, entityId) {
  await pool.request()
    .input("et", sql.NVarChar(50), entityType)
    .input("eid", sql.Int, entityId)
    .query("INSERT INTO dbo.CrmSlaEscalationLog (EntityType, EntityId, EscalatedAt) VALUES (@et, @eid, SYSDATETIME())");
}

async function runCrmSlaCheck() {
  const pool = getPool();
  const summary = {};
  for (const entry of REGISTRY) {
    let notified = 0;
    const rows = await entry.fetch(pool);
    for (const row of rows) {
      const wasNotified = await entry.notify(pool, row);
      // Always log, even when there's no assignee to notify — otherwise an
      // unassigned overdue record would be re-scanned (and skipped) every
      // single run forever instead of surfacing once and moving on.
      await logEscalation(pool, entry.entityType, row.Id);
      if (wasNotified) notified++;
    }
    summary[entry.entityType] = { overdue: rows.length, notified };
  }
  return summary;
}

let timer = null;
function startCrmSlaEngine() {
  const run = () => {
    runCrmSlaCheck()
      .then((summary) => {
        const totalOverdue = Object.values(summary).reduce((s, v) => s + v.overdue, 0);
        const totalNotified = Object.values(summary).reduce((s, v) => s + v.notified, 0);
        // Nothing overdue is the common case (runs hourly) — skip the log
        // line entirely rather than printing an all-zero summary every run.
        if (totalOverdue === 0) return;
        logger.info({ event: "CRM_SLA_RUN_DONE", totalOverdue, totalNotified, summary }, "CRM SLA check complete");
      })
      .catch((e) => logger.error({ event: "CRM_SLA_RUN_FAILED", err: e.message }, "CRM SLA check failed"));
  };
  run(); // once at boot, matching escalationEngine.js's pattern
  timer = setInterval(run, INTERVAL_MS);
}
function stopCrmSlaEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runCrmSlaCheck, startCrmSlaEngine, stopCrmSlaEngine, REGISTRY };
