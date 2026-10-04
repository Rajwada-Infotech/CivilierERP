// Read-only. Two checks:
//   1. Did fixStaleDependencyAliases.js --apply actually write? (any row
//      whose Alias still contains a 3-digit unit number means it didn't,
//      or didn't finish.)
//   2. For every active row, does the room-name portion of Alias actually
//      match the record's CURRENT dbo.RoomMaster.RoomName (case/whitespace
//      normalized)? fixStaleDependencyAliases.js carried the room text
//      forward from the OLD alias as-is — it never cross-checked it
//      against the room's real, current name.
//
// Usage: node backend/scripts/verifyDependencyAliasRoomMatch.js

const { connectDB, getPool, closeDB } = require("../db");

function norm(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}

async function main() {
  await connectDB();
  const pool = getPool();

  const res = await pool.request().query(`
    SELECT dm.Id, dm.Alias, dm.RoomId, rm.RoomName, um.UnitName
    FROM dbo.DependencyMaster dm
    LEFT JOIN dbo.RoomMaster rm ON rm.Id = dm.RoomId
    LEFT JOIN dbo.UnitMaster um ON um.Id = dm.FlatId
    WHERE dm.IsActive = 1
    ORDER BY dm.Id
  `);

  const stillOld = res.recordset.filter((r) => /\d{3}/.test(String(r.Alias)));
  console.log(`=== Check 1: rows whose Alias still has a 3-digit unit number (${stillOld.length}) ===`);
  if (!stillOld.length) console.log("None — the apply run finished writing.");
  for (const r of stillOld) console.log(`  Id ${r.Id}: "${r.Alias}"`);

  console.log(`\n=== Check 2: Alias room-text vs live RoomMaster.RoomName mismatches ===`);
  let mismatches = 0;
  for (const r of res.recordset) {
    if (!r.RoomName) {
      console.log(`  Id ${r.Id}: no live RoomMaster row for RoomId ${r.RoomId} — can't verify.`);
      mismatches++;
      continue;
    }
    const aliasNorm = norm(r.Alias);
    const roomNorm = norm(r.RoomName);
    if (!aliasNorm.endsWith(roomNorm)) {
      mismatches++;
      console.log(`  Id ${r.Id}: Alias "${r.Alias}"  —  live RoomName "${r.RoomName}"  (Unit "${r.UnitName || "?"}")`);
    }
  }
  console.log(`\n${mismatches} of ${res.recordset.length} active record(s) have an Alias whose room text doesn't match the room's current name.`);
  console.log("This is diagnostic only — nothing was changed.");

  await closeDB();
}

main().catch((err) => {
  console.error("Verify failed:", err);
  process.exit(1);
});
