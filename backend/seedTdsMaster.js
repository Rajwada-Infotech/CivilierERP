/**
 * seedTdsMaster.js
 * Run to insert test TDSMaster rows.
 * Usage: cd backend && node seedTdsMaster.js
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
  { Nature: 'Salary', Name: 'Salary TDS', Percentage: 10.0 },
  { Nature: 'Professional', Name: 'Professional Services', Percentage: 2.0 },
  { Nature: 'Contract', Name: 'Contractor', Percentage: 1.0 },
  { Nature: 'Rent', Name: 'Rent', Percentage: 10.0 },
];

async function seed() {
  let pool;
  try {
    console.log("Connecting to:", process.env.DB_SERVER, "/", process.env.DB_NAME);
    pool = await sql.connect(config);
    console.log("Connected.\\n");

    // Create table if not exists
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='TDSMaster' AND xtype='U')
      CREATE TABLE dbo.TDSMaster (
        TDSId INT IDENTITY(1,1) PRIMARY KEY,
        Nature NVARCHAR(50),
        Name NVARCHAR(100),
        Percentage DECIMAL(5,2),
        Status BIT DEFAULT 1,
        CreatedAt DATETIME DEFAULT GETUTCDATE(),
        UpdatedAt DATETIME DEFAULT GETUTCDATE()
      )
    `);
    console.log('✅ TDSMaster table created/verified');

    const existing = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.TDSMaster");
    const count = existing.recordset[0].cnt;
    console.log(`dbo.TDSMaster currently has ${count} row(s).`);

    if (count >= SEED_ROWS.length) {
      console.log("Seed rows already present — skipping.");
      return;
    }

    console.log(`\\nInserting ${SEED_ROWS.length} seed rows...\\n`);

    for (const row of SEED_ROWS) {
      const req = pool.request()
        .input("Nature", sql.NVarChar, row.Nature)
        .input("Name", sql.NVarChar, row.Name)
        .input("Percentage", sql.Decimal(5,2), row.Percentage)
        .input("Status", sql.Bit, 1)
        .input("CreatedAt", sql.DateTime, new Date());

      await req.query(`
        INSERT INTO dbo.TDSMaster (Nature, Name, Percentage, Status, CreatedAt)
        VALUES (@Nature, @Name, @Percentage, @Status, @CreatedAt)
      `);

      console.log(`  ✓ Inserted ${row.Name} (${row.Percentage}%)`);
    }

    console.log("\\n✅ TDSMaster seed complete. Restart backend if running.");
  } catch (err) {
    console.error("\\n❌ Seed failed:", err.message);
    console.error("Likely table dbo.TDSMaster missing - create it first.");
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

seed();

