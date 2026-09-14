require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const sql = require('mssql');
const cfg = {
  server: process.env.DB_SERVER, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true },
  connectionTimeout: 15000, requestTimeout: 30000,
};
async function main() {
  const pool = await sql.connect(cfg);

  // Step 1: Add column if absent
  const colExists = await pool.request().query(`
    SELECT 1 AS x FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CrmCoApplicant' AND COLUMN_NAME = 'ApplicationId'
  `);
  if (!colExists.recordset.length) {
    await pool.request().query(`
      ALTER TABLE dbo.CrmCoApplicant
        ADD ApplicationId INT NULL REFERENCES dbo.CrmApplication(Id)
    `);
    console.log('  Column added.');
  } else {
    console.log('  Column already exists — skipping ALTER TABLE.');
  }

  // Step 2: Add index if absent
  const idxExists = await pool.request().query(`
    SELECT 1 AS x FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant')
      AND name = 'IX_CrmCoApplicant_Application'
  `);
  if (!idxExists.recordset.length) {
    await pool.request().query(`
      CREATE INDEX IX_CrmCoApplicant_Application
        ON dbo.CrmCoApplicant(ApplicationId)
        WHERE ApplicationId IS NOT NULL
    `);
    console.log('  Index created.');
  } else {
    console.log('  Index already exists — skipping CREATE INDEX.');
  }

  // Step 3: Verify
  const col = await pool.request().query(`
    SELECT COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'CrmCoApplicant' AND COLUMN_NAME = 'ApplicationId'
  `);
  const idx = await pool.request().query(`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.CrmCoApplicant') AND name = 'IX_CrmCoApplicant_Application'
  `);

  if (col.recordset.length && idx.recordset.length) {
    console.log(`✅ Migration 256 CONFIRMED — ApplicationId nullable=${col.recordset[0].IS_NULLABLE}, index present`);
  } else {
    console.error('❌ Verification failed'); process.exit(1);
  }

  await pool.close();
}
main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
