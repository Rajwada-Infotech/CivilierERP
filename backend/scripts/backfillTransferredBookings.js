// Closes, as 'Transferred', seller bookings left open by resales completed
// before that status existed: a live booking whose plots were all transferred
// by a completed resale (or whose villa was), with nothing still active on it.
// Same rule /crm/resales/:id/complete now applies. Never cancels, never deletes.
//
//   node scripts/backfillTransferredBookings.js           # dry run (lists them)
//   node scripts/backfillTransferredBookings.js --apply

const { connectDB, getPool, closeDB } = require("../db");
const APPLY = process.argv.includes("--apply");

async function main() {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT DISTINCT b.Id, b.BookingNo, b.Status, a.ApplicantName
    FROM dbo.CrmUnitResale r
    JOIN dbo.CrmBooking b ON b.Id = r.FromBookingId
    JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
    WHERE r.Status = N'Completed' AND r.IsActive = 1
      AND b.IsActive = 1 AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred')
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id AND bp.Status = N'Active')
      AND (b.UnitId IS NULL OR b.UnitId = r.UnitId)
    ORDER BY b.BookingNo`)).recordset;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} seller booking(s) left open by a completed resale:`);
  for (const r of rows) console.log(`  ${r.BookingNo}  (${r.Status})  ${r.ApplicantName || ""}`);
  if (APPLY && rows.length) {
    const ids = rows.map((r) => r.Id).join(",");
    const res = await pool.request().query(`UPDATE dbo.CrmBooking SET Status = N'Transferred', UpdatedAt = SYSDATETIME() WHERE Id IN (${ids})`);
    console.log(`\nAPPLIED: ${res.rowsAffected[0]} booking(s) set to Transferred.`);
  } else if (!APPLY) {
    console.log("\nDry run — nothing was written.");
  }
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("backfillTransferredBookings failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
