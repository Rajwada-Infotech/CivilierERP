// Frees units / plots still locked by a booking that has already ended.
// A unit / plot allocation line left 'Active' under a Cancelled / Expired /
// Rejected / Transferred (or removed) booking blocks every new booking of it,
// while the Unit Matrix shows it Available. Older cancellation and expiry
// paths didn't release these lines; they now do (releaseBookingInventoryLines).
// Moves the line only — never touches the booking, its money or its history.
//
//   node scripts/releaseStuckInventoryLines.js            # dry run (lists them)
//   node scripts/releaseStuckInventoryLines.js --apply

const { connectDB, getPool, closeDB } = require("../db");
const APPLY = process.argv.includes("--apply");

const DEAD = "(b.IsActive = 0 OR b.Status IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred'))";
const TABLES = [
  { table: "CrmBookingUnit", key: "UnitId", name: "(SELECT UnitName FROM dbo.UnitMaster WHERE Id = l.UnitId)" },
  { table: "CrmBookingPlot", key: "PlotId", name: "(SELECT PlotName FROM dbo.PlotMaster WHERE Id = l.PlotId)" },
];

async function main() {
  await connectDB();
  const pool = getPool();
  let total = 0;
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — allocation lines still Active under a booking that has ended:\n`);
  for (const t of TABLES) {
    const rows = (await pool.request().query(`
      SELECT l.Id, l.${t.key} AS ItemId, ${t.name} AS ItemName, b.BookingNo, b.Status, b.IsActive
      FROM dbo.${t.table} l JOIN dbo.CrmBooking b ON b.Id = l.BookingId
      WHERE l.Status = N'Active' AND ${DEAD}
      ORDER BY b.BookingNo`)).recordset;
    for (const r of rows) console.log(`  ${t.table.padEnd(15)} ${String(r.ItemName || r.ItemId).padEnd(24)} ${r.BookingNo} (${r.IsActive ? r.Status : "removed"})`);
    total += rows.length;
    if (APPLY && rows.length) {
      // A Transferred booking's line moves on as Transferred; every other one is Cancelled.
      await pool.request().query(`
        UPDATE l SET Status = CASE WHEN b.IsActive = 1 AND b.Status = N'Transferred' THEN N'Transferred' ELSE N'Cancelled' END
        FROM dbo.${t.table} l JOIN dbo.CrmBooking b ON b.Id = l.BookingId
        WHERE l.Status = N'Active' AND ${DEAD}`);
    }
  }
  // Lines a past "change unit" left behind: a live single-unit booking whose
  // only active line still points at its OLD unit. Moved to the booking's
  // real unit — unless another sale already holds that unit (reported only).
  const moved = (await pool.request().query(`
    SELECT l.Id, b.BookingNo, b.UnitId AS NewUnitId,
           (SELECT UnitName FROM dbo.UnitMaster WHERE Id = l.UnitId) AS OldName,
           (SELECT UnitName FROM dbo.UnitMaster WHERE Id = b.UnitId) AS NewName,
           (SELECT COUNT(*) FROM dbo.CrmBookingUnit x WHERE x.UnitId = b.UnitId AND x.Status = N'Active' AND x.BookingId <> b.Id) AS Clash
    FROM dbo.CrmBookingUnit l JOIN dbo.CrmBooking b ON b.Id = l.BookingId
    WHERE l.Status = N'Active' AND NOT ${DEAD} AND b.UnitId IS NOT NULL AND l.UnitId <> b.UnitId
      AND (SELECT COUNT(*) FROM dbo.CrmBookingUnit y WHERE y.BookingId = b.Id AND y.Status = N'Active') = 1
    ORDER BY b.BookingNo`)).recordset;
  for (const r of moved) {
    console.log(`  moved unit       ${String(r.OldName).padEnd(24)} -> ${r.NewName}  ${r.BookingNo}${r.Clash ? "  !! the new unit is held by another sale — left for review" : ""}`);
    if (APPLY && !r.Clash) {
      await pool.request().input("id", require("../db").sql.Int, r.Id).input("u", require("../db").sql.Int, r.NewUnitId)
        .query("UPDATE dbo.CrmBookingUnit SET UnitId = @u, UpdatedAt = SYSDATETIME() WHERE Id = @id");
    }
  }
  total += moved.length;

  console.log(`\n${total} line(s). ${APPLY ? "APPLIED — those units / plots can be booked again." : "Dry run — nothing was written."}`);
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("releaseStuckInventoryLines failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
