// Read-only: finds roles matching "site engineer" / "civil engineer" and
// shows their current rights (if any) for "purchase orders" — the page key
// PO view is gated on (requirePageRight("purchase-orders","view") in
// backend/routes/purchaseOrders.js). Module/SubModule naming in RoleRights
// isn't assumed — printed from whatever's actually there for each role.
//
// Usage: node backend/scripts/diagnoseEngineerPOViewRights.js

const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const rolesRes = await pool.request().query(`
    SELECT RId, RName FROM dbo.Role
    WHERE LOWER(RName) LIKE '%site engineer%' OR LOWER(RName) LIKE '%civil engineer%'
    ORDER BY RName
  `);
  console.log(`Roles matching "site engineer" / "civil engineer":`);
  if (!rolesRes.recordset.length) console.log("  (none found)");
  rolesRes.recordset.forEach((r) => console.log(`  RId ${r.RId} — "${r.RName}"`));

  for (const role of rolesRes.recordset) {
    console.log(`\n=== "${role.RName}" (RId ${role.RId}) ===`);
    const poRes = await pool.request().input("RoleId", require("../db").sql.Int, role.RId).query(`
      SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete
      FROM dbo.RoleRights
      WHERE RoleId = @RoleId AND (Module LIKE '%purchase%' OR SubModule LIKE '%purchase%')
    `);
    if (!poRes.recordset.length) {
      console.log(`  No RoleRights row at all for anything "purchase*" — needs an INSERT, not an UPDATE.`);
    } else {
      poRes.recordset.forEach((r) =>
        console.log(`  Module="${r.Module}" SubModule="${r.SubModule}" View=${r.CanView} Add=${r.CanAdd} Edit=${r.CanEdit} Delete=${r.CanDelete}`),
      );
    }
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
