/**
 * Shared helper: resolves a booking's ProjectId and asserts that
 * the request's project scope permits access to it.
 *
 * @returns {Promise<number|false>} The booking's ProjectId, or false if access is denied
 *   (the helper already writes the 403/404 response in that case).
 */
const { getPool, sql } = require("../db");
const { projectAllowed } = require("./projectScope");

async function assertBookingProjectScope(req, res, bookingId) {
  if (!bookingId || isNaN(parseInt(bookingId, 10))) {
    res.status(400).json({ error: "Invalid bookingId" });
    return false;
  }
  const bid = parseInt(bookingId, 10);
  const pool = getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, bid)
    .query("SELECT Id, ProjectId FROM dbo.CrmBooking WHERE Id = @id");
  if (!result.recordset.length) {
    res.status(404).json({ error: "Booking not found" });
    return false;
  }
  const { ProjectId } = result.recordset[0];
  // Only enforce when the request carries a project scope restriction
  if (req.projectScope) {
    if (!projectAllowed(req.projectScope, ProjectId)) {
      res.status(403).json({ error: "Access denied: booking belongs to a different project" });
      return false;
    }
  }
  return ProjectId;
}

module.exports = { assertBookingProjectScope };
