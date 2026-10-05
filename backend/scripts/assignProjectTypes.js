// Assigns project types (and block overrides) from a spec, the way Project
// Master / Block Master would. Types are looked up by their Code in
// ProjectTypeMaster and projects/blocks by name in the DB — nothing about a
// type's behaviour is assumed here. Before writing, every assignment is
// checked with the same rule the booking guard uses: if a type would make
// any unsold unit or plot unbookable, that line is refused.
//
//   node scripts/assignProjectTypes.js --spec scripts/project_types.json          # dry run
//   node scripts/assignProjectTypes.js --spec scripts/project_types.json --apply
//
// Spec: { "projects": [ { "project": "Global City", "type": "MIXED",
//          "blocks": [ { "block": "BUNGALOW", "type": "PLOTTED_VILLA" } ] } ] }

const fs = require("fs");
const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const norm = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

// Unsold units / plots in scope that a type would refuse (mirrors
// services/projectType.bookingTypeViolation, set-based).
async function blockedBy(pool, typeId, { projectId, blockId = null }) {
  const r = await pool.request().input("t", sql.Int, typeId).input("p", sql.Int, projectId).input("b", sql.Int, blockId).query(`
    DECLARE @land BIT, @constr BIT, @resi BIT, @comm BIT;
    SELECT @land = SellsLand, @constr = SellsConstruction,
           @resi = ISNULL(SellsResidential, 1), @comm = ISNULL(SellsCommercial, 0)
    FROM dbo.ProjectTypeMaster WHERE Id = @t;
    SELECT Reason, COUNT(*) AS N FROM (
      SELECT CASE
        WHEN ISNULL(k.IsLand, 0) = 1 THEN CASE WHEN @land = 0 THEN 'land unit' END
        WHEN @constr = 0 THEN 'constructed unit'
        WHEN ISNULL(k.IsCommercial, 0) = 1 AND @comm = 0 THEN 'commercial unit'
        WHEN ISNULL(k.IsCommercial, 0) = 0 AND @resi = 0 THEN 'residential unit'
      END AS Reason
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster bl ON bl.Id = u.BlockId
      LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = ISNULL(u.UnitKind, 'FLAT')
      WHERE u.ProjectId = @p AND u.IsActive = 1
        AND (@b IS NULL AND bl.ProjectTypeId IS NULL OR u.BlockId = @b)
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.UnitId = u.Id AND bk.IsActive = 1)
      UNION ALL
      SELECT CASE WHEN @land = 0 THEN 'plot' END
      FROM dbo.PlotMaster pl LEFT JOIN dbo.BlockMaster bl ON bl.Id = pl.BlockId
      WHERE pl.ProjectId = @p AND pl.IsActive = 1 AND pl.ConvertedUnitId IS NULL
        AND (@b IS NULL AND bl.ProjectTypeId IS NULL OR pl.BlockId = @b)
    ) x WHERE Reason IS NOT NULL GROUP BY Reason`);
  return r.recordset.map((x) => `${x.N} ${x.Reason}(s)`).join(", ");
}

async function main() {
  const specPath = arg("--spec");
  if (!specPath) throw new Error("pass --spec <file.json>");
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  await connectDB();
  const pool = getPool();

  const types = (await pool.request().query("SELECT Id, Code, Name FROM dbo.ProjectTypeMaster WHERE IsActive = 1")).recordset;
  const typeByCode = new Map(types.map((t) => [norm(t.Code), t]));
  const projects = (await pool.request().query(
    "SELECT id, LTRIM(RTRIM(name)) AS name, project_type_id FROM dbo.enterprise WHERE business_type = 'P' AND ISNULL(discontinue, 0) = 0")).recordset;

  const totals = { projectsSet: 0, blocksSet: 0, unchanged: 0, refused: 0, problems: 0 };
  for (const sp of spec.projects || []) {
    const proj = projects.filter((p) => norm(p.name) === norm(sp.project));
    const type = typeByCode.get(norm(sp.type));
    if (proj.length !== 1) { console.log(`!! project "${sp.project}": ${proj.length} match(es) — skipped`); totals.problems++; continue; }
    if (!type) { console.log(`!! type "${sp.type}" not in Project Type Master — "${sp.project}" skipped`); totals.problems++; continue; }
    const p = proj[0];

    // Block overrides first, so the project-level check sees the right scope.
    for (const sb of sp.blocks || []) {
      const bt = typeByCode.get(norm(sb.type));
      const blk = (await pool.request().input("p", sql.Int, p.id)
        .query("SELECT Id, BlockName, ProjectTypeId FROM dbo.BlockMaster WHERE ProjectId = @p AND IsActive = 1")).recordset
        .filter((b) => norm(b.BlockName) === norm(sb.block));
      if (!bt || blk.length !== 1) { console.log(`!! ${p.name} / block "${sb.block}": ${!bt ? "unknown type" : `${blk.length} match(es)`} — skipped`); totals.problems++; continue; }
      if (blk[0].ProjectTypeId === bt.Id) { console.log(`   = ${p.name} / ${sb.block}: already ${bt.Name}`); totals.unchanged++; continue; }
      const why = await blockedBy(pool, bt.Id, { projectId: p.id, blockId: blk[0].Id });
      if (why) { console.log(`   ✗ ${p.name} / ${sb.block} -> ${bt.Name}: REFUSED, would block ${why}`); totals.refused++; continue; }
      if (APPLY) await pool.request().input("id", sql.Int, blk[0].Id).input("t", sql.Int, bt.Id).query("UPDATE dbo.BlockMaster SET ProjectTypeId = @t WHERE Id = @id");
      console.log(`   ✓ ${p.name} / block ${sb.block} -> ${bt.Name}`);
      totals.blocksSet++;
    }

    if (p.project_type_id === type.Id) { console.log(`   = ${p.name}: already ${type.Name}`); totals.unchanged++; continue; }
    const why = await blockedBy(pool, type.Id, { projectId: p.id });
    if (why) { console.log(`   ✗ ${p.name} -> ${type.Name}: REFUSED, would block ${why}`); totals.refused++; continue; }
    if (APPLY) await pool.request().input("id", sql.Int, p.id).input("t", sql.Int, type.Id).query("UPDATE dbo.enterprise SET project_type_id = @t WHERE id = @id");
    console.log(`   ✓ ${p.name} -> ${type.Name}`);
    totals.projectsSet++;
  }
  console.log(`\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${JSON.stringify(totals)}`);
  if (!APPLY) console.log("Dry run — nothing was written.");
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("assignProjectTypes failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
