// One-off, READ-ONLY diagnostic: finds two classes of bad data in
// dbo.RoleRights across every role —
//
//   1. Duplicate rows: the same (RoleId, Module, SubModule) saved more than
//      once. Harmless at read time (getCandidatePageKeys dedupes via a Set)
//      but bloats the table and points at a frontend bug sending the same
//      page key twice in one save's pagePermissions payload.
//
//   2. Coerced/corrupt rows: Module or SubModule is blank, or was written
//      as the "General"/"General" fallback added in routes/roles.js's
//      defensive coercion (see the SAVE RIGHTS: coerced blank Module/
//      SubModule warning). These came from a page key that was '', null,
//      or undefined at save time — the original intended page can't be
//      recovered from the row itself (that context only existed in the
//      in-memory request at save time), so these can only be identified
//      and removed, not repaired.
//
// This script only reads and reports — it prints exact DELETE statements
// for you to review before running anything.
//
// Usage: node scripts/findRoleRightsIssues.js
const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const all = await pool.request().query(`
    SELECT rr.Id, rr.RoleId, r.RName, rr.Module, rr.SubModule,
           rr.CanView, rr.CanAdd, rr.CanEdit, rr.CanDelete, rr.CanPrint, rr.CanExport, rr.CanPostApproval
    FROM dbo.RoleRights rr
    LEFT JOIN dbo.Role r ON r.RId = rr.RoleId
    ORDER BY rr.RoleId, rr.Module, rr.SubModule, rr.Id
  `);

  console.log(`Total RoleRights rows: ${all.recordset.length}\n`);

  // ── Duplicates ──────────────────────────────────────────────────────────
  const groups = new Map();
  for (const row of all.recordset) {
    const key = `${row.RoleId}|${row.Module}|${row.SubModule}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(`=== Duplicate (RoleId, Module, SubModule) groups: ${dupGroups.length} ===`);
  let dupRowCount = 0;
  for (const g of dupGroups) {
    dupRowCount += g.length - 1;
    console.log(
      `  Role "${g[0].RName}" (${g[0].RoleId})  Module="${g[0].Module}" SubModule="${g[0].SubModule}"  x${g.length}  Ids=[${g.map((r) => r.Id).join(",")}]`,
    );
  }
  console.log(`Total redundant duplicate rows (extras beyond the first of each group): ${dupRowCount}\n`);

  if (dupGroups.length > 0) {
    console.log("-- Suggested cleanup (keeps the lowest Id per group, deletes the rest):");
    for (const g of dupGroups) {
      const keep = Math.min(...g.map((r) => r.Id));
      const drop = g.map((r) => r.Id).filter((id) => id !== keep);
      console.log(`  DELETE FROM dbo.RoleRights WHERE Id IN (${drop.join(",")}); -- keeps Id ${keep}`);
    }
    console.log();
  }

  // ── Blank / coerced rows ────────────────────────────────────────────────
  const bad = all.recordset.filter((r) => {
    const mod = String(r.Module ?? "").trim();
    const sub = String(r.SubModule ?? "").trim();
    return mod === "" || sub === "" || (mod === "General" && sub === "General");
  });
  console.log(`=== Blank or coerced-fallback rows: ${bad.length} ===`);
  for (const r of bad) {
    console.log(`  Id=${r.Id}  Role "${r.RName}" (${r.RoleId})  Module="${r.Module}" SubModule="${r.SubModule}"`);
  }
  if (bad.length > 0) {
    console.log("\n-- These can only be removed, not repaired (the original page key that");
    console.log("   caused them isn't recoverable from the row). Re-grant the intended page");
    console.log("   explicitly in Menu Rights after removing these:");
    console.log(`  DELETE FROM dbo.RoleRights WHERE Id IN (${bad.map((r) => r.Id).join(",")});`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});
