/**
 * CRM Application — the Cancel action and the AutoBooking cascade only.
 *
 * Draft -> Pending -> Approved/Rejected now goes through the shared
 * approvalService.js transition() engine (see crmApplications.js), so only
 * admin/super_admin/dba users acting from the Admin Approval Inbox can
 * approve or reject — not a self-service button on the application's own
 * page. This module keeps two things that engine doesn't cover:
 *   - Cancel: a business action any editor can take, not an approval.
 *   - AutoBooking: booking creation force-advances the application to
 *     Approved as a system-triggered cascade, bypassing the human
 *     approval gate entirely (a real booking is stronger proof than a
 *     manual approval click).
 * Every transition here is still written to CrmApplicationStatusLog for
 * audit purposes, distinct from ApprovalAuditLog (which the engine uses).
 */
const { sql } = require("../db");

const APPLICATION_TRANSITIONS = {
  Draft:     ["Cancelled"],
  Pending:   ["Cancelled"],
  Approved:  ["Cancelled"],
  Rejected:  ["Cancelled"],
  Cancelled: [],
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

module.exports = { APPLICATION_TRANSITIONS, logStatusChange, advanceApplicationStatus };
