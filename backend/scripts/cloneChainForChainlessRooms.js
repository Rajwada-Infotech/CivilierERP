// Gives every active room that has NO DPR chain the chain its room type uses
// everywhere else. The template is learned from the chains that already
// exist — nothing is typed here:
//   - per room category, the most-used step sequence (ordered ActivityId +
//     WorkType) and the chain's WorkType; a chain in the same project is
//     preferred as the donor, else any project's
//   - the new chain is written exactly as POST /dependency-master writes one:
//     DependencyMaster row -> one DependencyMasterActivity rung per donor step
//     (same order) -> one stub DependencyActivityAssignment per rung (Status
//     defaults to PENDING, migration 487); a room that already has a chain is
//     refused like the route does
//   - scope columns follow the format existing chains use, checked against
//     their own rooms: TowerId = the unit's block, FlatId = the unit, Floor =
//     whichever of floorLabelOf(FloorNo) / FloorNo the donors store; Alias in
//     the form this project's chains use (else the most common form overall)
//
//   node scripts/cloneChainForChainlessRooms.js --project "Royal Garden"          # dry run
//   node scripts/cloneChainForChainlessRooms.js --project "Royal Garden" --apply
//   node scripts/cloneChainForChainlessRooms.js --all            # every project with rooms, read from the DB

const { connectDB, getPool, sql, closeDB } = require("../db");
const { floorLabelOf, chainFloorLabel } = require("../services/unitLayout");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const ACTOR = "cloneChainForChainlessRooms";

async function main() {
  const PROJECT = arg("--project");
  const ALL = process.argv.includes("--all");
  if (!PROJECT && !ALL) throw new Error('pass --project "<name>" or --all');
  await connectDB();
  const pool = getPool();
  const q = async (db, s, p = {}) => {
    const r = db.request();
    for (const [k, [t, v]] of Object.entries(p)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };
  // Projects come from the database: one named project, or (--all) every
  // project that has active rooms on active units.
  const projects = PROJECT
    ? await q(pool, "SELECT id, LTRIM(RTRIM(name)) AS name FROM dbo.enterprise WHERE business_type = 'P' AND LTRIM(RTRIM(name)) = @n", { n: [sql.NVarChar(255), PROJECT] })
    : await q(pool, `SELECT e.id, LTRIM(RTRIM(e.name)) AS name FROM dbo.enterprise e WHERE e.business_type = 'P'
        AND EXISTS (SELECT 1 FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId AND u.IsActive = 1 WHERE r.ProjectId = e.id AND r.IsActive = 1)
        ORDER BY LTRIM(RTRIM(e.name))`);
  if (!projects.length || (PROJECT && projects.length !== 1)) throw new Error(`${projects.length} matching project(s)`);

  // ── learn the template per room category from existing chains ──
  const chains = await q(pool, `
    SELECT d.Id, d.ProjectId, d.TowerId, d.Floor, d.FlatId, d.Alias, d.WorkType, r.RoomCategoryId, r.RoomName,
           u.UnitName, u.BlockId, u.FloorNo, u.Id AS UnitId,
      (SELECT STRING_AGG(CONCAT(x.ActivityId, ':', ISNULL(x.WorkType, '')), ',') WITHIN GROUP (ORDER BY x.SequenceNo)
         FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = d.Id) AS Seq
    FROM dbo.DependencyMaster d JOIN dbo.RoomMaster r ON r.Id = d.RoomId JOIN dbo.UnitMaster u ON u.Id = r.UnitId
    WHERE d.IsActive = 1 AND r.RoomCategoryId IS NOT NULL`);
  if (!chains.length) throw new Error("no existing chains to learn from");
  // Stored-format rules, verified against every existing chain.
  const rule = {
    tower: chains.every((c) => c.TowerId === c.BlockId),
    flat: chains.every((c) => c.FlatId === c.UnitId),
    floorLabel: chains.every((c) => String(c.Floor) === String(floorLabelOf(c.FloorNo))),
    floorNo: chains.every((c) => String(c.Floor) === String(c.FloorNo)),
  };
  console.log(`format learned from ${chains.length} chains: ${JSON.stringify(rule)}`);
  if (!rule.tower || !rule.flat || !(rule.floorLabel || rule.floorNo)) {
    throw new Error("existing chains don't follow one consistent tower/flat/floor format — refusing to guess");
  }
  // A unit's chain Floor — by its floor, or, for a unit with none, by its
  // project type (services/unitLayout.js chainFloorLabel). Cached per unit.
  const floorCache = new Map();
  const floorOf = async (t) => {
    if (!floorCache.has(t.UnitId)) floorCache.set(t.UnitId, chainFloorLabel(pool, t, { asLabel: rule.floorLabel }).then((v) => ({ v }), (e) => ({ e })));
    const r = await floorCache.get(t.UnitId);
    if (r.e) throw r.e;
    return r.v;
  };
  // Alias format is free text in the app, so it is LEARNED from the existing
  // chains: for each one, find the separator (read from the alias itself, the
  // character right after the unit's first segment) and the letter case of the
  // unit / room parts that rebuild it exactly. Nothing about the format is typed.
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
  const tally = (list) => list.reduce((m, c) => { const f = learn(c); const k = f ? JSON.stringify(f) : "unrecognised"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const grand = { chainsCreated: 0, rungsCreated: 0, noTemplate: 0, problems: 0 };
  for (const P of projects) {
  const pid = P.id;
  const proj = [P];
  console.log(`
=== ${P.name}`);
  const own = chains.filter((c) => c.ProjectId === pid);
  const counts = tally(own.length ? own : chains);
  const bestKey = Object.entries(counts).filter(([k]) => k !== "unrecognised").sort((a, b) => b[1] - a[1])[0]?.[0];
  console.log(`alias formats — all chains: ${JSON.stringify(tally(chains))}${own.length ? `; this project: ${JSON.stringify(counts)}` : "; this project has no chains yet (using the most common)"}`);
  const odd = chains.filter((c) => !learn(c)).slice(0, 5);
  if (odd.length) console.log(`   unrecognised examples: ${odd.map((c) => `"${c.Alias}" (unit "${c.UnitName}", room "${c.RoomName}")`).join("; ")}`);
  if (!bestKey) { console.log("   !! no alias format could be learned from existing chains — project skipped"); grand.problems++; continue; }
  const aliasFormat = JSON.parse(bestKey);
  console.log(`   using alias format ${bestKey}, e.g. "${build(aliasFormat, chains[0].UnitName, chains[0].RoomName)}"`);
  const template = new Map(); // categoryId -> donor chain
  const byCat = new Map();
  for (const c of chains) (byCat.get(c.RoomCategoryId) || byCat.set(c.RoomCategoryId, []).get(c.RoomCategoryId)).push(c);
  for (const [cat, cs] of byCat) {
    const freq = new Map();
    for (const c of cs) freq.set(`${c.WorkType}|${c.Seq}`, (freq.get(`${c.WorkType}|${c.Seq}`) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const pool2 = cs.filter((c) => `${c.WorkType}|${c.Seq}` === top);
    template.set(cat, pool2.find((c) => c.ProjectId === pid) || pool2[0]);
    const share = Math.round((100 * freq.get(top)) / cs.length);
    if (share < 100) console.log(`   note: category ${cat} — template used by ${share}% of its chains`);
  }

  // ── targets: active rooms of active units in this project with no chain ──
  const targets = await q(pool, `
    SELECT r.Id, r.RoomName, r.RoomCategoryId, u.Id AS UnitId, u.UnitName, u.BlockId, u.FloorNo, b.BlockName
    FROM dbo.RoomMaster r JOIN dbo.UnitMaster u ON u.Id = r.UnitId AND u.IsActive = 1 JOIN dbo.BlockMaster b ON b.Id = u.BlockId
    WHERE r.ProjectId = @p AND r.IsActive = 1 AND r.RoomCategoryId IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dbo.DependencyMaster d WHERE d.RoomId = r.Id)
    ORDER BY b.BlockName, u.FloorNo, u.UnitName, r.RoomName`, { p: [sql.Int, pid] });

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj[0].name}: ${targets.length} chainless room(s)\n`);
  const totals = { chainsCreated: 0, rungsCreated: 0, noTemplate: 0, problems: 0 };
  const perBlock = new Map();
  const noTpl = new Map(); // room type -> rooms skipped because no chain of that type exists yet
  let shown = 0;
  for (const t of targets) {
    const donor = template.get(t.RoomCategoryId);
    if (!donor) { totals.noTemplate++; noTpl.set(t.RoomName.replace(/\s*\d+$/, ""), (noTpl.get(t.RoomName.replace(/\s*\d+$/, "")) || 0) + 1); continue; }
    const alias = build(aliasFormat, t.UnitName, t.RoomName);
    let floor;
    try { floor = await floorOf(t); } catch (e) { totals.problems++; console.log(`   !! ${alias}: ${e.message}`); continue; }
    const tx = pool.transaction();
    await tx.begin();
    try {
      const dupe = await tx.request().input("r", sql.Int, t.Id).query("SELECT TOP 1 Id FROM dbo.DependencyMaster WHERE RoomId = @r");
      if (dupe.recordset.length) throw new Error("room already has a chain");
      const ins = await tx.request().input("P", sql.Int, pid).input("T", sql.Int, t.BlockId).input("Fl", sql.NVarChar(50), floor)
        .input("F", sql.Int, t.UnitId).input("R", sql.Int, t.Id).input("A", sql.NVarChar(200), alias).input("W", sql.NVarChar(20), donor.WorkType).input("By", sql.NVarChar(300), ACTOR)
        .query(`INSERT INTO dbo.DependencyMaster (ProjectId, TowerId, Floor, FlatId, RoomId, Alias, WorkType, CreatedBy, CreatedAt)
                OUTPUT INSERTED.Id AS id VALUES (@P, @T, @Fl, @F, @R, @A, @W, @By, SYSDATETIME())`);
      const newId = ins.recordset[0].id;
      // Rungs copied from the donor in its order, then one stub per new rung.
      const rungs = await tx.request().input("D", sql.Int, donor.Id).input("N", sql.Int, newId).query(`
        INSERT INTO dbo.DependencyMasterActivity (DependencyMasterId, ActivityId, SequenceNo, WorkType)
        OUTPUT INSERTED.Id AS id
        SELECT @N, x.ActivityId, x.SequenceNo, x.WorkType FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = @D ORDER BY x.SequenceNo`);
      await tx.request().input("N", sql.Int, newId).input("by", sql.NVarChar(200), ACTOR).query(`
        INSERT INTO dbo.DependencyActivityAssignment (DependencyMasterActivityId, CreatedBy)
        SELECT x.Id, @by FROM dbo.DependencyMasterActivity x WHERE x.DependencyMasterId = @N`);
      if (APPLY) await tx.commit(); else await tx.rollback();
      totals.chainsCreated++; totals.rungsCreated += rungs.recordset.length;
      perBlock.set(t.BlockName, (perBlock.get(t.BlockName) || 0) + 1);
      if (shown++ < 8) console.log(`   ${alias}: copy of chain #${donor.Id} "${donor.Alias}" (${rungs.recordset.length} steps, PENDING stubs)`);
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ignore */ }
      totals.problems++; console.log(`   !! ${alias}: ${e.message}`);
    }
  }
  if (shown > 8) console.log(`   … ${shown - 8} more`);
  if (noTpl.size) console.log(`\nno existing chain for these room types (left for Dependency Master): ${[...noTpl.entries()].map(([k, n]) => `${k}: ${n}`).join(", ")}`);
  console.log(`\nper block: ${[...perBlock.entries()].map(([b, n]) => `${b}: ${n}`).join(", ") || "-"}`);
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  for (const k of Object.keys(grand)) grand[k] += totals[k];
  }
  if (projects.length > 1) console.log(`
ALL ${projects.length} PROJECTS — ${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(grand)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("cloneChainForChainlessRooms failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
