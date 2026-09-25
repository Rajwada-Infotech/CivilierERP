// One-off: give Prashant view/print/export on Balance Sheet + Profit & Loss by
// merging into his per-user rights JSON. Same effect as migration 481, for
// running directly on a server without a deploy.
//   node scripts/grantPrashantBsPl.js            (dry run)
//   node scripts/grantPrashantBsPl.js --apply
const { connectDB, getPool, sql } = require("../db");

const PAGES = ["balance-sheet", "profit-and-loss"];
const GRANT = ["view", "print", "export"];

(async () => {
  const apply = process.argv.includes("--apply");
  await connectDB();
  const pool = getPool();
  const users = (await pool.request().query(
    "SELECT id, name, email FROM dbo.Users WHERE name LIKE N'Prashant%' AND ISNULL(discontinue,0)=0",
  )).recordset;
  if (users.length !== 1) {
    console.log("Need exactly 1 active Prashant, found:", users);
    process.exit(1);
  }
  const u = users[0];
  const row = (await pool.request().input("id", sql.Int, u.id)
    .query("SELECT RightsJson FROM dbo.UserPageRightsJson WHERE UserId=@id AND IsActive=1")).recordset[0];
  const rights = row ? JSON.parse(row.RightsJson) : [];
  for (const page of PAGES) {
    const existing = rights.find((r) => r.page === page);
    const merged = [...new Set([...(existing?.actions || []), ...GRANT])];
    if (existing) existing.actions = merged; else rights.push({ page, actions: merged });
  }
  console.log(`User ${u.id} ${u.name} <${u.email}> ->`, JSON.stringify(rights.filter((r) => PAGES.includes(r.page))));
  if (!apply) { console.log("Dry run. Re-run with --apply to write."); process.exit(0); }
  const json = JSON.stringify(rights);
  const req = pool.request().input("id", sql.Int, u.id).input("j", sql.NVarChar(sql.MAX), json);
  if (row) await req.query("UPDATE dbo.UserPageRightsJson SET RightsJson=@j, UpdatedAt=GETDATE() WHERE UserId=@id AND IsActive=1");
  else await req.query("INSERT INTO dbo.UserPageRightsJson (UserId, RightsJson, IsActive) VALUES (@id,@j,1)");
  console.log("Applied.");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
