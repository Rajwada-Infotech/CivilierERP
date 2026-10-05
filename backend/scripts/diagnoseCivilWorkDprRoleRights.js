// Read-only: confirms the actual Module/SubModule naming dbo.RoleRights
// uses for civilworkdpr-* pages, by finding any existing row for them
// (any role) — rather than deriving it from roles.js's own fallback
// convention (Module = SubModule = pageKey with hyphens replaced by
// spaces) and trusting that blindly. Also shows Jr./Sr. Civil Engineer's
// current rights for every civilworkdpr page.
//
// Usage: node backend/scripts/diagnoseCivilWorkDprRoleRights.js

const { connectDB, getPool, sql, closeDB } = require("../db");

const PAGE_KEYS = [
  "civilworkdpr-dashboard",
  "civilworkdpr-dependency",
  "civilworkdpr-work-done",
  "civilworkdpr-quality-check",
  "civilworkdpr-worker-attendance",
  "civilworkdpr-activity-reporting",
  "civilworkdpr-room-master",
  "civilworkdpr-amendment",
  "civilworkdpr-work-transfer",
  "civilworkdpr-daily-labour",
];

async function main() {
  await connectDB();
  const pool = getPool();

  console.log("Any existing RoleRights row (any role) touching civilworkdpr:");
  const anyRes = await pool.request().query(`
    SELECT DISTINCT RoleId, Module, SubModule FROM dbo.RoleRights
    WHERE Module LIKE '%civilworkdpr%' OR SubModule LIKE '%civilworkdpr%'
    ORDER BY Module
  `);
  if (!anyRes.recordset.length) console.log("  (none found anywhere — no existing convention to copy)");
  anyRes.recordset.forEach((r) => console.log(`  RoleId ${r.RoleId}: Module="${r.Module}" SubModule="${r.SubModule}"`));

  for (const roleName of ["Jr. Civil Engineer", "Sr. Civil Engineer"]) {
    const roleRes = await pool.request().input("name", sql.NVarChar(200), roleName).query(`
      SELECT RId FROM dbo.Role WHERE RName = @name
    `);
    if (!roleRes.recordset.length) {
      console.log(`\nRole "${roleName}" not found.`);
      continue;
    }
    const roleId = roleRes.recordset[0].RId;
    console.log(`\n=== "${roleName}" (RId ${roleId}) — civilworkdpr rows ===`);
    const rowsRes = await pool.request().input("RoleId", sql.Int, roleId).query(`
      SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport
      FROM dbo.RoleRights WHERE RoleId = @RoleId AND (Module LIKE '%civilworkdpr%' OR SubModule LIKE '%civilworkdpr%')
    `);
    if (!rowsRes.recordset.length) console.log("  (none)");
    rowsRes.recordset.forEach((r) =>
      console.log(`  Module="${r.Module}" SubModule="${r.SubModule}" View=${r.CanView} Add=${r.CanAdd} Edit=${r.CanEdit} Delete=${r.CanDelete} Print=${r.CanPrint} Export=${r.CanExport}`),
    );
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
