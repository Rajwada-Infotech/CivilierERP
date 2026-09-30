// Grants View/Add/Edit/Print/Export on every Civil Work DPR page to
// Jr. Civil Engineer (RId 1008) and Sr. Civil Engineer (RId 1009).
// Delete is deliberately left untouched (not requested).
//
// Module/SubModule naming confirmed via diagnoseCivilWorkDprRoleRights.js
// against the 5 pages that already had a row for these two roles:
// Module = SubModule = "civilworkdpr <suffix>" (hyphens -> spaces) — not
// derived/guessed, copied from what's actually there. kebab() in
// backend/middleware/permissions.js's getCandidatePageKeys turns that
// back into the exact page key (e.g. "civilworkdpr work done" ->
// "civilworkdpr-work-done"), confirming the round-trip.
//
// 5 of 9 pages already have a row for both roles (dashboard, work-done,
// activity-reporting, dependency, worker-attendance) — those get UPDATEd.
// The other 4 (quality-check, room-master, amendment, daily-labour) have
// no row at all for either role — those get INSERTed.
//
// Dry-run by default. Usage:
//   node backend/scripts/grantCivilWorkDprRights.js [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const TARGET_ROLES = [
  { id: 1008, name: "Jr. Civil Engineer" },
  { id: 1009, name: "Sr. Civil Engineer" },
];

// Page-key suffixes (after "civilworkdpr-") -> space form for Module/SubModule.
const PAGES = [
  "dashboard",
  "dependency",
  "work done",
  "quality check",
  "worker attendance",
  "activity reporting",
  "room master",
  "amendment",
  "daily labour",
];

async function main() {
  await connectDB();
  const pool = getPool();

  for (const role of TARGET_ROLES) {
    console.log(`\n=== ${role.name} (RId ${role.id}) ===`);
    for (const suffix of PAGES) {
      const moduleVal = `civilworkdpr ${suffix}`;
      const existing = await pool.request().input("RoleId", sql.Int, role.id).input("Module", sql.NVarChar(100), moduleVal).query(`
        SELECT CanView, CanAdd, CanEdit, CanPrint, CanExport FROM dbo.RoleRights
        WHERE RoleId = @RoleId AND Module = @Module AND SubModule = @Module
      `);
      if (existing.recordset.length) {
        const r = existing.recordset[0];
        const already = r.CanView && r.CanAdd && r.CanEdit && r.CanPrint && r.CanExport;
        console.log(`  "${moduleVal}": row exists (View=${r.CanView} Add=${r.CanAdd} Edit=${r.CanEdit} Print=${r.CanPrint} Export=${r.CanExport}) -> ${already ? "already fully granted" : "will UPDATE to all 1 (Delete untouched)"}`);
        if (APPLY && !already) {
          await pool.request().input("RoleId", sql.Int, role.id).input("Module", sql.NVarChar(100), moduleVal).query(`
            UPDATE dbo.RoleRights SET CanView = 1, CanAdd = 1, CanEdit = 1, CanPrint = 1, CanExport = 1
            WHERE RoleId = @RoleId AND Module = @Module AND SubModule = @Module
          `);
        }
      } else {
        console.log(`  "${moduleVal}": no row -> will INSERT (View/Add/Edit/Print/Export=1, Delete=0)`);
        if (APPLY) {
          await pool
            .request()
            .input("RoleId", sql.Int, role.id)
            .input("Module", sql.NVarChar(100), moduleVal).query(`
              INSERT INTO dbo.RoleRights
                (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
              VALUES
                (@RoleId, @Module, @Module, 1, 1, 1, 0, 1, 1, 0)
            `);
        }
      }
    }
  }

  console.log(APPLY ? "\nApplied." : "\nDry run. Re-run with --apply to write.");
  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
