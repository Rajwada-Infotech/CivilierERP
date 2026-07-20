// Shared helper for the CrmBookingAmendmentRequest queue — used by
// crmExtraCharges.js and crmParking.js whenever isLegalWorkStarted() gates a
// direct edit, and by crmBookingAmendments.js when an approver later applies
// the queued change for real.
const { sql } = require("../db");

async function createAmendmentRequest(pool, { bookingId, changeType, action, targetId, proposedChange, reason, requestedBy }) {
  const result = await pool.request()
    .input("bid", sql.Int, bookingId)
    .input("ct", sql.NVarChar(30), changeType)
    .input("act", sql.NVarChar(20), action)
    .input("tid", sql.Int, targetId || null)
    .input("pc", sql.NVarChar(sql.MAX), JSON.stringify(proposedChange || {}))
    .input("reason", sql.NVarChar(500), reason)
    .input("rb", sql.Int, requestedBy)
    .query(`
      INSERT INTO dbo.CrmBookingAmendmentRequest
        (BookingId, ChangeType, Action, TargetId, ProposedChange, Reason, Status, RequestedBy, RequestedAt)
      OUTPUT INSERTED.Id
      VALUES (@bid, @ct, @act, @tid, @pc, @reason, 'Pending', @rb, SYSDATETIME())
    `);
  return result.recordset[0].Id;
}

module.exports = { createAmendmentRequest };
