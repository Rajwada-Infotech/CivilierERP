/**
 * backend/scripts/reconcile-plot-migration-renumber.js
 *
 * The plotted-land feature's migrations were written as 482-502 on a branch
 * while main used the same numbers for different migrations (dependency
 * activity, ICT, vehicle, payment). They were renumbered to 502-522
 * (backend/migrations/501-520 and 521-540) so every prefix is unique.
 *
 * Migrations are tracked by filename in dbo.__Migrations (see migrate.js), so
 * on a database where one of these already ran under its OLD name, `migrate up`
 * would see the new name as pending and run it again. Run this ONCE, BEFORE
 * `node migrate.js up`, on any database that ran the branch's migrations under
 * the old names (the dev database). On production none of them ever ran, so
 * this renames nothing there — it is safe to run anywhere, any number of times.
 *
 * Not a numbered migration on purpose: umzug decides what is pending before a
 * run starts, so a migration cannot fix tracking for the run it is part of.
 *
 * Usage: node backend/scripts/reconcile-plot-migration-renumber.js
 */
const { connectDB, getPool, sql } = require("../db");

const RENAMES = [
  ["482-project-type-master.sql", "502-project-type-master.sql"],
  ["483-unit-kind-and-plot-attributes.sql", "503-unit-kind-and-plot-attributes.sql"],
  ["484-sale-of-land-gl-head.sql", "504-sale-of-land-gl-head.sql"],
  ["485-crm-booking-unit-lines.sql", "505-crm-booking-unit-lines.sql"],
  ["486-crm-unit-resale.sql", "506-crm-unit-resale.sql"],
  ["487-crm-gst-rule-master.sql", "507-crm-gst-rule-master.sql"],
  ["488-project-type-master-page-key.sql", "508-project-type-master-page-key.sql"],
  ["489-crm-plot-template.sql", "509-crm-plot-template.sql"],
  ["490-crm-application-unit-lines.sql", "510-crm-application-unit-lines.sql"],
  ["491-plot-master.sql", "511-plot-master.sql"],
  ["492-constructed-asset-kind-master.sql", "512-constructed-asset-kind-master.sql"],
  ["493-plot-adjacency.sql", "513-plot-adjacency.sql"],
  ["494-resale-targets-plot-or-unit.sql", "514-resale-targets-plot-or-unit.sql"],
  ["495-crm-resales-page-key.sql", "515-crm-resales-page-key.sql"],
  ["496-plot-facing-master.sql", "516-plot-facing-master.sql"],
  ["497-asset-kind-is-land-flag.sql", "517-asset-kind-is-land-flag.sql"],
  ["498-plot-grid-layout.sql", "518-plot-grid-layout.sql"],
  ["499-booking-block-id.sql", "519-booking-block-id.sql"],
  ["500-resale-page-label.sql", "520-resale-page-label.sql"],
  ["501-plot-villa-resale-gst-seed.sql", "521-plot-villa-resale-gst-seed.sql"],
  ["502-villa-and-resale-fee-ledger-heads.sql", "522-villa-and-resale-fee-ledger-heads.sql"],
];

async function main() {
  await connectDB();
  const pool = getPool();
  const t = await pool.request().query(
    "SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '__Migrations'");
  if (!t.recordset[0].cnt) { console.log("dbo.__Migrations doesn't exist yet — nothing to reconcile."); process.exit(0); }
  let renamed = 0;
  for (const [oldName, newName] of RENAMES) {
    const r = await pool.request()
      .input("OldName", sql.NVarChar(255), oldName)
      .input("NewName", sql.NVarChar(255), newName)
      .query(`UPDATE dbo.__Migrations SET name = @NewName
              WHERE name = @OldName AND NOT EXISTS (SELECT 1 FROM dbo.__Migrations WHERE name = @NewName)`);
    if (r.rowsAffected[0] > 0) { console.log(`renamed ${oldName} -> ${newName}`); renamed++; }
  }
  console.log(renamed ? `Reconciled ${renamed} renamed migration(s).` : "Nothing to reconcile on this environment.");
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
