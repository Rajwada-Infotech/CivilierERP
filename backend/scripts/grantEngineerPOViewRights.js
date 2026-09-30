// Grants Purchase Order VIEW-only rights to "Jr. Civil Engineer" (RId 1008)
// and "Sr. Civil Engineer" (RId 1009) — confirmed via
// diagnoseEngineerPOViewRights.js that neither has ANY RoleRights row for
// Purchase Orders at all (so this INSERTs, it doesn't UPDATE), unlike
// "Head Civil Engineer" (RId 1010) which already has View=true/Add=true.
//
// Module/SubModule are "Material"/"PurchaseOrders" — copied verbatim from
// Head Civil Engineer's own existing row, not guessed: this exact pair is
// also the one explicitly mapped to page key "purchase-orders" in
// backend/middleware/permissions.js's PERMISSION_PAGE_KEYS
// ("material:purchaseorders" -> ["purchase-orders"]), which is what
// requirePageRight("purchase-orders","view") in
// backend/routes/purchaseOrders.js actually checks.
//
// View only — Add/Edit/Delete stay 0, matching exactly what was asked for
// ("PO viewing permissions"), not the fuller Add access Head Civil
// Engineer happens to also have.
//
// Dry-run by default. Usage:
//   node backend/scripts/grantEngineerPOViewRights.js [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const TARGET_ROLE_IDS = [1008, 1009]; // Jr. Civil Engineer, Sr. Civil Engineer
const MODULE = "Material";
const SUBMODULE = "PurchaseOrders";

async function main() {
  await connectDB();
  const pool = getPool();

  const rolesRes = await pool.request().query(`
    SELECT RId, RName FROM dbo.Role WHERE RId IN (${TARGET_ROLE_IDS.join(",")})
  `);
  const roleById = new Map(rolesRes.recordset.map((r) => [r.RId, r.RName]));
  for (const id of TARGET_ROLE_IDS) {
    if (!roleById.has(id)) {
      console.error(`RId ${id} not found in dbo.Role — refusing to guess, aborting.`);
      await closeDB();
      process.exit(1);
    }
  }

  for (const roleId of TARGET_ROLE_IDS) {
    const roleName = roleById.get(roleId);
    const existing = await pool.request().input("RoleId", sql.Int, roleId).query(`
      SELECT CanView, CanAdd, CanEdit, CanDelete FROM dbo.RoleRights
      WHERE RoleId = @RoleId AND Module = '${MODULE}' AND SubModule = '${SUBMODULE}'
    `);
    if (existing.recordset.length) {
      const r = existing.recordset[0];
      console.log(`"${roleName}" (RId ${roleId}) already has a row: View=${r.CanView} Add=${r.CanAdd} Edit=${r.CanEdit} Delete=${r.CanDelete}`);
      if (!r.CanView) {
        console.log(`  -> will UPDATE View=1 (leaving Add/Edit/Delete as-is)`);
        if (APPLY) {
          await pool.request().input("RoleId", sql.Int, roleId).query(`
            UPDATE dbo.RoleRights SET CanView = 1
            WHERE RoleId = @RoleId AND Module = '${MODULE}' AND SubModule = '${SUBMODULE}'
          `);
          console.log(`  Done.`);
        }
      } else {
        console.log(`  -> already has View=1, nothing to do`);
      }
      continue;
    }
    console.log(`"${roleName}" (RId ${roleId}) has no row for "${MODULE}"/"${SUBMODULE}" -> will INSERT View=1, Add/Edit/Delete=0`);
    if (APPLY) {
      await pool
        .request()
        .input("RoleId", sql.Int, roleId)
        .input("Module", sql.NVarChar(100), MODULE)
        .input("SubModule", sql.NVarChar(100), SUBMODULE).query(`
          INSERT INTO dbo.RoleRights
            (RoleId, Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval)
          VALUES
            (@RoleId, @Module, @SubModule, 1, 0, 0, 0, 0, 0, 0)
        `);
      console.log(`  Done.`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
  } else {
    console.log("\nApplied. getRolePagePermissions() reads dbo.RoleRights live on every request (no cache layer) — takes effect immediately, no login/refresh needed.");
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
