// Turns a block of placeholder units back into PLOTS (Plot Master), for land
// that is sold as plots now and converted to villas later (Plot Master ›
// Convert links the villa back through PlotMaster.ConvertedUnitId).
//
//   - the block gets its own project type (by code, from Project Type Master)
//   - each active unit becomes an active plot with the same number (name tail)
//   - the units and the block's floor rows are switched INACTIVE, never deleted
//   - refuses everything if any unit is referenced (booking, application,
//     room, DPR, resale … — found from this database's own foreign keys)
//
// Dry run by default (one transaction, rolled back):
//   node scripts/unitsToPlots.js --project "Global City" --block BUNGALOW --type PLOTTED_VILLA
//   node scripts/unitsToPlots.js ... --apply

const { connectDB, getPool, sql, closeDB } = require("../db");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const PROJECT = arg("--project");
const BLOCK = arg("--block");
const TYPE = arg("--type");
const norm = (s) => String(s ?? "").trim().toUpperCase();

async function main() {
  if (!PROJECT || !BLOCK || !TYPE) throw new Error('pass --project "<name>" --block "<block>" --type <PROJECT_TYPE_CODE>');
  await connectDB();
  const pool = getPool();
  const tx = pool.transaction();
  await tx.begin();
  const q = async (text, inputs = {}) => {
    const r = tx.request();
    for (const [k, [t, v]] of Object.entries(inputs)) r.input(k, t, v);
    return (await r.query(text)).recordset;
  };
  try {
    const projects = (await q("SELECT id, name FROM dbo.enterprise WHERE business_type = 'P'")).filter((p) => norm(p.name) === norm(PROJECT));
    if (projects.length !== 1) throw new Error(`${projects.length} projects named "${PROJECT}"`);
    const proj = projects[0];
    const blocks = (await q("SELECT Id, BlockName, ProjectTypeId FROM dbo.BlockMaster WHERE ProjectId = @p AND IsActive = 1", { p: [sql.Int, proj.id] }))
      .filter((b) => norm(b.BlockName) === norm(BLOCK));
    if (blocks.length !== 1) throw new Error(`${blocks.length} active blocks named "${BLOCK}" in ${proj.name}`);
    const block = blocks[0];
    const type = (await q("SELECT Id, Name, HasFloors, SellsLand FROM dbo.ProjectTypeMaster WHERE Code = @c AND IsActive = 1", { c: [sql.NVarChar(30), norm(TYPE)] }))[0];
    if (!type) throw new Error(`no active project type with code ${TYPE}`);
    if (type.HasFloors || !type.SellsLand) throw new Error(`"${type.Name}" isn't a plot type (needs no floors and sells land)`);
    console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${proj.name} (#${proj.id}) / block ${block.BlockName} (#${block.Id}) -> "${type.Name}"\n`);

    // Anything pointing at these units blocks the whole change.
    const refs = await q(`
      SELECT OBJECT_NAME(fk.parent_object_id) AS t, COL_NAME(fkc.parent_object_id, fkc.parent_column_id) AS c
      FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      WHERE fk.referenced_object_id = OBJECT_ID('dbo.UnitMaster')`);
    const units = await q("SELECT Id, UnitName, IsActive FROM dbo.UnitMaster WHERE BlockId = @b AND IsActive = 1 ORDER BY Id", { b: [sql.Int, block.Id] });
    const used = [];
    for (const u of units) {
      for (const r of refs) {
        const n = (await q(`SELECT COUNT(*) AS n FROM dbo.[${r.t}] WHERE [${r.c}] = @u`, { u: [sql.Int, u.Id] }))[0].n;
        if (n) used.push(`#${u.Id} ${u.UnitName}: ${n} row(s) in ${r.t}.${r.c}`);
      }
    }
    if (used.length) {
      console.log("STOPPED — these units are in use, nothing was changed:");
      used.forEach((x) => console.log(`  ${x}`));
      await tx.rollback();
      await closeDB();
      process.exit(1);
    }

    const existing = new Set((await q("SELECT PlotNo FROM dbo.PlotMaster WHERE BlockId = @b AND IsActive = 1", { b: [sql.Int, block.Id] })).map((p) => norm(p.PlotNo)));
    let plots = 0; let kept = 0;
    for (const u of units) {
      const no = String(u.UnitName).split("/").pop().trim();
      if (existing.has(norm(no))) { kept++; console.log(`  = plot ${no} already exists`); }
      else {
        await q(`INSERT INTO dbo.PlotMaster (ProjectId, BlockId, PlotNo, PlotName, IsActive, CreatedAt)
                 VALUES (@p, @b, @n, @n, 1, SYSDATETIME())`, { p: [sql.Int, proj.id], b: [sql.Int, block.Id], n: [sql.NVarChar(50), no] });
        plots++;
      }
      await q("UPDATE dbo.UnitMaster SET IsActive = 0, UpdatedAt = SYSDATETIME() WHERE Id = @id", { id: [sql.Int, u.Id] });
    }
    const floors = await q(`UPDATE dbo.CrmProjectAutoSetupFloor SET IsActive = 0 OUTPUT INSERTED.Id
                            WHERE BlockId = @b AND IsActive = 1`, { b: [sql.Int, block.Id] });
    await q("UPDATE dbo.BlockMaster SET ProjectTypeId = @t WHERE Id = @b", { t: [sql.Int, type.Id], b: [sql.Int, block.Id] });

    console.log(`  block type: ${block.ProjectTypeId ?? "same as project"} -> ${type.Name}`);
    console.log(`  plots created: ${plots}${kept ? `, already there: ${kept}` : ""}`);
    console.log(`  units switched inactive: ${units.length} (${units.slice(0, 3).map((u) => u.UnitName).join(", ")}${units.length > 3 ? ", …" : ""})`);
    console.log(`  floor rows switched inactive: ${floors.length}`);
    if (APPLY) { await tx.commit(); console.log("\nAPPLIED."); }
    else { await tx.rollback(); console.log("\nDry run — rolled back, nothing was written."); }
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* already closed */ }
    throw e;
  }
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("unitsToPlots failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
