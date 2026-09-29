// One-off fix for dbo.DependencyMaster.Alias rows that still bake in the
// OLD Unit naming scheme (a Block letter + a 3-digit unit number, e.g.
// "EMP/B/105/BATHROOM 2" — "the 100s/200s/300s/400s") after UnitMaster
// was restructured to the current digit-based scheme (e.g. "EMP/2/1/E").
// Alias is free text typed by the user at creation time (routes/
// dependencyMaster.js's POST /) — nothing regenerates it when the unit's
// own name later changes, so it silently goes stale.
//
// dbo.UnitMaster.UnitName already stores the FULL correct path including
// its own prefix (e.g. "EMP/2/1/E"), confirmed against every already-
// current alias in this table (unitName + "/" + roomName reproduces them
// exactly) — so the fix is a straight replacement of everything before the
// room name with the live UnitName, not a prefix-preserving splice.
//
// The room portion of the alias is left exactly as it is ("as it is of the
// room — bedroom, bathroom") — found via a room-keyword match anchored at
// the end of the string, not by splitting on "/", so it survives a missing
// separator too (e.g. "EMP/B/104 BATHROOM 2" -> room = "BATHROOM 2").
//
// Only rows whose portion BEFORE the room name still contains an old-style
// 3-digit unit number are touched — a row already on the new digit/digit/
// letter scheme (no 3-digit number there) is left alone untouched, per
// "keep the unit digits ones".
//
// Dry-run by default — prints every proposed old -> new Alias without
// writing. Pass --apply to actually update. Pass --id=<DependencyMasterId>
// to fix one record only.
//
// Usage:
//   node backend/scripts/fixStaleDependencyAliases.js
//   node backend/scripts/fixStaleDependencyAliases.js --apply
//   node backend/scripts/fixStaleDependencyAliases.js --apply --id=42

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const idArg = process.argv.find((a) => a.startsWith("--id="));
const ONLY_ID = idArg ? parseInt(idArg.split("=")[1], 10) : null;

// Anchored at the end of the (trimmed) string. MASTER BEDROOM must be
// checked before BEDROOM alone since it contains it.
const ROOM_SUFFIX_RE = /(MASTER\s*BEDROOM|BEDROOM\s*\d*|BATHROOM\s*\d*|HALL\s*ROOM|HALLROOM|KITCHEN|BALCONY)\s*$/i;
const OLD_STYLE_UNIT_RE = /\d{3}/; // a 3-digit unit number ("the 100s")

function buildNewAlias(alias, unitName) {
  const trimmed = String(alias).trim();
  const m = ROOM_SUFFIX_RE.exec(trimmed);
  if (!m) return { skip: "no room keyword found at the end of this alias" };

  const roomPart = m[0].trim();
  const preRoom = trimmed.slice(0, m.index);

  if (!OLD_STYLE_UNIT_RE.test(preRoom)) {
    return { skip: null }; // already on the new scheme — leave alone, not an error
  }

  const newAlias = `${unitName}/${roomPart}`;
  return { newAlias };
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

  console.log(`Checking ${res.recordset.length} active Dependency Master record(s)...\n`);

  const toFix = [];
  const flagged = [];
  let alreadyCurrent = 0;

  for (const row of res.recordset) {
    if (!row.UnitName) {
      flagged.push(`Id ${row.Id}: no live UnitMaster row for FlatId ${row.FlatId} — skipped, review manually.`);
      continue;
    }
    const result = buildNewAlias(row.Alias, row.UnitName);
    if (result.skip !== undefined) {
      if (result.skip) flagged.push(`Id ${row.Id}: Alias "${row.Alias}" — ${result.skip} — skipped, review manually.`);
      else alreadyCurrent++;
      continue;
    }
    if (result.newAlias === row.Alias) { alreadyCurrent++; continue; }
    toFix.push({ id: row.Id, oldAlias: row.Alias, newAlias: result.newAlias });
  }

  console.log(`${toFix.length} record(s) to update (old 3-digit unit number found):\n`);
  for (const r of toFix) {
    console.log(`  Id ${r.id}:  "${r.oldAlias}"  ->  "${r.newAlias}"`);
  }

  console.log(`\n${alreadyCurrent} record(s) already on the new scheme — left untouched.`);

  if (flagged.length) {
    console.log(`\n${flagged.length} record(s) flagged for manual review:`);
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
