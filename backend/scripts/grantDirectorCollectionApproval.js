// Two changes:
//
// 1. Grant "edit" on "crm money receipts" at the ROLE level for Director
//    (RoleId from Prashant's own row) — CanEdit was confirmed 0 there.
//    This is what Approve/Bounce/Resubmit are gated on
//    (requirePageRight("crm-money-receipts","edit")
//    in backend/routes/crmMoneyReceipts.js). Every Director gets this, not
//    just Prashant — that's the point of doing it at the role level.
//
// 2. Add "edit" (and "view", since a per-user override REPLACES the role's
//    grant for whatever page it lists, not adds to it — see
//    backend/middleware/permissions.js's mergePagePermissions) for
//    "crm-money-receipts" to Prashant's existing dbo.UserPageRightsJson
//    override. His other 11 existing per-user grants (approval-inbox,
//    trial-balance, balance-sheet, profit-and-loss, the admin/master-view
//    pages, etc. — confirmed by a prior dry run of this script) are left
//    completely untouched; this only adds the one new entry. An earlier
//    version of this script cleared his override entirely to exactly
//    mirror the Director role — deliberately NOT done, since that would
//    have silently dropped that real access.
//
// Dry-run by default. Usage:
//   node backend/scripts/grantDirectorCollectionApproval.js [--user="prashant"] [--apply]

const { connectDB, getPool, sql, closeDB } = require("../db");

const APPLY = process.argv.includes("--apply");
const userArg = process.argv.find((a) => a.startsWith("--user="));
const NAME = userArg ? userArg.split("=")[1].replace(/^"|"$/g, "") : "prashant";
const MODULE = "crm money receipts";

async function main() {
  await connectDB();
  const pool = getPool();

  const userRes = await pool.request().input("name", sql.NVarChar(200), `%${NAME}%`).query(`
    SELECT u.id, u.name, u.email, u.RoleId, r.RName AS role
    FROM dbo.users u LEFT JOIN dbo.Role r ON u.RoleId = r.RId
    WHERE u.name LIKE @name OR u.email LIKE @name
  `);
  if (userRes.recordset.length !== 1) {
    console.error(`Expected exactly one user matching "${NAME}", found ${userRes.recordset.length}:`);
    userRes.recordset.forEach((u) => console.error(`  id ${u.id} — "${u.name}" <${u.email}>`));
    await closeDB();
    process.exit(1);
  }
  const user = userRes.recordset[0];
  console.log(`User: ${user.name} <${user.email}> (id ${user.id}) — role "${user.role}" (RoleId ${user.RoleId})\n`);

  // ── 1. Role-level grant ──────────────────────────────────────────────
  const roleRowRes = await pool.request().input("RoleId", sql.Int, user.RoleId).query(`
    SELECT Module, SubModule, CanView, CanAdd, CanEdit, CanDelete, CanPrint, CanExport, CanPostApproval
    FROM dbo.RoleRights
    WHERE RoleId = @RoleId AND Module = '${MODULE}' AND SubModule = '${MODULE}'
  `);
  if (!roleRowRes.recordset.length) {
    console.error(`No RoleRights row for RoleId ${user.RoleId} / Module "${MODULE}" — refusing to guess an insert, fix manually.`);
    await closeDB();
    process.exit(1);
  }
  const roleRow = roleRowRes.recordset[0];
  console.log(`Role "${user.role}" current rights for "${MODULE}": View=${roleRow.CanView} Add=${roleRow.CanAdd} Edit=${roleRow.CanEdit} Delete=${roleRow.CanDelete}`);
  const needsRoleEdit = !roleRow.CanEdit;
  console.log(needsRoleEdit ? `  -> will set Edit=1 for every "${user.role}"` : `  -> already has Edit=1, nothing to change here`);

  // ── 2. Add crm-money-receipts to Prashant's existing override, untouched otherwise ──
  const PAGE = "crm-money-receipts";
  const overrideRes = await pool.request().input("UserId", sql.Int, user.id).query(`
    SELECT RightsJson FROM dbo.UserPageRightsJson WHERE UserId = @UserId
  `);
  let rightsJson = [];
  if (overrideRes.recordset.length) {
    try {
      rightsJson = JSON.parse(overrideRes.recordset[0].RightsJson || "[]");
      if (!Array.isArray(rightsJson)) throw new Error("not an array");
    } catch (err) {
      console.error(`Existing RightsJson didn't parse as an array — refusing to guess, fix manually. (${err.message})`);
      await closeDB();
      process.exit(1);
    }
  }
  console.log(`\n${user.name}'s existing per-user overrides (${rightsJson.length} page(s) — left untouched):`);
  rightsJson.forEach((e) => console.log(`  page="${e.page}" actions=${JSON.stringify(e.actions)}`));

  const existingEntry = rightsJson.find((e) => String(e.page || "").toLowerCase() === PAGE);
  const currentActions = new Set((existingEntry?.actions || []).map((a) => String(a).toLowerCase()));
  const alreadyHasEdit = currentActions.has("edit");
  console.log(`\nHis own override for "${PAGE}": ${existingEntry ? JSON.stringify([...currentActions]) : "(none — falls back to role)"}`);
  console.log(alreadyHasEdit ? "  -> already has edit, nothing to add here" : `  -> will add edit (and view) for "${PAGE}"`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write both changes.");
    await closeDB();
    return;
  }

  if (needsRoleEdit) {
    await pool.request().input("RoleId", sql.Int, user.RoleId).query(`
      UPDATE dbo.RoleRights SET CanEdit = 1
      WHERE RoleId = @RoleId AND Module = '${MODULE}' AND SubModule = '${MODULE}'
    `);
    console.log(`Role "${user.role}": Edit granted on "${MODULE}".`);
  }

  if (!alreadyHasEdit) {
    const newActions = [...new Set([...currentActions, "view", "edit"])];
    const newRightsJson = existingEntry
      ? rightsJson.map((e) => (String(e.page || "").toLowerCase() === PAGE ? { ...e, actions: newActions } : e))
      : [...rightsJson, { page: PAGE, actions: newActions }];

    await pool
      .request()
      .input("UserId", sql.Int, user.id)
      .input("RightsJson", sql.NVarChar(sql.MAX), JSON.stringify(newRightsJson)).query(`
        MERGE dbo.UserPageRightsJson AS target
        USING (VALUES (@UserId, @RightsJson)) AS source (UserId, RightsJson)
        ON target.UserId = source.UserId
        WHEN MATCHED THEN
          UPDATE SET RightsJson = source.RightsJson, UpdatedAt = GETDATE(), IsActive = 1
        WHEN NOT MATCHED THEN
          INSERT (UserId, RightsJson, IsActive, CreatedAt, UpdatedAt)
          VALUES (source.UserId, source.RightsJson, 1, GETDATE(), GETDATE());
      `);
    console.log(`${user.name}'s override updated — "${PAGE}" now has edit, everything else unchanged.`);
  }
  console.log("\nThe server's in-memory permission cache has a 5-minute TTL — takes effect on its own within 5 minutes, or immediately on next login.");

  await closeDB();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
