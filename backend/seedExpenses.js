/**
 * seedExpenses.js
 * Run once to insert test ExpenseBooking rows into the Civilier DB.
 * Usage:  node backend/seedExpenses.js
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
  { EProjectName: "Prestige Heights",      EDocumentType: "Invoice", EDocDate: "2024-01-10", EAmount: 45000.00,   EDocNo: "INV-1001", EStatus: "Pending",  ECompanyId: 1 },
  { EProjectName: "Green Valley Phase 2",  EDocumentType: "Invoice", EDocDate: "2024-01-15", EAmount: 120500.00,  EDocNo: "INV-1002", EStatus: "Approved", ECompanyId: 1 },
  { EProjectName: "Prestige Heights",      EDocumentType: "Bill",    EDocDate: "2024-02-01", EAmount: 285000.00,  EDocNo: "INV-1003", EStatus: "Pending",  ECompanyId: 1 },
  { EProjectName: "Riverside Residency",   EDocumentType: "Invoice", EDocDate: "2024-02-10", EAmount: 67250.00,   EDocNo: "INV-1004", EStatus: "Approved", ECompanyId: 1 },
  { EProjectName: "Green Valley Phase 2",  EDocumentType: "Bill",    EDocDate: "2024-02-20", EAmount: 98750.00,   EDocNo: "INV-1005", EStatus: "Pending",  ECompanyId: 1 },
  { EProjectName: "Metro Commercial Hub",  EDocumentType: "Invoice", EDocDate: "2024-03-05", EAmount: 55000.00,   EDocNo: "INV-1006", EStatus: "Approved", ECompanyId: 1 },
  { EProjectName: "Prestige Heights",      EDocumentType: "Bill",    EDocDate: "2024-03-12", EAmount: 35000.00,   EDocNo: "INV-1007", EStatus: "Pending",  ECompanyId: 1 },
  { EProjectName: "Riverside Residency",   EDocumentType: "Invoice", EDocDate: "2024-03-18", EAmount: 42000.00,   EDocNo: "INV-1008", EStatus: "Approved", ECompanyId: 1 },
];

async function seed() {
  let pool;
  try {
    console.log("Connecting to:", process.env.DB_SERVER, "/", process.env.DB_NAME);
    pool = await sql.connect(config);
    console.log("Connected.\n");

    // Check how many rows already exist
    const existing = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.ExpenseBooking");
    const count = existing.recordset[0].cnt;
    console.log(`dbo.ExpenseBooking currently has ${count} row(s).`);

    if (count >= SEED_ROWS.length) {
      console.log("Seed rows already present — skipping insert.");
      console.log("Run this SQL to reset if needed:");
      console.log("  DELETE FROM dbo.DebitNote;");
      console.log("  DELETE FROM dbo.ExpenseBooking;");
      return;
    }

    console.log(`\nInserting ${SEED_ROWS.length} seed rows...\n`);

    for (const row of SEED_ROWS) {
      const req = pool.request()
        .input("EProjectName",  sql.NVarChar(150), row.EProjectName)
        .input("EDocumentType", sql.NVarChar(50),  row.EDocumentType)
        .input("EDocDate",      sql.Date,          row.EDocDate)
        .input("EAmount",       sql.Decimal(18,2), row.EAmount)
        .input("EDocNo",        sql.NVarChar(50),  row.EDocNo)
        .input("EEmiPayment",   sql.Bit,           0)
        .input("EReminder",     sql.Date,          null)
        .input("ERemarks",      sql.NVarChar(300), null)
        .input("EStatus",       sql.NVarChar(50),  row.EStatus)
        .input("ECreatedAt",    sql.DateTime2,     new Date())
        .input("EUpdatedAt",    sql.DateTime2,     new Date())
        .input("ECreatedBy",    sql.Int,           1)
        .input("EApprovedBy",   sql.Int,           null)
        .input("ECompanyId",    sql.Int,           row.ECompanyId);

      const result = await req.query(`
        INSERT INTO dbo.ExpenseBooking
          (EProjectName, EDocumentType, EDocDate, EAmount, EDocNo,
           EEmiPayment, EReminder, ERemarks, EStatus,
           ECreatedAt, EUpdatedAt, ECreatedBy, EApprovedBy, ECompanyId)
        VALUES
          (@EProjectName, @EDocumentType, @EDocDate, @EAmount, @EDocNo,
           @EEmiPayment, @EReminder, @ERemarks, @EStatus,
           @ECreatedAt, @EUpdatedAt, @ECreatedBy, @EApprovedBy, @ECompanyId);
        SELECT SCOPE_IDENTITY() AS Eid;
      `);

      const newId = result.recordset[0]?.Eid;
      console.log(`  ✓ Inserted ${row.EDocNo} — ${row.EProjectName}  →  Eid = ${newId}`);
    }

    console.log("\n✅ Seed complete. Restart your backend and the bill dropdown will populate.");

  } catch (err) {
    console.error("\n❌ Seed failed:", err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.close();
  }
}

seed();
