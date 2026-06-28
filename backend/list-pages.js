const { connectDB, getPool } = require("./db");
(async () => {
  await connectDB();
  const pool = getPool();
  const r = await pool.request().query("SELECT UserId, RightsJson FROM dbo.UserPageRightsJson WHERE IsActive = 1");
  const pages = new Set();
  for (const row of r.recordset) {
    try {
      const parsed = JSON.parse(row.RightsJson || "[]");
      parsed.forEach(p => pages.add(p.page));
    } catch {}
  }
  console.log(JSON.stringify([...pages].sort(), null, 2));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
