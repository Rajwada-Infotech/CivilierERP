// Relabels the Floor of villa DPR chains from the bare plot name ("21") to
// "Plot 21". A plot named with digits only was read as a floor number, so a
// villa showed as "Floor 21" in the DPR tree. New villas get "Plot …" from
// unitLayout.chainFloorLabel; this fixes the ones converted before that.
// Only chains of floorless units built on plots are touched.
//
//   node scripts/fixVillaChainFloors.js            # dry run (lists them)
//   node scripts/fixVillaChainFloors.js --apply
const { connectDB, getPool, closeDB } = require("../db");
const APPLY = process.argv.includes("--apply");

const LABEL_SQL = `(SELECT N'Plot ' + STRING_AGG(p.PlotName, '+') WITHIN GROUP (ORDER BY p.PlotName)
                    FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id AND p.IsActive = 1)`;

async function main() {
  await connectDB();
  const pool = getPool();
  const rows = (await pool.request().query(`
    SELECT u.UnitName, d.Floor AS OldFloor, ${LABEL_SQL} AS NewFloor, COUNT(*) AS Chains
    FROM dbo.DependencyMaster d
    JOIN dbo.UnitMaster u ON u.Id = d.FlatId AND u.FloorNo IS NULL
    WHERE EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id AND p.IsActive = 1)
      AND d.Floor <> ${LABEL_SQL}
    GROUP BY u.Id, u.UnitName, d.Floor
    ORDER BY u.UnitName`)).recordset;
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — villa chains whose floor is not their "Plot …" label:`);
  rows.forEach((r) => console.log(`  ${r.UnitName}: "${r.OldFloor}" -> "${r.NewFloor}"  (${r.Chains} chain(s))`));
  if (!rows.length) console.log("  (none)");
  if (APPLY && rows.length) {
    const res = await pool.request().query(`
      UPDATE d SET Floor = ${LABEL_SQL}, UpdatedAt = SYSDATETIME()
      FROM dbo.DependencyMaster d
      JOIN dbo.UnitMaster u ON u.Id = d.FlatId AND u.FloorNo IS NULL
      WHERE EXISTS (SELECT 1 FROM dbo.PlotMaster p WHERE p.ConvertedUnitId = u.Id AND p.IsActive = 1)
        AND d.Floor <> ${LABEL_SQL}`);
    console.log(`\nAPPLIED: ${res.rowsAffected[0]} chain(s) relabelled.`);
  } else if (!APPLY) {
    console.log("\nDry run — nothing was written.");
  }
  await closeDB();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("fixVillaChainFloors failed:", e.message);
  try { await closeDB(); } catch (_) { /* ignore */ }
  process.exit(1);
});
