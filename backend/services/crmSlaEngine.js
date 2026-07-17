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
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly, same cadence as escalationEngine.js
const COOLDOWN_HOURS = 24; // don't re-notify the same overdue record within this window

// Customer side has no Users.id to notify through — a CrmCommunicationLog
// entry is the customer-facing record of the reminder (visible to staff on
// the Communicator page, and to the customer via the portal timeline's
// active-hold banner, which always reflects live HoldUntil regardless of
// when this last ran).
async function logCustomerNotice(pool, applicationId, subject, summary) {
  await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("subj", sql.NVarChar(300), subject)
    .input("sum", sql.NVarChar(sql.MAX), summary)
    .query(`
      INSERT INTO dbo.CrmCommunicationLog (ApplicationId, Channel, Direction, Subject, Summary, ContactedAt, CreatedAt)
      VALUES (@aid, 'System', 'Outbound', @subj, @sum, SYSDATETIME(), SYSDATETIME())
    `);
}

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
        row.Id, "service_ticket");
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
        row.Id, "payment_milestone");
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
        row.Id, "crm_booking");
      return true;
    },
  },
  {
    // Fires once per Active hold, whenever this run first sees it past
    // HoldUntil. Flips it back to Available (Status='Expired') and notifies
    // both the assigned salesperson and the customer — this is the actual
    // "auto switch back to Available after N days" the hold engine promises.
    entityType: "crm-hold-expiry",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT h.Id, h.EntityType, h.EntityId, h.ApplicationId, h.HoldUntil,
               a.ApplicantName, a.AssignedTo,
               u.UnitName, s.SlotNo
        FROM dbo.CrmInventoryHold h
        JOIN dbo.CrmApplication a ON a.Id = h.ApplicationId
        LEFT JOIN dbo.UnitMaster u ON h.EntityType = 'Unit' AND u.Id = h.EntityId
        LEFT JOIN dbo.ParkingSlot s ON h.EntityType = 'Parking' AND s.Id = h.EntityId
        WHERE h.Status = 'Active' AND h.HoldUntil < SYSDATETIME()
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      await pool.request().input("id", sql.Int, row.Id)
        .query("UPDATE dbo.CrmInventoryHold SET Status = 'Expired' WHERE Id = @id");
      const label = row.EntityType === "Unit" ? `Unit ${row.UnitName}` : `Parking slot ${row.SlotNo}`;
      await logCustomerNotice(pool, row.ApplicationId, "Hold Expired",
        `Your hold on ${label} has expired and it is now available to other buyers.`);
      if (row.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_hold_expired",
          "Hold Expired",
          `${label} — hold for ${row.ApplicantName} has expired and is now back to Available.`,
          row.Id, "crm_inventory_hold");
      }
      return true;
    },
  },
  {
    // Daily reminder while a hold is still active — the 24h cooldown via
    // CrmSlaEscalationLog is what turns the hourly engine tick into an
    // actual once-a-day cadence for this entry.
    entityType: "crm-hold-reminder",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT h.Id, h.EntityType, h.EntityId, h.ApplicationId, h.HoldUntil,
               a.ApplicantName, a.AssignedTo,
               u.UnitName, s.SlotNo
        FROM dbo.CrmInventoryHold h
        JOIN dbo.CrmApplication a ON a.Id = h.ApplicationId
        LEFT JOIN dbo.UnitMaster u ON h.EntityType = 'Unit' AND u.Id = h.EntityId
        LEFT JOIN dbo.ParkingSlot s ON h.EntityType = 'Parking' AND s.Id = h.EntityId
        WHERE h.Status = 'Active' AND h.HoldUntil >= SYSDATETIME()
          AND ${NOT_RECENTLY_ESCALATED("'crm-hold-reminder'", "h.Id")}
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      const label = row.EntityType === "Unit" ? `Unit ${row.UnitName}` : `Parking slot ${row.SlotNo}`;
      const daysLeft = Math.max(0, Math.ceil((new Date(row.HoldUntil) - Date.now()) / 86400000));
      await logCustomerNotice(pool, row.ApplicationId, "Hold Reminder",
        `Reminder: your hold on ${label} expires in ${daysLeft} day(s) (${new Date(row.HoldUntil).toLocaleDateString("en-IN")}). Confirm your booking before it releases.`);
      if (row.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_hold_reminder",
          "Hold Reminder",
          `${label} — hold for ${row.ApplicantName} expires in ${daysLeft} day(s). Follow up before it auto-releases.`,
          row.Id, "crm_inventory_hold");
      }
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
