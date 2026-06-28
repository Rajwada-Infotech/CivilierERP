require("dotenv").config();
const sql = require("mssql");
(async () => {
  const pool = await sql.connect({
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, port: Number(process.env.DB_PORT||1433),
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
  });
  const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%migrat%' OR TABLE_NAME LIKE '%umzug%' OR TABLE_NAME LIKE '%SequelizeMeta%'");
  console.log("Candidate migration tables:", JSON.stringify(tables.recordset));
  await pool.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
