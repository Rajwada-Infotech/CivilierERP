/**
 * CRM Application — the Cancel action, plus shared status-transition
 * plumbing used by a couple of system-triggered cascades.
 *
 * There is no Application-level approval step anymore — a Booking is
 * created straight off a submitted (Pending) Application (see
 * crmApplications.js PUT /:id/submit), no admin approve/reject gate in
 * between; all real review/approval now happens on the Booking itself
 * (crmBookingStageService.js). Both Approved and Rejected are legacy-only:
 * nothing in current code ever sets either one. Historical rows may still
 * carry Approved from when an "AutoBooking" force-advance genuinely ran
 * (see migration 241's one-time cleanup for the staleness that caused, and
 * createCrmBookingRecord in crmEntityCreation.js, which no longer contains
 * any such call) — this module does NOT reintroduce that cascade, since the
 * real "does this Application already have a live Booking" guard today is
 * Stage (computed live from CrmBooking's own existence/status — see
 * crmApplications.js's APP_SELECT), not CrmApplication.Status. Rejected
 * stays a valid terminal state for any old data that carries it
 * (resubmittable back to Pending via PUT /:id/submit).
 * This module keeps:
 *   - Cancel: a business action any editor can take, not an approval.
 *   - advanceApplicationStatus/syncApplicationOnBookingTerminal: shared
 *     plumbing so a Booking's Cancelled/Rejected/Expired terminal states
 *     still get mirrored onto the parent Application (used by the Cancel
 *     action and by crmBookings.js's admin-delete revert).
 * Every transition here is still written to CrmApplicationStatusLog for
 * audit purposes, distinct from ApprovalAuditLog (which approvalService.js's
 * transition() engine uses — still called from PUT /:id/submit for the
 * Rejected -> Pending resubmit case).
 */
const { sql } = require("../db");

// 'Expired' is a system-only terminal status — reached exclusively via the
// force-advance path (see crmSlaEngine.js's crm-hold-expiry handler), the
// same way AutoBooking force-advances to Approved. It's not reachable
// through any normal user-facing transition, so it's intentionally absent
// from the allowed-transitions lists below (force bypasses that check).
// Never a hard delete — the Application record stays, permanently
// distinguishable from a real Cancel/Reject in CrmApplicationStatusLog.
const APPLICATION_TRANSITIONS = {
  Draft:     ["Cancelled"],
  Pending:   ["Cancelled"],
  // Approved is deliberately NOT allowed to transition to Cancelled here.
  // Once an Application is Approved, "Cancel Application" is no longer the
  // right tool — Approved only ever gets set by AutoBooking, meaning a real
  // Booking now exists, so undoing the deal from this point on has to go
  // through the Booking's own Cancellation Request flow (crmCancellations.js:
  // request -> admin-approved -> refund/parking/hold/amendment cascade),
  // not a single-step self-service action. This is what keeps "accidentally
  // applied, let me cancel and redo it" (fine pre-approval) distinct from
  // "the deal fell through after approval" (needs the real cancellation
  // workflow, refund accounting, and an audit trail an editor shouldn't be
  // able to bypass with one click).
  Approved:  [],
  Rejected:  ["Cancelled"],
  Cancelled: [],
  Expired:   [],
};

async function logStatusChange(pool, applicationId, fromStatus, toStatus, trigger, remarks, actorId) {
  await pool.request()
    .input("aid",  sql.Int,  applicationId)
    .input("from", sql.NVarChar(30), fromStatus || null)
    .input("to",   sql.NVarChar(30), toStatus)
    .input("trig", sql.NVarChar(30), trigger)
    .input("rem",  sql.NVarChar(sql.MAX), remarks || null)
    .input("aby",  sql.Int,  actorId)
    .query(`
      INSERT INTO dbo.CrmApplicationStatusLog (ApplicationId, FromStatus, ToStatus, TriggerSource, Remarks, ActorId, CreatedAt)
      VALUES (@aid, @from, @to, @trig, @rem, @aby, SYSDATETIME())
    `);
}

/**
 * Attempts a transition. Returns { ok: true, from, to } or { ok: false, error }.
 * `force` skips the transition-table check — used only by AutoBooking, where
 * "no-op if already Approved" is the correct behavior rather than an error.
 */
async function advanceApplicationStatus(pool, applicationId, toStatus, trigger, remarks, actorId, { force = false } = {}) {
  const cur = await pool.request().input("id", sql.Int, applicationId)
    .query("SELECT Status FROM dbo.CrmApplication WHERE Id = @id AND IsActive = 1");
  if (!cur.recordset.length) return { ok: false, error: "Application not found" };

  const fromStatus = cur.recordset[0].Status;
  if (fromStatus === toStatus) return { ok: true, from: fromStatus, to: toStatus, noop: true };

  if (!force) {
    const allowed = APPLICATION_TRANSITIONS[fromStatus] || [];
    if (!allowed.includes(toStatus)) {
      return { ok: false, error: `Cannot move application from '${fromStatus}' to '${toStatus}'` };
    }
  }

  await pool.request()
    .input("id", sql.Int, applicationId)
    .input("st", sql.NVarChar(30), toStatus)
    .input("ub", sql.Int, actorId)
    .query("UPDATE dbo.CrmApplication SET Status = @st, UpdatedBy = @ub, UpdatedAt = SYSDATETIME() WHERE Id = @id");

  await logStatusChange(pool, applicationId, fromStatus, toStatus, trigger, remarks, actorId);
  return { ok: true, from: fromStatus, to: toStatus };
}

// Historically, the Application's Status was force-advanced to 'Approved'
// the moment its Booking was created; nothing since has ever set that
// (see crmApplicationWorkflow.js's module docstring). A row from that era
// could still be sitting at Status='Approved'. When such a Booking later
// dies (Cancelled by the cancellation-request flow, Rejected while still
// Pending, or Expired by the confirm-deadline sweep), this keeps that old
// Application from being left stuck at 'Approved' forever with no live
// Booking underneath it — indistinguishable from a genuinely active sale
// unless someone opens the Booking itself. Call this from every place
// CrmBooking.Status is set to one of those three terminal values so the
// Application always reflects reality, regardless of which status it
// started from. Force-advances
// (system-triggered, not a manual user transition) and is intentionally
// silent/non-throwing on failure — the caller's own action (cancelling,
// rejecting, expiring the Booking) has already committed and must not be
// undone by a cascade step failing.
async function syncApplicationOnBookingTerminal(pool, bookingId, toStatus, trigger, remarks, actorId) {
  try {
    const row = await pool.request().input("bid", sql.Int, bookingId)
      .query("SELECT ApplicationId FROM dbo.CrmBooking WHERE Id = @bid");
    const applicationId = row.recordset[0]?.ApplicationId;
    if (applicationId == null) return;
    await advanceApplicationStatus(pool, applicationId, toStatus, trigger, remarks, actorId, { force: true });
  } catch (e) {
    console.error("[crm-application-workflow] syncApplicationOnBookingTerminal failed:", e.message);
  }
}

module.exports = { APPLICATION_TRANSITIONS, logStatusChange, advanceApplicationStatus, syncApplicationOnBookingTerminal };