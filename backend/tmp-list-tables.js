"use strict";

require("./config/env").loadEnv();
const sql = require("mssql");

(async () => {
  const pool = await sql.connect({
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 1433),
    options: { encrypt: false, trustServerCertificate: true },
  });

  const result = await pool.request().query(`
    SELECT s.name + '.' + t.name AS name
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    ORDER BY 1
  `);

  console.log(result.recordset.map((row) => row.name).join("\n"));
  await pool.close();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
