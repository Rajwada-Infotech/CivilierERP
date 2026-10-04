// One-off: creates each existing company's own Cash in Hand ledger head
// (LHeadCode `CASH-C-<companyId>`) via generalLedger.js's ensureCashInHandHead
// — idempotent get-or-create, safe to re-run. New companies get this
// automatically on creation (see routes/companyMaster.js); this backfills
// every company that already existed before that hook was added.
//
// Usage: node scripts/seedCashInHandPerCompany.js
const { connectDB, getPool, closeDB, sql } = require("../db");
const { ensureCashInHandHead } = require("../services/generalLedger");

async function main() {
  await connectDB();
  const pool = getPool();

  const companies = await pool.request().query(
    `SELECT id, name FROM dbo.enterprise WHERE business_type = 'C'`,
  );

  console.log(`Found ${companies.recordset.length} companies.\n`);
  for (const c of companies.recordset) {
    const headId = await ensureCashInHandHead(pool, c.id, "seed-script");
    console.log(`  ${c.name} (id=${c.id}) -> Cash in Hand LHeadId=${headId}`);
  }
  console.log("\nDone.");

  await closeDB();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
