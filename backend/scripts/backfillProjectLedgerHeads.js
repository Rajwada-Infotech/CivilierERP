/**
 * backfillProjectLedgerHeads.js
 *
 * Retroactively creates the PRJ-{id}-CUST / PRJ-{id}-SUPP trading ledger
 * heads for any existing Project (dbo.enterprise, business_type='P') that
 * doesn't have them yet. Needed for projects created before the
 * auto-creation logic existed, or where it was skipped at the time due to
 * missing company_id / GST data on the parent company.
 *
 * Reuses the real ensureProjectLedgerHeads() from routes/projectMaster.js
 * (idempotent — safe to run multiple times) rather than reimplementing its
 * GST-conditional insert logic here.
 *
 * Run on the target server (uses its own .env / DB connection):
 *   node backend/scripts/backfillProjectLedgerHeads.js
 */

require("../config/env").loadEnv();
const { connectDB, getPool, sql } = require("../db");
const { ensureProjectLedgerHeads } = require("../routes/projectMaster");

async function main() {
  await connectDB();
  const pool = getPool();

  const projects = await pool.request().query(`
    SELECT id, name, address AS addressLine1, company_id
    FROM dbo.enterprise
    WHERE business_type = 'P'
    ORDER BY id
  `);

  console.log(`Found ${projects.recordset.length} project(s). Checking ledger heads...`);

  let created = 0;
  let skipped = 0;

  for (const p of projects.recordset) {
    const before = await pool
      .request()
      .input("c1", sql.NVarChar(20), `PRJ-${p.id}-CUST`)
      .input("c2", sql.NVarChar(20), `PRJ-${p.id}-SUPP`)
      .query("SELECT COUNT(1) AS cnt FROM dbo.AccountHeadMaster WHERE LHeadCode IN (@c1, @c2)");
    const hadHeads = before.recordset[0].cnt > 0;

    await ensureProjectLedgerHeads(pool, p.id, p.name, p.addressLine1, "system-backfill");

    const after = await pool
      .request()
      .input("c1", sql.NVarChar(20), `PRJ-${p.id}-CUST`)
      .input("c2", sql.NVarChar(20), `PRJ-${p.id}-SUPP`)
      .query("SELECT COUNT(1) AS cnt FROM dbo.AccountHeadMaster WHERE LHeadCode IN (@c1, @c2)");
    const hasHeads = after.recordset[0].cnt > 0;

    if (hadHeads) {
      console.log(`  [skip]    Project ${p.id} (${p.name}) — already has ledger heads.`);
      skipped++;
    } else if (hasHeads) {
      console.log(`  [created] Project ${p.id} (${p.name}) — ledger heads created.`);
      created++;
    } else {
      console.log(
        `  [MISSING] Project ${p.id} (${p.name}) — still has NO ledger heads (company_id=${p.company_id ?? "NULL"}). ` +
          `Check console warnings above for the reason (no company_id, company not found, or missing GST data).`,
      );
      skipped++;
    }
  }

  console.log(`\nDone. Created for ${created} project(s), skipped/already-present for ${skipped}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
