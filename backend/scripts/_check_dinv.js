const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  // Find what the expense booking list API actually returns — check BOTH the doc number column AND the join
  // The UI shows "INV/DINV/000001/2026-2027" — the INV/ prefix is added at display time
  // Let's check ExpenseBooking for ALL records (not just DINV filtered)
  const eb = await pool.request().query(`
    SELECT TOP 20 Eid, EDocNo, EDocTypeId, EStatus, ECreatedAt
    FROM dbo.ExpenseBooking
    ORDER BY ECreatedAt DESC
  `);
  console.log("Recent ExpenseBooking rows:", JSON.stringify(eb.recordset, null, 2));

  // Check DocNumberSequence completely
  const dns = await pool.request().query(`
    SELECT TOP 20 *
    FROM dbo.DocNumberSequence
    ORDER BY Id DESC
  `);
  console.log("\nRecent DocNumberSequence:", JSON.stringify(dns.recordset, null, 2));

  await closeDB();
}
main().catch((e) => { console.error(e); process.exit(1); });
