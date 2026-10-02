"use strict";
/**
 * Silver Woods: villa types and each plot's planned type, from
 * "AVAILABILITY LIST OF RAJWADA.xlsx", sheet "Silverwood New":
 *   column E  base land area, column F  villa type, column G  built-up area.
 *
 * Only types with areas in the sheet are created (1-6). Type 7 (plot 18) has no
 * areas there, and plots marked N/A or blank have no type, so those plots are
 * left unplanned — add type 7 in Plot Master > Villa types once its areas are
 * known, then plan it on plot 18.
 *
 * Needs migration 525. Safe to re-run: existing types are kept (their areas are
 * reported if they differ from the sheet), and a plot already planned with a
 * different type is reported, not overwritten.
 *
 *   node scripts/seedSilverWoodsVillaTypes.js            dry run (no writes)
 *   node scripts/seedSilverWoodsVillaTypes.js --apply    write
 *   [--project <id>]  default 1012
 */
const path = require("path");
require(path.join(__dirname, "..", "config/env")).loadEnv();
const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.argv.includes("--apply");
const argProject = process.argv.indexOf("--project");
const PROJECT_ID = argProject > 0 ? parseInt(process.argv[argProject + 1], 10) : 1012;
const BLOCK_NAME = "A";

const TYPES = [
  { n: 1, land: 1654.56, builtUp: 2400.36, plots: [...range(37, 64), ...range(68, 105), ...range(107, 115)] },
  { n: 2, land: 1859.41, builtUp: 2557.51, plots: range(12, 17) },
  { n: 3, land: 1555.62, builtUp: 2181.96, plots: [8, 25, 26, 27, 28] },
  { n: 4, land: 1591.11, builtUp: 2286.72, plots: [...range(1, 7), 9, 10, 11, 23, 24, 29] },
  { n: 5, land: 2146.71, builtUp: 3175.36, plots: range(32, 36) },
  { n: 6, land: 2155.44, builtUp: 3069.95, plots: range(19, 22) },
];
function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (text, inputs = {}, tx = null) => {
    const r = (tx || pool).request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };

  console.log(`=== Silver Woods villa types — ${APPLY ? "APPLY" : "DRY RUN"} — project ${PROJECT_ID} ===`);
  if ((await q("SELECT COL_LENGTH('dbo.PlotMaster','PlannedVillaTypeId') AS c"))[0].c == null) {
    console.log("STOP: migration 525 (villa type master) is not applied yet."); await closeDB(); process.exit(1);
  }
  const project = (await q("SELECT id, name FROM dbo.enterprise WHERE id = @p", { p: [sql.Int, PROJECT_ID] }))[0];
  if (!project) { console.log("STOP: project not found"); await closeDB(); process.exit(1); }
  console.log(`Project: ${project.name}`);
  const block = (await q("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @p AND BlockName = @b AND IsActive = 1", { p: [sql.Int, PROJECT_ID], b: [sql.NVarChar, BLOCK_NAME] }))[0];
  if (!block) { console.log(`STOP: block ${BLOCK_NAME} not found`); await closeDB(); process.exit(1); }

  const plots = await q("SELECT Id, PlotNo, PlannedVillaTypeId, ConvertedUnitId FROM dbo.PlotMaster WHERE BlockId = @b AND IsActive = 1", { b: [sql.Int, block.Id] });
  const byNo = new Map(plots.map((p) => [String(p.PlotNo).trim(), p]));
  console.log(`Plots in block ${BLOCK_NAME}: ${plots.length}`);

  const existing = await q("SELECT Id, Code, BaseLandAreaSqFt, BuiltUpAreaSqFt FROM dbo.VillaTypeMaster WHERE ProjectId = @p AND IsActive = 1", { p: [sql.Int, PROJECT_ID] });
  const missingPlots = [];
  let toCreate = 0, toPlan = 0, already = 0, conflicts = 0;
  const plan = [];
  for (const t of TYPES) {
    const code = `T${t.n}`;
    const have = existing.find((e) => e.Code === code);
    if (have) {
      const same = Number(have.BuiltUpAreaSqFt) === t.builtUp && Number(have.BaseLandAreaSqFt) === t.land;
      console.log(`  ${code}: exists (id ${have.Id})${same ? "" : ` — areas differ from the sheet: master ${have.BaseLandAreaSqFt}/${have.BuiltUpAreaSqFt}, sheet ${t.land}/${t.builtUp} (kept)`}`);
    } else { toCreate++; console.log(`  ${code}: create — Villa Type ${t.n}, base land ${t.land}, built-up ${t.builtUp}`); }
    const targets = [];
    for (const n of t.plots) {
      const p = byNo.get(String(n));
      if (!p) { missingPlots.push(n); continue; }
      if (have && p.PlannedVillaTypeId === have.Id) { already++; continue; }
      if (p.PlannedVillaTypeId != null) { conflicts++; console.log(`    plot ${n}: already plans another type (id ${p.PlannedVillaTypeId}) — left as is`); continue; }
      if (p.ConvertedUnitId != null) { conflicts++; console.log(`    plot ${n}: already converted — left as is`); continue; }
      targets.push(p.Id);
    }
    toPlan += targets.length;
    plan.push({ t, code, have, targets });
    console.log(`    plots to plan: ${targets.length} of ${t.plots.length}`);
  }
  console.log(`Summary: types to create ${toCreate}, plots to plan ${toPlan}, already planned ${already}, left as is ${conflicts}`);
  if (missingPlots.length) console.log(`WARNING: plot numbers from the sheet not found in block ${BLOCK_NAME}: ${missingPlots.join(", ")}`);
  console.log("Not planned (no type/areas in the sheet): 18 (type 7), 30, 31 (blank), 65, 66, 67, 106, 116-121 (N/A)");

  if (!APPLY) { console.log("Dry run only — re-run with --apply to write."); await closeDB(); return; }

  const tx = pool.transaction();
  await tx.begin();
  try {
    const by = (await q("SELECT MIN(id) AS id FROM dbo.users", {}, tx))[0].id;
    for (const item of plan) {
      let id = item.have?.Id;
      if (!id) {
        id = (await q(`INSERT INTO dbo.VillaTypeMaster (ProjectId, Code, Name, BaseLandAreaSqFt, BuiltUpAreaSqFt, SortOrder, CreatedBy)
                       OUTPUT INSERTED.Id VALUES (@p, @c, @n, @l, @b, @s, @by)`, {
          p: [sql.Int, PROJECT_ID], c: [sql.NVarChar(20), item.code], n: [sql.NVarChar(100), `Villa Type ${item.t.n}`],
          l: [sql.Decimal(18, 2), item.t.land], b: [sql.Decimal(18, 2), item.t.builtUp], s: [sql.Int, item.t.n * 10], by: [sql.Int, by],
        }, tx))[0].Id;
      }
      if (item.targets.length) {
        await q(`UPDATE dbo.PlotMaster SET PlannedVillaTypeId = @v, UpdatedAt = SYSDATETIME()
                 WHERE IsActive = 1 AND ConvertedUnitId IS NULL AND PlannedVillaTypeId IS NULL AND Id IN (${item.targets.join(",")})`,
          { v: [sql.Int, id] }, tx);
      }
    }
    await tx.commit();
    console.log("APPLIED.");
  } catch (e) { await tx.rollback(); console.log("ROLLED BACK:", e.message); process.exitCode = 1; }

  const after = await q(`SELECT v.Code, COUNT(p.Id) AS Plots FROM dbo.VillaTypeMaster v
    LEFT JOIN dbo.PlotMaster p ON p.PlannedVillaTypeId = v.Id AND p.IsActive = 1
    WHERE v.ProjectId = @p AND v.IsActive = 1 GROUP BY v.Code, v.SortOrder ORDER BY v.SortOrder`, { p: [sql.Int, PROJECT_ID] });
  console.log("Now:", after.map((r) => `${r.Code}=${r.Plots}`).join("  "));
  await closeDB();
})().catch(async (e) => { console.error(e); try { await closeDB(); } catch {} process.exit(1); });
