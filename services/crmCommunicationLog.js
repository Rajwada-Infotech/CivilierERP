const { sql } = require("../db");

// Every meaningful thing that happens on an application/booking — agreement
// sent, date proposed/confirmed, customer approved/rechecked, document
// reviewed, deed sent, ticket raised — writes here too, not just its own
// entity-specific log table. This is what makes the Communication Log a
// real unified interaction trail (Call/Email/SMS/WhatsApp entries staff add
// by hand, sitting alongside every automated system event) instead of only
// showing manually-logged contact attempts.
async function logCommunication(pool, { applicationId = null, bookingId = null, direction = "Outbound", subject, summary = null, contactedAt = null, createdBy = null }) {
  if (!applicationId && !bookingId) return;
  await pool.request()
    .input("aid", sql.Int, applicationId)
    .input("bid", sql.Int, bookingId)
    .input("dir", sql.NVarChar(20), direction)
    .input("subj", sql.NVarChar(300), subject)
    .input("sum", sql.NVarChar(sql.MAX), summary)
    .input("cat", sql.DateTime2(3), contactedAt)
    .input("cb", sql.Int, createdBy)
    .query(`
      INSERT INTO dbo.CrmCommunicationLog
        (ApplicationId, BookingId, Channel, Direction, Subject, Summary, ContactedAt, CreatedBy, CreatedAt)
      VALUES (@aid, @bid, 'System', @dir, @subj, @sum, ISNULL(@cat, SYSDATETIME()), @cb, SYSDATETIME())
    `);
}

module.exports = { logCommunication };
