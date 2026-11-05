// Frees flats, villas and plots still held by an application that is no longer
// live. Until services/crmApplicationWorkflow.js released them, a rejected,
// cancelled, expired or deleted application — or one whose booking was
// cancelled — kept its Active unit line, and the one-Active-line-per-unit
// index then stopped that unit ever being applied for again.
//
// Only lines of a dead application are touched (Status -> 'Cancelled');
// nothing is deleted. Dry run by default.
//   node scripts/releaseDeadApplicationLines.js            report only
//   node scripts/releaseDeadApplicationLines.js --apply    write
const { connectDB, getPool, closeDB, sql } = require("../db");
const APPLY = process.argv.includes("--apply");

const DEAD = `(a.IsActive = 0 OR a.Status IN (N'Rejected', N'Cancelled', N'Expired')
  OR (a.Status = N'Converted' AND NOT EXISTS (
        SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = a.Id AND b.IsActive = 1
          AND b.Status NOT IN (N'Cancelled', N'Rejected', N'Expired', N'Transferred'))))`;

(async () => {
  await connectDB();
  const pool = getPool();
  const list = async (table, col) => (await pool.request().query(`
    SELECT l.Id, l.${col} AS ItemId, a.ApplicationNo, a.Status, a.IsActive
    FROM dbo.${table} l JOIN dbo.CrmApplication a ON a.Id = l.ApplicationId
    WHERE l.Status = N'Active' AND ${DEAD}
    ORDER BY a.ApplicationNo`)).recordset;
  const units = await list("CrmApplicationUnit", "UnitId");
  const plots = await list("CrmApplicationPlot", "PlotId");
  console.log(`Unit lines held by dead applications: ${units.length}`);
  units.slice(0, 50).forEach((r) => console.log(`  ${r.ApplicationNo} (${r.IsActive ? r.Status : "deleted"}) -> unit ${r.ItemId}`));
  console.log(`Plot lines held by dead applications: ${plots.length}`);
  plots.slice(0, 50).forEach((r) => console.log(`  ${r.ApplicationNo} (${r.IsActive ? r.Status : "deleted"}) -> plot ${r.ItemId}`));
  if (!APPLY) { console.log("Dry run only — re-run with --apply to release them."); await closeDB(); return; }
  const tx = pool.transaction();
  await tx.begin();
  try {
    for (const [table, rows] of [["CrmApplicationUnit", units], ["CrmApplicationPlot", plots]]) {
      for (const r of rows) {
        await tx.request().input("id", sql.Int, r.Id).query(`UPDATE dbo.${table} SET Status = N'Cancelled' WHERE Id = @id AND Status = N'Active'`);
      }
    }
    await tx.commit();
    console.log(`Released ${units.length} unit line(s) and ${plots.length} plot line(s).`);
  } catch (e) { await tx.rollback(); console.log("ROLLED BACK:", e.message); process.exitCode = 1; }
  await closeDB();
})().catch((e) => { console.error(e.message); process.exit(1); });
