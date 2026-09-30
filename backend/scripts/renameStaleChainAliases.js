// Renames DPR chains whose Alias no longer matches their room (rooms get
// renumbered by the layout sync, e.g. "Bedroom" -> "Bedroom 1", but a chain's
// Alias is free text and doesn't follow). The new Alias is built in the format
// the project's OWN chains use, learned from the data exactly like
// cloneChainForChainlessRooms: separator read from the aliases themselves +
// letter case of the unit / room parts. Nothing about the format is typed.
// Only the Alias (and UpdatedBy / UpdatedAt, as PUT /dependency-master sets
// them) changes — chain, steps, work and links are untouched.
//
//   node scripts/renameStaleChainAliases.js --all            # dry run, every project with chains
//   node scripts/renameStaleChainAliases.js --all --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const ACTOR = "renameStaleChainAliases";

async function main() {
  if (!process.argv.includes("--all")) throw new Error("pass --all");
  await connectDB();
  const pool = getPool();
  const chains = (await pool.request().query(`
    SELECT d.Id, d.ProjectId, LTRIM(RTRIM(e.name)) AS Project, d.Alias, r.RoomName, u.UnitName
    FROM dbo.DependencyMaster d JOIN dbo.RoomMaster r ON r.Id = d.RoomId JOIN dbo.UnitMaster u ON u.Id = r.UnitId
    JOIN dbo.enterprise e ON e.id = d.ProjectId
    WHERE d.IsActive = 1 ORDER BY e.name, d.Alias`)).recordset;

  const CASES = { asIs: (x) => x, upper: (x) => x.toUpperCase(), lower: (x) => x.toLowerCase() };
  const build = (f, unitName, roomName) => String(unitName).split("/").map(CASES[f.unitCase]).join(f.sep) + f.sep + CASES[f.roomCase](String(roomName));
  const learn = (c) => {
    const first = String(c.UnitName).split("/")[0];
    if (String(c.Alias).toUpperCase().indexOf(first.toUpperCase()) !== 0) return null;
    const sep = String(c.Alias).charAt(first.length);
    if (!sep) return null;
    for (const unitCase of Object.keys(CASES)) for (const roomCase of Object.keys(CASES)) {
      const f = { sep, unitCase, roomCase };
      if (build(f, c.UnitName, c.RoomName) === c.Alias) return f;
    }
    return null;
  };
  const best = (list) => {
    const m = {};
    for (const c of list) { const f = learn(c); if (f) { const k = JSON.stringify(f); m[k] = (m[k] || 0) + 1; } }
    const k = Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0];
    return k ? JSON.parse(k) : null;
  };
  const globalFormat = best(chains);

  const byProject = new Map();
  for (const c of chains) (byProject.get(c.Project) || byProject.set(c.Project, []).get(c.Project)).push(c);
  const totals = { renamed: 0, alreadyMatching: 0, problems: 0 };
  for (const [project, list] of byProject) {
    const fmt = best(list) || globalFormat;
    const stale = list.filter((c) => !learn(c));
    totals.alreadyMatching += list.length - stale.length;
    if (!stale.length) continue;
    console.log(`\n=== ${project}: format ${JSON.stringify(fmt)} (from its own chains), ${stale.length} stale alias(es)`);
    for (const c of stale) {
      const alias = build(fmt, c.UnitName, c.RoomName);
      try {
        const clash = (await pool.request().input("a", sql.NVarChar(200), alias).input("i", sql.Int, c.Id)
          .query("SELECT TOP 1 Id FROM dbo.DependencyMaster WHERE Alias = @a AND Id <> @i AND IsActive = 1")).recordset;
        if (clash.length) throw new Error(`"${alias}" already used by chain #${clash[0].Id}`);
        if (APPLY) {
          await pool.request().input("i", sql.Int, c.Id).input("a", sql.NVarChar(200), alias).input("by", sql.NVarChar(300), ACTOR)
            .query("UPDATE dbo.DependencyMaster SET Alias = @a, UpdatedBy = @by, UpdatedAt = SYSDATETIME() WHERE Id = @i");
        }
        totals.renamed++;
        console.log(`   #${c.Id} "${c.Alias}" -> "${alias}"`);
      } catch (e) {
        totals.problems++; console.log(`   !! #${c.Id} "${c.Alias}": ${e.message}`);
      }
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("renameStaleChainAliases failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
