// Read-only inspection — dumps exactly what a revert/new-GL-head migration
// needs to know before it runs anywhere: Sundry Debtors/Creditors' real
// Code (SDS/SCS should be stable, but confirm), and the CURRENT LIABILITIES
// root's exact Name/Code (needed to hang the new "Advance from Customers"
// group off the right parent) — plus a live count of how many LHeadType='A'
// heads currently sit under Creditors vs Debtors, so you know exactly what
// the revert migration (423) would move on this environment before running it.
//
// Usage: node scripts/inspectSundryAndCurrentLiabilities.js
const { connectDB, getPool, closeDB } = require("../db");

async function main() {
  await connectDB();
  const pool = getPool();

  const groups = await pool.request().query(`
    SELECT AGId, Name, Code, ParentGroupId
    FROM dbo.AccountGroup
    WHERE Code IN ('SDS', 'SCS', 'CL', 'OCL') OR Name LIKE '%CURRENT LIAB%' OR Name LIKE '%DEBTOR%' OR Name LIKE '%CREDITOR%'
    ORDER BY ParentGroupId, Name
  `);
  console.log("── Relevant AccountGroup rows ──────────────────────────────");
  console.table(groups.recordset);

  const counts = await pool.request().query(`
    SELECT ag.Name AS GroupName, ag.Code, COUNT(*) AS CustomerHeadCount
    FROM dbo.AccountHeadMaster ahm
    JOIN dbo.AccountGroup ag ON ag.AGId = ahm.LBelongsTo
    WHERE ahm.LHeadType = 'A'
    GROUP BY ag.Name, ag.Code
  `);
  console.log("\n── Current LHeadType='A' (Customer Master) head distribution ──");
  console.table(counts.recordset);

  const advGroup = await pool.request().query(`
    SELECT AGId, Name, Code, ParentGroupId FROM dbo.AccountGroup
    WHERE Name LIKE '%Advance%Customer%' OR Code = 'ADVC'
  `);
  console.log("\n── Existing 'Advance from Customers' group (should be empty on a fresh environment) ──");
  console.table(advGroup.recordset);

  await closeDB();
}

main().catch((err) => {
  console.error("Inspection failed:", err.message);
  process.exit(1);
});
