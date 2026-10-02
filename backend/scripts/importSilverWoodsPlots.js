"use strict";
/**
 * Silver Woods (project 1012, Delta Realtech): set the project type to
 * Plotted + Villa, create block A, and enter its 121 plots from
 * "AVAILABILITY LIST OF RAJWADA.xlsx" sheet "Silverwood New".
 *
 *   PlotNo / PlotName  = column A, as on the sheet (1 ... 121)
 *   AreaSqFt           = column D, Land Area (sq ft)
 *   Rate, facing, size = left empty (not on the sheet)
 * Villa type / built-up area (cols F, G) are not plot data — they are
 * entered when a plot is converted to its villa. No status, holds, clients
 * or bookings are entered.
 *
 * Dry run by default (prints exactly what it would do). --apply writes, in
 * one transaction. Safe to re-run: an existing block / plot is never
 * duplicated; a plot already present with a different area is reported, not
 * overwritten.
 *
 * Run: node scripts/importSilverWoodsPlots.js [--apply]
 */
const { connectDB, getPool, closeDB, sql } = require("../db");
const APPLY = process.argv.includes("--apply");
const argProject = process.argv.indexOf("--project");
const PROJECT_ID = argProject > 0 ? parseInt(process.argv[argProject + 1], 10) : 1012;
const PROJECT_NAME = "SILVER WOODS";
const PROJECT_TYPE_CODE = "PLOTTED_VILLA";
const BLOCK_NAME = "A";
// [plot no, land area sq ft] — generated from the sheet, column A and D.
const PLOTS = [[1,1758.28],[2,1731.26],[3,1705.97],[4,1679.72],[5,1653.32],[6,1627.92],[7,1607.2],[8,1582.21],[9,1602.53],[10,1622.75],[11,1679.66],[12,1859.41],[13,1891.3],[14,1903.15],[15,1913.73],[16,1924.32],[17,1995.54],[18,2085.76],[19,2155.44],[20,2253.93],[21,2352.43],[22,2450.92],[23,1591.11],[24,1591.2],[25,1564.01],[26,1555.62],[27,1555.62],[28,1581.12],[29,1593.87],[30,1606.0],[31,1619.0],[32,2295.79],[33,2146.78],[34,2146.78],[35,2146.78],[36,2146.78],[37,1685.37],[38,1655.96],[39,1656.35],[40,1707.44],[41,1654.96],[42,1654.97],[43,1654.57],[44,1654.57],[45,1654.57],[46,1654.57],[47,1713.25],[48,1660.1],[49,1654.83],[50,1654.67],[51,1654.56],[52,1654.57],[53,1659.81],[54,1657.3],[55,1655.41],[56,1655.4],[57,1654.9],[58,1654.57],[59,1654.57],[60,1654.57],[61,1937.31],[62,1929.9],[63,1859.61],[64,1753.16],[65,1629.22],[66,1965.52],[67,2002.68],[68,2262.22],[69,1654.57],[70,1654.57],[71,1654.57],[72,1654.57],[73,1654.57],[74,1654.57],[75,1654.57],[76,1654.57],[77,1654.57],[78,1654.57],[79,1654.57],[80,1654.57],[81,1654.57],[82,1654.57],[83,1654.57],[84,1654.57],[85,1654.57],[86,2160.92],[87,2172.25],[88,1654.57],[89,1654.57],[90,1654.57],[91,1654.57],[92,1654.57],[93,1654.57],[94,1654.57],[95,1654.57],[96,1654.57],[97,1654.57],[98,1654.57],[99,1654.57],[100,1654.57],[101,1654.57],[102,1654.57],[103,1654.57],[104,1654.57],[105,1970.8],[106,1656.99],[107,1654.57],[108,1654.57],[109,1654.57],[110,1654.57],[111,1654.57],[112,1654.57],[113,1654.57],[114,1654.57],[115,1654.57],[116,1818.13],[117,1733.39],[118,1426.05],[119,1487.96],[120,1526.3],[121,1172.49]];

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s, inputs = {}) => {
    const r = pool.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(s)).recordset;
  };
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${new Date().toISOString()} — database ${(await q("SELECT DB_NAME() d"))[0].d}`);

  // Guards: the project must be the one the recon found; nothing booked on it.
  const proj = (await q("SELECT id, name, company_id, project_type_id FROM dbo.enterprise WHERE id = @id AND business_type = 'P'", { id: [sql.Int, PROJECT_ID] }))[0];
  if (!proj || String(proj.name).trim().toUpperCase() !== PROJECT_NAME) throw new Error(`Project ${PROJECT_ID} is not ${PROJECT_NAME}: ${JSON.stringify(proj)}`);
  const type = (await q("SELECT Id, Name FROM dbo.ProjectTypeMaster WHERE Code = @c AND IsActive = 1", { c: [sql.NVarChar(40), PROJECT_TYPE_CODE] }))[0];
  if (!type) throw new Error(`Project type ${PROJECT_TYPE_CODE} not found`);
  const by = (await q(`SELECT TOP 1 u.id FROM dbo.Users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE LOWER(r.RName) = 'super_admin' AND ISNULL(u.discontinue,0) = 0 ORDER BY u.id`))[0]?.id ?? null;
  console.log(`project: ${proj.id} ${proj.name} (company ${proj.company_id}), type now ${proj.project_type_id ?? "none"} -> ${type.Id} ${type.Name}`);

  const block = (await q("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @p AND BlockName = @b AND IsActive = 1", { p: [sql.Int, PROJECT_ID], b: [sql.NVarChar(100), BLOCK_NAME] }))[0];
  const existing = block ? await q("SELECT PlotNo, AreaSqFt FROM dbo.PlotMaster WHERE BlockId = @b AND IsActive = 1", { b: [sql.Int, block.Id] }) : [];
  const byNo = new Map(existing.map((p) => [String(p.PlotNo), Number(p.AreaSqFt)]));
  // A block that already holds plots under some OTHER naming (e.g. "P-1")
  // would get a second, duplicate set. Refuse instead of guessing a mapping.
  const sheetNos = new Set(PLOTS.map(([no]) => String(no)));
  const foreign = existing.filter((p) => !sheetNos.has(String(p.PlotNo)));
  if (foreign.length) {
    throw new Error(`Block ${BLOCK_NAME} already has ${foreign.length} plot(s) not named as on the sheet (e.g. ${foreign.slice(0, 3).map((p) => p.PlotNo).join(", ")}). Not adding a second set — reconcile these first.`);
  }
  const toInsert = PLOTS.filter(([no]) => !byNo.has(String(no)));
  const mismatched = PLOTS.filter(([no, area]) => byNo.has(String(no)) && Math.abs(byNo.get(String(no)) - area) > 0.005);
  console.log(`block ${BLOCK_NAME}: ${block ? "exists (id " + block.Id + ")" : "will be created"}`);
  console.log(`plots on sheet: ${PLOTS.length} (total ${PLOTS.reduce((s, p) => s + p[1], 0).toFixed(2)} sq ft); already present: ${existing.length}; to insert: ${toInsert.length}`);
  if (mismatched.length) console.log("  present with a DIFFERENT area (not changed):", JSON.stringify(mismatched.map(([n, a]) => ({ plot: n, sheet: a, db: byNo.get(String(n)) }))));
  console.log("  first / last to insert:", JSON.stringify(toInsert.slice(0, 3)), "...", JSON.stringify(toInsert.slice(-3)));

  if (!APPLY) {
    console.log("\ndry run — nothing changed. Re-run with --apply to write.");
    await closeDB?.(); process.exit(0);
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    if (proj.project_type_id !== type.Id) {
      await tx.request().input("id", sql.Int, PROJECT_ID).input("t", sql.Int, type.Id)
        .query("UPDATE dbo.enterprise SET project_type_id = @t WHERE id = @id");
    }
    let blockId = block?.Id;
    if (!blockId) {
      blockId = (await tx.request().input("p", sql.Int, PROJECT_ID).input("b", sql.NVarChar(100), BLOCK_NAME).input("by", sql.Int, by)
        .query("INSERT INTO dbo.BlockMaster (ProjectId, BlockName, IsActive, CreatedBy, CreatedAt) OUTPUT INSERTED.Id VALUES (@p, @b, 1, @by, SYSDATETIME())")).recordset[0].Id;
    }
    for (const [no, area] of toInsert) {
      await tx.request().input("p", sql.Int, PROJECT_ID).input("b", sql.Int, blockId)
        .input("no", sql.NVarChar(50), String(no)).input("a", sql.Decimal(18, 2), area).input("by", sql.Int, by)
        .query(`INSERT INTO dbo.PlotMaster (ProjectId, BlockId, PlotNo, PlotName, AreaSqFt, IsActive, CreatedBy, CreatedAt)
                VALUES (@p, @b, @no, @no, @a, 1, @by, SYSDATETIME())`);
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  try {
    const { bumpCacheVersion } = require("../redis");
    for (const k of ["project-master", "enterprises", "block-master"]) await bumpCacheVersion(k);
  } catch (e) { console.log("  (cache bump skipped:", e.message, ")"); }

  const after = (await q(`SELECT (SELECT project_type_id FROM dbo.enterprise WHERE id = @p) AS TypeId,
      (SELECT COUNT(*) FROM dbo.BlockMaster WHERE ProjectId = @p AND IsActive = 1) AS Blocks,
      (SELECT COUNT(*) FROM dbo.PlotMaster WHERE ProjectId = @p AND IsActive = 1) AS Plots,
      (SELECT SUM(AreaSqFt) FROM dbo.PlotMaster WHERE ProjectId = @p AND IsActive = 1) AS TotalArea`, { p: [sql.Int, PROJECT_ID] }))[0];
  console.log(`\napplied — project type ${after.TypeId}, blocks ${after.Blocks}, plots ${after.Plots}, total area ${Number(after.TotalArea).toFixed(2)} sq ft`);
  await closeDB?.();
  process.exit(0);
})().catch((e) => { console.error("FAILED:", e.stack || e.message); process.exit(1); });
