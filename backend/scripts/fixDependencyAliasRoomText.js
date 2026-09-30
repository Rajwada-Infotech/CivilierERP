// Second pass after fixStaleDependencyAliases.js: fixes the remaining
// mismatches verifyDependencyAliasRoomMatch.js found between a record's
// Alias room-text and its live dbo.RoomMaster.RoomName (both the 39 plain
// spacing differences, e.g. "HALLROOM" vs "Hall Room", and the one genuine
// typo, "BATHRO0M 2" vs "Bathroom 2" — that row's unit portion was also
// never updated by the first pass, since its typo didn't match the room-
// keyword regex at all).
//
// Unlike the first pass, this rebuilds Alias entirely from the record's
// live UnitMaster.UnitName + RoomMaster.RoomName — both are the
// authoritative source now, so there's no text-parsing risk.
//
// Dry-run by default — prints every proposed old -> new Alias without
// writing. Pass --apply to actually update. Pass --id=<DependencyMasterId>
// to fix one record only.
//
// Usage:
//   node backend/scripts/fixDependencyAliasRoomText.js
//   node backend/scripts/fixDependencyAliasRoomText.js --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find((a) => a.startsWith("--id="));
const ONLY_ID = idArg ? parseInt(idArg.split("=")[1], 10) : null;

function norm(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}

async function main() {
  await connectDB();
  const pool = getPool();

  const req = pool.request();
  if (ONLY_ID) req.input("onlyId", sql.Int, ONLY_ID);
  const res = await req.query(`
    SELECT dm.Id, dm.Alias, dm.FlatId, dm.RoomId, um.UnitName, rm.RoomName
    FROM dbo.DependencyMaster dm
    LEFT JOIN dbo.UnitMaster um ON um.Id = dm.FlatId
    LEFT JOIN dbo.RoomMaster rm ON rm.Id = dm.RoomId
    WHERE dm.IsActive = 1
    ${ONLY_ID ? "AND dm.Id = @onlyId" : ""}
    ORDER BY dm.Id
  `);

  const toFix = [];
  const flagged = [];
  for (const row of res.recordset) {
    if (!row.UnitName || !row.RoomName) {
      flagged.push(`Id ${row.Id}: missing live UnitName or RoomName (FlatId ${row.FlatId}, RoomId ${row.RoomId}) — skipped.`);
      continue;
    }
    if (norm(row.Alias).endsWith(norm(row.RoomName))) continue; // already matches
    const newAlias = `${row.UnitName}/${row.RoomName}`;
    toFix.push({ id: row.Id, oldAlias: row.Alias, newAlias });
  }

  console.log(`${toFix.length} record(s) to update:\n`);
  for (const r of toFix) console.log(`  Id ${r.id}:  "${r.oldAlias}"  ->  "${r.newAlias}"`);
  if (flagged.length) {
    console.log(`\n${flagged.length} flagged:`);
    flagged.forEach((s) => console.log(`  ${s}`));
  }

  if (!APPLY) {
    console.log(toFix.length ? "\nDry run. Re-run with --apply to write the changes above." : "\nNothing to do.");
    await closeDB();
    return;
  }

  for (const r of toFix) {
    await pool.request().input("id", sql.Int, r.id).input("alias", sql.NVarChar(200), r.newAlias)
      .query(`UPDATE dbo.DependencyMaster SET Alias = @alias, UpdatedAt = SYSDATETIME() WHERE Id = @id`);
  }
  console.log(`\nUpdated ${toFix.length} record(s).`);

  await closeDB();
}

main().catch((err) => {
  console.error("Fix failed:", err);
  process.exit(1);
});
