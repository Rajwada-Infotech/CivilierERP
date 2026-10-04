// Brings generated units in line with what their Auto Project Setup floor says
// they are. For every generated floor, the expected kind / BHK of each unit is
// rebuilt exactly the way generation builds it — the floor's own mix, else the
// block's typical floor (unit-mix rows may be a commercial kind), else a
// legacy whole-floor kind — and compared with the units actually there, in
// creation order. Nothing is named here: kinds and layouts come from the masters.
//
// Only safe corrections are made: a unit with an active booking is reported,
// never changed (its kind decides its GST). A unit edited by hand to something
// else than the plan is left alone unless it is the "flat with no type" left
// behind by an earlier generation bug, or a commercial-kind unit carrying a BHK.
//
//   node scripts/reconcileUnitKinds.js            # dry run, every project
//   node scripts/reconcileUnitKinds.js --apply
//   node scripts/reconcileUnitKinds.js --project "TT TEST"

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY = arg("--project");

async function main() {
  await connectDB();
  const pool = getPool();
  const q = async (s, inputs = {}) => {
    const r = pool.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };
  const col = async (t, c) => (await q(`SELECT COL_LENGTH('${t}', '${c}') AS c`))[0].c != null;
  const hasMix = (await q("SELECT OBJECT_ID('dbo.CrmProjectAutoSetupFloorMix') AS o"))[0].o != null;
  const tplKind = await col("dbo.CrmProjectAutoSetupUnitTemplate", "UnitKind");
  const floorKind = await col("dbo.CrmProjectAutoSetupFloor", "UnitKind");
  const commercialCol = await col("dbo.CrmConstructedAssetKind", "IsCommercial");

  const commercial = new Set((commercialCol ? await q("SELECT Code FROM dbo.CrmConstructedAssetKind WHERE IsCommercial = 1") : []).map((k) => k.Code.toUpperCase()));
  const defaultKind = (await q(`SELECT dc.definition AS d FROM sys.default_constraints dc
      JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
      WHERE dc.parent_object_id = OBJECT_ID('dbo.UnitMaster') AND c.name = 'UnitKind'`))[0]?.d?.match(/'([^']+)'/)?.[1]?.toUpperCase() ?? null;

  const floors = await q(`
    SELECT f.Id, f.BlockId, f.FloorNo, b.BlockName, LTRIM(RTRIM(e.name)) AS Project${floorKind ? ", f.UnitKind AS FloorKind" : ", CAST(NULL AS NVARCHAR(20)) AS FloorKind"}
    FROM dbo.CrmProjectAutoSetupFloor f
    JOIN dbo.BlockMaster b ON b.Id = f.BlockId
    JOIN dbo.enterprise e ON e.id = b.ProjectId
    WHERE f.IsActive = 1 AND f.IsGenerated = 1 AND f.FloorNo >= 0 ${ONLY ? "AND LTRIM(RTRIM(e.name)) = @p" : ""}
    ORDER BY e.name, b.BlockName, f.FloorNo`, ONLY ? { p: [sql.NVarChar(255), ONLY] } : {});

  const expand = (rows) => rows.flatMap((r) => Array(r.Count).fill({ kind: r.UnitKind ? r.UnitKind.toUpperCase() : null, type: r.UnitKind ? null : r.UnitType, lt: r.UnitKind ? null : r.LayoutTypeId }));
  const tplCache = new Map();
  const totals = { floorsChecked: 0, unitsChecked: 0, fixed: 0, alreadyRight: 0, bookedSkipped: 0, handEditedKept: 0 };

  for (const f of floors) {
    const own = hasMix ? await q("SELECT UnitType, LayoutTypeId, UnitKind, Count FROM dbo.CrmProjectAutoSetupFloorMix WHERE FloorId = @f AND IsActive = 1 ORDER BY SortOrder", { f: [sql.Int, f.Id] }) : [];
    if (!tplCache.has(f.BlockId)) {
      tplCache.set(f.BlockId, await q(`SELECT UnitType, LayoutTypeId, ${tplKind ? "UnitKind" : "CAST(NULL AS NVARCHAR(20)) AS UnitKind"}, Count
        FROM dbo.CrmProjectAutoSetupUnitTemplate WHERE BlockId = @b AND IsActive = 1 ORDER BY SortOrder`, { b: [sql.Int, f.BlockId] }));
    }
    const fk = f.FloorKind ? f.FloorKind.toUpperCase() : null;
    // Same precedence as generation.
    let plan = own.length ? expand(own) : null;
    if (!plan && fk && commercial.has(fk)) plan = [{ kind: fk, type: null, lt: null }];
    if (!plan) plan = expand(tplCache.get(f.BlockId));
    if (!plan.length) continue;
    // Only floors whose plan involves a kind are in scope (pure-BHK floors are Room Master's business).
    if (!plan.some((p) => p.kind) && !fk) continue;
    totals.floorsChecked++;

    const units = await q(`
      SELECT u.Id, u.UnitName, u.UnitKind, u.UnitType, u.LayoutTypeId,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.UnitId = u.Id AND bk.IsActive = 1) THEN 1 ELSE 0 END AS Booked
      FROM dbo.UnitMaster u WHERE u.BlockId = @b AND u.FloorNo = @n AND u.IsActive = 1 ORDER BY u.Id`,
      { b: [sql.Int, f.BlockId], n: [sql.Int, f.FloorNo] });

    const lines = [];
    units.forEach((u, i) => {
      totals.unitsChecked++;
      const want = plan[i % plan.length];
      const wantKind = want.kind || fk || defaultKind;
      const isKind = String(u.UnitKind || "").toUpperCase();
      const right = isKind === String(wantKind || "").toUpperCase() && (want.kind && commercial.has(want.kind) ? !u.UnitType : true);
      if (right) { totals.alreadyRight++; return; }
      if (u.Booked) { totals.bookedSkipped++; lines.push(`   ! ${u.UnitName}: booked — left as ${isKind || "-"} / ${u.UnitType || "-"} (plan: ${wantKind})`); return; }
      // Only repair the known-bad shapes; anything else was a deliberate edit.
      const bugShape = (!u.UnitType && !u.LayoutTypeId) || (commercial.has(isKind) && !!u.UnitType);
      if (!bugShape) { totals.handEditedKept++; lines.push(`   = ${u.UnitName}: ${isKind} / ${u.UnitType} kept (edited by hand; plan says ${wantKind})`); return; }
      lines.push(`   ✓ ${u.UnitName}: ${isKind || "-"} / ${u.UnitType || "no type"} -> ${wantKind}${want.type ? ` / ${want.type}` : ""}`);
      totals.fixed++;
      if (APPLY) u._fix = { kind: wantKind, type: want.type, lt: want.lt };
    });
    if (lines.length) console.log(`${f.Project} › ${f.BlockName} › floor ${f.FloorNo === 0 ? "G" : f.FloorNo}\n${lines.join("\n")}`);
    if (APPLY) {
      for (const u of units.filter((x) => x._fix)) {
        await pool.request().input("id", sql.Int, u.Id).input("k", sql.NVarChar(20), u._fix.kind)
          .input("t", sql.NVarChar(50), u._fix.type).input("lt", sql.Int, u._fix.lt)
          .query("UPDATE dbo.UnitMaster SET UnitKind = @k, UnitType = @t, LayoutTypeId = @lt, UpdatedAt = SYSDATETIME() WHERE Id = @id");
      }
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  if (APPLY && totals.fixed) console.log("Units given a BHK here: open Room Master › Generate Rooms (or checkDprSync) to build their rooms.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("reconcileUnitKinds failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
