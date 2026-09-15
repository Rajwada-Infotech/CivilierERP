// One-off diagnostic: shows exactly which page keys a role's RoleRights
// rows expand into via the real getRolePagePermissions()/getCandidatePageKeys()
// logic, filtered to dashboard-related keys. Used to trace why a role is
// getting access to dashboards it was never explicitly granted.
//
// Usage: node scripts/debugRoleDashboardAccess.js "<role name or partial>"
const { connectDB, getPool, closeDB, sql } = require("../db");
const { getRolePagePermissions } = require("../middleware/permissions");

async function main() {
  const search = process.argv[2] || "Civil Engineer";
  await connectDB();
  const pool = getPool();

  const roles = await pool
    .request()
    .input("search", sql.NVarChar(200), `%${search}%`)
    .query(`SELECT RId, RName FROM dbo.Role WHERE RName LIKE @search`);

  if (roles.recordset.length === 0) {
    console.log(`No role matching "${search}"`);
    await closeDB();
    return;
  }

  for (const role of roles.recordset) {
    console.log(`\n=== Role: ${role.RName} (RId=${role.RId}) ===`);

    const rawRights = await pool
      .request()
      .input("RoleId", sql.Int, role.RId)
      .query(
        `SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval
         FROM dbo.RoleRights WHERE RoleId = @RoleId ORDER BY Module, SubModule`,
      );
    console.log(`-- Raw RoleRights rows (${rawRights.recordset.length}):`);
    for (const r of rawRights.recordset) {
      console.log(`   Module="${r.Module}" SubModule="${r.SubModule}"`);
    }

    const effective = await getRolePagePermissions(role.RId);
    const dashboardKeys = effective.filter((p) => p.page.includes("dashboard"));
    console.log(`\n-- Effective page keys containing "dashboard" (${dashboardKeys.length}):`);
    for (const p of dashboardKeys) {
      console.log(`   ${p.page}  [${p.actions.join(",")}]`);
    }
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Debug script failed:", err);
  process.exit(1);
});
