/**
 * backend/scripts/reconcile-renamed-migrations.js
 *
 * Migrations 181-198 in backend/migrations/181-200/ had duplicate number
 * prefixes (two branches numbering sequentially from a common ancestor).
 * The 16 CRM/SA-module files below were renumbered to 206-221 in
 * backend/migrations/201-220/ to make every prefix unique again.
 *
 * Migrations are tracked by filename alone in dbo.__Migrations (see
 * migrate.js) — on any environment where one of these files already ran
 * under its OLD name, `migrate up` would see the new filename as a fresh,
 * unapplied migration and try to re-run it (duplicate-column/table errors,
 * or a silently re-applied backfill).
 *
 * IMPORTANT: this is intentionally NOT a numbered migration under
 * backend/migrations/ — umzug computes its full pending-migration list
 * ONCE at the start of a single `migrate up` run, before executing
 * anything, so a same-batch migration can't reconcile tracking in time to
 * change what that same run considers pending. Run this script by hand,
 * once, BEFORE `node migrate.js up`, on any environment where these CRM/SA
 * migrations might already have applied (production, a teammate's DB —
 * anywhere other than the one this repo change was authored against).
 *
 * Usage:
 *   node backend/scripts/reconcile-renamed-migrations.js
 *
 * Safe to run anywhere, any number of times — each rename only fires when
 * the old name is present and the new name isn't, so an environment where
 * none of these ever ran (or where this has already been run) sees zero
 * rows affected.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { connectDB, getPool, sql } = require("../db");

const RENAMES = [
  ["181-crm-customer-master.sql", "206-crm-customer-master.sql"],
  ["182-crm-payment-plan-scoping.sql", "207-crm-payment-plan-scoping.sql"],
  ["183-crm-on-account-payments.sql", "208-crm-on-account-payments.sql"],
  ["184-crm-sales-deed-director-approval.sql", "209-crm-sales-deed-director-approval.sql"],
  ["185-crm-booking-invoice-attachments.sql", "210-crm-booking-invoice-attachments.sql"],
  ["186-crm-welcome-call-plan-confirm.sql", "211-crm-welcome-call-plan-confirm.sql"],
  ["187-crm-sales-deed-customer-approval.sql", "212-crm-sales-deed-customer-approval.sql"],
  ["190-crm-collections-gl-account.sql", "213-crm-collections-gl-account.sql"],
  ["191-crm-receivables-account-group.sql", "214-crm-receivables-account-group.sql"],
  ["192-sa-followups-page.sql", "215-sa-followups-page.sql"],
  ["193-sa-ad-creatives-keypoints.sql", "216-sa-ad-creatives-keypoints.sql"],
  ["194-crm-sales-deed-statutory-gl-account.sql", "217-crm-sales-deed-statutory-gl-account.sql"],
  ["195-sa-commission-gl-account.sql", "218-sa-commission-gl-account.sql"],
  ["196-crm-parking-payment-columns.sql", "219-crm-parking-payment-columns.sql"],
  ["197-sa-marketing-invoice-gl-account.sql", "220-sa-marketing-invoice-gl-account.sql"],
  ["198-crm-receipt-deposit-bank.sql", "221-crm-receipt-deposit-bank.sql"],
];

async function main() {
  await connectDB();
  const pool = getPool();

  const tableCheck = await pool.request().query(`
    SELECT COUNT(1) AS cnt FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '__Migrations'
  `);
  if (!tableCheck.recordset[0].cnt) {
    console.log("dbo.__Migrations doesn't exist yet — nothing to reconcile.");
    process.exit(0);
  }

  let renamed = 0;
  for (const [oldName, newName] of RENAMES) {
    const result = await pool
      .request()
      .input("OldName", sql.NVarChar(255), oldName)
      .input("NewName", sql.NVarChar(255), newName).query(`
        UPDATE dbo.__Migrations
        SET name = @NewName
        WHERE name = @OldName
          AND NOT EXISTS (SELECT 1 FROM dbo.__Migrations WHERE name = @NewName)
      `);
    if (result.rowsAffected[0] > 0) {
      console.log(`✓ ${oldName} -> ${newName}`);
      renamed++;
    }
  }

  console.log(
    renamed > 0
      ? `Reconciled ${renamed} renamed migration(s).`
      : "Nothing to reconcile on this environment.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
