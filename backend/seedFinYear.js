/**
 * seedFinYear.js
 * Run to insert test FinYear rows.
 * Usage: cd backend && node seedFinYear.js
 */

require("dotenv").config();
const sql = require("mssql");

const config = {
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

const SEED_ROWS = [
  { FName: '2023-24', FStartDate: '2023-04-01', FEndDate: '2024-03-31', FStatus: true, FisLocked: true },
  { FName: '2024-25', FStartDate: '2024-04-01', FEndDate: '2025-03-31', FStatus: true, FisLocked: false },
];

async function seed() {
  let pool;
  try {
    console.log("Connecting to:", process.env.DB_SERVER, "/", process.env.DB_NAME);
    pool = await sql.connect(config);
    console.log("Connected.\\n");

    // Create table if not exists
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='FinYear' AND xtype='U')
      CREATE TABLE dbo.FinYear (
        FId INT IDENTITY(1,1) PRIMARY KEY,
        FName NVARCHAR(50),
        FStartDate DATE,
        FEndDate DATE,
        FStatus BIT DEFAULT 0,
        FisLocked BIT DEFAULT 0,
        FCreatedBy INT,
        FCreatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FUpdatedBy INT,
        FUpdatedAt DATETIME2 DEFAULT GETUTCDATE()
      )
    `);
    console.log('✅ FinYear table created/verified');

    const existing = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.FinYear");
    const count = existing.recordset[0].cnt;
    console.log(`dbo.FinYear currently has ${count} row(s).`);

    if (count >= SEED_ROWS.length) {
      console.log("Seed rows already present — skipping.");
      return;
    }

    console.log(`\\nInserting ${SEED_ROWS.length} seed rows...\\n`);

    for (const row of SEED_ROWS) {
      const req = pool.request()
        .input("FName", sql.NVarChar, row.FName)
        .input("FStartDate", sql.Date, row.FStartDate)
        .input("FEndDate", sql.Date, row.FEndDate)
        .input("FStatus", sql.Bit, row.FStatus ? 1 : 0)
        .input("FisLocked", sql.Bit, row.FisLocked ? 1 : 0)
        .input("FCreatedBy", sql.Int, 1)
        .input("FCreatedAt", sql.DateTime2, new Date());

      await req.query(`
        INSERT INTO dbo.FinYear (FName, FStartDate, FEndDate, FStatus, FisLocked, FCreatedBy, FCreatedAt)
        VALUES (@FName, @FStartDate, @FEndDate, @FStatus, @FisLocked, @FCreatedBy, @FCreatedAt)
      `);

      console.log(`  ✓ Inserted ${row.FName}`);
    }

    console.log("\\n✅ FinYear seed complete. Restart backend if running.");
  } catch (err) {
    console.error("\\n❌ Seed failed:", err.message);
    console.error("Likely table dbo.FinYear missing - create it first.");
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

seed();

