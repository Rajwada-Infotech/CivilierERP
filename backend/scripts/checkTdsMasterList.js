// Read-only: lists every active TDSMaster row, to see if a 0%/"Nil"/"No
// TDS" record already exists that DINV/000124/2025-2026 (Eid 3221) could be
// tagged with to satisfy resolveInvoiceLinkedTds's "TDSId must be set"
// check while deducting nothing — the sanctioned way to mark an invoice
// "no TDS due" without touching the supplier's IsTdsApplicable flag (which
// would affect every other invoice for that supplier too).
//
// Usage:
//   node backend/scripts/checkTdsMasterList.js

const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();
  const res = await pool.request().query(`
    SELECT TDSId, Nature, Name, Percentage, Status FROM dbo.TDSMaster ORDER BY Percentage, Name
  `);
  console.log(res.recordset);
  await closeDB();
}
main().catch((err) => { console.error(err); process.exit(1); });
