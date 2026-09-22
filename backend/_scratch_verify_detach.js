const { connectDB, getPool, sql } = require("./db");
(async () => {
  await connectDB();
  const pool = getPool();

  const rc = await pool.request().query(`
    SELECT COUNT(*) AS c FROM dbo.AccountHeadMaster WHERE LHeadCode LIKE 'CRMCUST-%' AND LHeadType = 'RC'
  `);
  const remainingA = await pool.request().query(`
    SELECT COUNT(*) AS c FROM dbo.AccountHeadMaster WHERE LHeadCode LIKE 'CRMCUST-%' AND LHeadType = 'A'
  `);
  console.log("CRMCUST rows now type RC:", rc.recordset[0].c);
  console.log("CRMCUST rows still type A (should be 0):", remainingA.recordset[0].c);

  // Simulate the exact CustomerMaster.tsx query (type=A) — CRM rows should be gone.
  const customerMasterList = await pool.request().query(`
    SELECT COUNT(*) AS c FROM dbo.AccountHeadMaster WHERE LHeadType = 'A' AND LHeadCode LIKE 'CRMCUST-%'
  `);
  console.log("CRM rows visible to Customer Master list (should be 0):", customerMasterList.recordset[0].c);

  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
