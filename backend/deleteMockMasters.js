/**
 * deleteMockMasters.js
 * Removes only sample data added by seeds. Keeps real data.
 * Usage: cd backend && node deleteMockMasters.js
 */

require("dotenv").config();
const sql = require("mssql");

const config = {
  // same as seeds
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

async function clean() {
  let pool;
  try {
    pool = await sql.connect(config);
    console.log("Connected, cleaning mock data...");

    // Delete all TDS (all were mock)
    const delTds = await pool.request().query("DELETE FROM dbo.TDSMaster");
    console.log(`Deleted ${delTds.rowsAffected[0]} TDS rows.`);

    // Delete specific mock FY
    const delFy1 = await pool.request().query("DELETE FROM dbo.FinYear WHERE FName IN ('2023-24', '2024-25')");
    console.log(`Deleted ${delFy1.rowsAffected[0]} mock FY rows.`);

    // Show remaining
    const remTds = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.TDSMaster");
    const remFy = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.FinYear");
    console.log(`Remaining: TDSMaster ${remTds.recordset[0].cnt}, FinYear ${remFy.recordset[0].cnt}`);

    console.log("✅ Clean complete. Only real DB data remains.");
  } catch (err) {
    console.error("Clean failed:", err.message);
  } finally {
    if (pool) await pool.close();
  }
}

clean();

