// A CrmBooking only becomes a real Maintenance customer once the unit has
// actually been handed over to them — not merely "Confirmed" (a sales-
// approval state, reachable long before agreement registration, sale deed,
// NOC, or handover). dbo.CrmHandover.Status = 'Completed' is the
// authoritative post-handover signal: crmHandover.js only lets a handover
// reach that status once Agreement is Registered, the Possession Notice is
// Acknowledged, there's no open NOC, all milestone dues are cleared, and
// ActualHandoverDate/KeyHandoverBy/FinalDuesCleared/CustomerAcknowledged are
// all set. Every Maintenance eligibility check (Directory, Bills, Charges,
// Electricity meters) must gate on this, not on WorkflowStage alone.
//
// BookingId is UNIQUE on CrmHandover (one handover record per booking), so a
// plain JOIN is safe here — no fan-out risk.

// `bookingAlias` is the CrmBooking table alias already in scope at the call
// site (e.g. "b" in "FROM dbo.CrmBooking b").
function maintenanceEligibleJoin(bookingAlias, handoverAlias = "ho") {
  return `JOIN dbo.CrmHandover ${handoverAlias} ON ${handoverAlias}.BookingId = ${bookingAlias}.Id AND ${handoverAlias}.Status = 'Completed'`;
}

function maintenanceEligibleExists(bookingAlias) {
  return `EXISTS (SELECT 1 FROM dbo.CrmHandover h WHERE h.BookingId = ${bookingAlias}.Id AND h.Status = 'Completed')`;
}

// For a single bookingId already in hand (e.g. before an INSERT) — returns
// the ActualHandoverDate when eligible, or null when not.
async function getMaintenanceEligibleHandoverDate(pool, sql, bookingId) {
  const result = await pool.request().input("BookingId", sql.Int, bookingId).query(`
    SELECT TOP 1 ActualHandoverDate FROM dbo.CrmHandover WHERE BookingId = @BookingId AND Status = 'Completed'
  `);
  return result.recordset[0]?.ActualHandoverDate ?? null;
}

module.exports = { maintenanceEligibleJoin, maintenanceEligibleExists, getMaintenanceEligibleHandoverDate };
