const { connectDB, getPool } = require("./db");
(async () => {
  await connectDB();
  const pool = getPool();
  const r1 = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.RoleRights");
  const r2 = await pool.request().query("SELECT COUNT(*) AS cnt FROM dbo.UserPageRightsJson");
  const r3 = await pool.request().query("SELECT TOP 3 UserId, RightsJson FROM dbo.UserPageRightsJson WHERE IsActive = 1");
  console.log("RoleRights count:", JSON.stringify(r1.recordset));
  console.log("UserPageRightsJson count:", JSON.stringify(r2.recordset));
  console.log("Sample rows:", JSON.stringify(r3.recordset, null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
