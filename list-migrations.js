require("dotenv").config();
const sql = require("mssql");
(async () => {
  const pool = await sql.connect({
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, port: Number(process.env.DB_PORT||1433),
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true }
  });
  const r = await pool.request().query("SELECT * FROM __Migrations ORDER BY 1");
  console.log(JSON.stringify(r.recordset, null, 2));
  await pool.close();
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
