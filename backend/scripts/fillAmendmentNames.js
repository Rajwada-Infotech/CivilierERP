// Engineering amendments (BOQ, Work Order, Work Done) were recorded without a project or company name, so the
// Amendment page showed those columns blank. recordAmendment now looks the names up itself; this fills the old rows
// from each document's own project and company.
//   node scripts/fillAmendmentNames.js           dry run - lists them, changes nothing
//   node scripts/fillAmendmentNames.js --apply   fills the names in
const { connectDB, getPool, closeDB } = require("../db");

const apply = process.argv.includes("--apply");

const SOURCES = `
  SELECT 'boq' AS RefDocType, BoqID AS DocId, ProjectId, CompanyId FROM dbo.BOQ
  UNION ALL SELECT 'work-order', Id, ProjectId, CompanyId FROM dbo.WorkOrderHeader
  UNION ALL SELECT 'work-done', ID, ProjectId, CompanyId FROM dbo.WorkDone`;

(async () => {
  await connectDB();
  const pool = getPool();
  const rows = (
    await pool.request().query(`
      SELECT a.Id, a.RefDocType, a.RefDocNo, pr.name AS ProjectName, co.name AS CompanyName
      FROM dbo.Amendments a
      JOIN (${SOURCES}) d ON d.RefDocType = a.RefDocType AND d.DocId = a.RefDocId
      LEFT JOIN dbo.enterprise pr ON pr.id = d.ProjectId
      LEFT JOIN dbo.enterprise co ON co.id = d.CompanyId
      WHERE a.IsDeleted = 0 AND (a.ProjectName IS NULL OR a.CompanyName IS NULL)
        AND (pr.name IS NOT NULL OR co.name IS NOT NULL)
      ORDER BY a.Id`)
  ).recordset;

  if (!rows.length) {
    console.log("OK   every engineering amendment has its project and company");
    await closeDB?.();
    process.exit(0);
  }
  for (const r of rows) console.log(`FILL #${r.Id} ${r.RefDocType} ${r.RefDocNo || ""}: ${r.ProjectName || "—"} / ${r.CompanyName || "—"}`);
  console.log(`${rows.length} amendment(s)`);
  if (!apply) {
    console.log("Dry run - nothing changed. Run again with --apply to fill them in.");
    await closeDB?.();
    process.exit(0);
  }

  const result = await pool.request().query(`
    UPDATE a SET
      ProjectName = COALESCE(a.ProjectName, pr.name),
      CompanyName = COALESCE(a.CompanyName, co.name)
    FROM dbo.Amendments a
    JOIN (${SOURCES}) d ON d.RefDocType = a.RefDocType AND d.DocId = a.RefDocId
    LEFT JOIN dbo.enterprise pr ON pr.id = d.ProjectId
    LEFT JOIN dbo.enterprise co ON co.id = d.CompanyId
    WHERE a.IsDeleted = 0 AND (a.ProjectName IS NULL OR a.CompanyName IS NULL)`);
  console.log(`Done - ${result.rowsAffected[0]} filled in.`);
  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
