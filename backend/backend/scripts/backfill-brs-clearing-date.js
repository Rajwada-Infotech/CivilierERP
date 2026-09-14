require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { connectDB, getPool } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  // Set UpdatedAt = CreatedAt for all rows where the payment is cleared
  // but UpdatedAt was never stamped (rows inserted before the fix).
  const r = await pool.request().query(`
    UPDATE BankReconciliation
    SET UpdatedAt = CreatedAt
    WHERE IsMatched = 1 AND UpdatedAt IS NULL
  `);
  console.log(`✓ Backfilled UpdatedAt on ${r.rowsAffected[0]} BRS row(s).`);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
