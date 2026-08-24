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
const { advanceApplicationStatus, syncApplicationOnBookingTerminal } = require("./crmApplicationWorkflow");
const { logCrmAudit } = require("./crmAudit");
const { findActiveHold, releaseHold } = require("./crmHoldService");
const { releaseAllParkingForBooking } = require("../routes/crmParking");
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
      // Re-check status atomically before writing — a staff member could have
      // converted this hold into a real Booking (flipping it to 'Converted')
      // in the narrow window between this run's fetch() and this write.
      // Same guard pattern as crm-booking-confirm-expiry below.
      const claimed = await pool.request().input("id", sql.Int, row.Id)
        .query("UPDATE dbo.CrmInventoryHold SET Status = 'Expired' OUTPUT INSERTED.Id WHERE Id = @id AND Status = 'Active'");
      if (!claimed.recordset.length) return false; // already Converted/Released — skip cascade
      const label = row.EntityType === "Unit" ? `Unit ${row.UnitName}` : `Parking slot ${row.SlotNo}`;
      await logCustomerNotice(pool, row.ApplicationId, "Hold Expired",
        `Your hold on ${label} has expired and it is now available to other buyers.`);
      if (row.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_hold_expired",
          "Hold Expired",
          `${label} — hold for ${row.ApplicantName} has expired and is now back to Available.`,
          row.Id, "crm_inventory_hold");
      }

      // If this was the LAST thing keeping the Application open — no other
      // still-Active hold, and it never got Approved into a real Booking —
      // move the Application itself into a distinct terminal status instead
      // of leaving it sitting in Draft/Pending forever with no visible sign
      // anything happened. Never deletes the row — status-only, same as
      // every other terminal transition here, so the Application stays in
      // CrmApplicationStatusLog's audit trail permanently. Scoped to
      // Draft/Pending only: an Approved application already has a real
      // Booking (its hold would have been Converted, not still Active), so
      // this can never fire against a live sale.
      const app = await pool.request().input("aid", sql.Int, row.ApplicationId)
        .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @aid AND IsActive = 1");
      if (app.recordset.length && ["Draft", "Pending"].includes(app.recordset[0].Status)) {
        const otherActive = await pool.request().input("aid", sql.Int, row.ApplicationId)
          .query("SELECT TOP 1 Id FROM dbo.CrmInventoryHold WHERE ApplicationId = @aid AND Status = 'Active'");
        if (!otherActive.recordset.length) {
          await advanceApplicationStatus(pool, row.ApplicationId, "Expired",
            "HoldExpiry", `Auto-expired — ${label} hold expired with no other active hold on this application.`,
            null, { force: true });
        }
      }
      return true;
    },
  },
  {
    // A Booking existing does NOT mean "Booked" anymore — the Unit/Parking
    // Matrix only shows Booked once it's Approved AND its booking-amount
    // milestone is Paid (see unitMatrix.js/parkingMatrix.js). Until then it
    // still occupies the SAME 3-day window the original hold promised
    // (ConfirmDeadline, snapshotted at Booking creation — see
    // crmEntityCreation.js). If that window passes with the Booking still
    // unconfirmed, the Booking itself auto-expires here — the Unit/Parking
    // genuinely frees up for someone else, exactly like an unconverted hold
    // would, instead of sitting Pending forever with inventory silently
    // locked behind it.
    entityType: "crm-booking-confirm-expiry",
    async fetch(pool) {
      const r = await pool.request().query(`
        SELECT bk.Id, bk.BookingNo, bk.ApplicationId, bk.UnitId, bk.AssignedTo,
               a.ApplicantName, u.UnitName
        FROM dbo.CrmBooking bk
        JOIN dbo.CrmApplication a ON a.Id = bk.ApplicationId
        LEFT JOIN dbo.UnitMaster u ON u.Id = bk.UnitId
        WHERE bk.IsActive = 1 AND bk.Status NOT IN ('Approved', 'Cancelled', 'Rejected', 'Expired')
          AND bk.ConfirmDeadline IS NOT NULL AND bk.ConfirmDeadline < SYSDATETIME()
      `);
      return r.recordset;
    },
    async notify(pool, row) {
      // Re-check-and-write in one statement rather than trusting the fetch()
      // snapshot — staff could have approved/cancelled/rejected this exact
      // Booking in the moments between this run's fetch and this write (the
      // engine runs hourly, but the window isn't zero). Only actually
      // expires it, and only runs the release cascade below, if it's still
      // genuinely in a state this sweep should touch.
      const claimed = await pool.request().input("id", sql.Int, row.Id).query(`
        UPDATE dbo.CrmBooking SET Status = 'Expired'
        OUTPUT INSERTED.Id
        WHERE Id = @id AND IsActive = 1 AND Status NOT IN ('Approved', 'Cancelled', 'Rejected', 'Expired')
      `);
      if (!claimed.recordset.length) return false;

      await logCrmAudit(pool, "Booking", row.Id, null, [
        { field: "Status", oldVal: "Pending", newVal: "Expired" },
      ]);

      // Free the Unit back up — release its hold if the sweep hasn't
      // already caught it separately (it may still be 'Converted', not
      // 'Active', since guardAndConvertHold ran at Booking creation; only
      // release what's actually still Active).
      const unitHold = await findActiveHold(pool, "Unit", row.UnitId);
      if (unitHold) await releaseHold(pool, unitHold.Id, null);

      // Same cascade a real Booking cancellation performs for parking
      // (crmCancellations.js) — an unpaid milestone tied to a now-dead
      // Booking must go too, or it'd sit forever demanding payment for a
      // sale that no longer exists.
      try { await releaseAllParkingForBooking(pool, row.Id); }
      catch (parkErr) { console.error("[crm-sla-engine] parking release on booking expiry failed:", parkErr.message); }

      // Same reasoning as the Application-expiry cascade above and the
      // manual cancel/reject cascades in crmCancellations.js/crmBookings.js
      // — the Application was force-advanced to 'Approved' the instant this
      // Booking was created and nothing has touched it since. Without this
      // it would sit at 'Approved' forever with an Expired Booking
      // underneath, indistinguishable from a genuinely active sale.
      await syncApplicationOnBookingTerminal(pool, row.Id, "Expired", "BookingConfirmExpiry",
        `Auto-expired — its Booking (${row.BookingNo}) was never confirmed in time.`, null);

      const label = row.UnitName ? `Unit ${row.UnitName}` : row.BookingNo;
      await logCustomerNotice(pool, row.ApplicationId, "Booking Expired",
        `Your booking for ${label} was not confirmed (approved and paid) in time and has expired. It is now available to other buyers.`);
      if (row.AssignedTo) {
        await emitNotification(pool, row.AssignedTo, "crm_booking_confirm_expired",
          "Booking Expired — Not Confirmed In Time",
          `${row.BookingNo} (${row.ApplicantName}) — ${label} was never approved/paid within its window and has expired.`,
          row.Id, "crm_booking");
      }
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
        row.Id, "crm_sales_deed");
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
        row.Id, "crm_possession_notice");
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
