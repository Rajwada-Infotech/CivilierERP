// Read-only: checks whether recent MaterialRequests rows actually have a
// FinYearId stored — reported bug is "the fin year aint fetching" when
// editing a Material Request. The frontend's edit-populate code
// (handleEdit in src/pages/material/MaterialRequest.tsx) sets
// finYearId: String(full.FinYearId ?? "") directly from GET /:id's
// response, so an empty Financial Year field on edit means either the
// column is genuinely NULL on that row, or the dropdown's own option list
// (GET /fin-years) came back empty/mismatched — this checks both.
//
// Usage: node backend/scripts/diagnoseMRFinYear.js [--id=1234]

const { connectDB, getPool, sql, closeDB } = require("../db");

const idArg = process.argv.find((a) => a.startsWith("--id="));
const ID = idArg ? parseInt(idArg.split("=")[1], 10) : null;

async function main() {
  await connectDB();
  const pool = getPool();

  const finYearsRes = await pool.request().query(`
    SELECT FId AS id, FName AS name, FStartDate AS startDate, FEndDate AS endDate,
           FStatus AS isActive, FisLocked AS isLocked
    FROM dbo.FinYear ORDER BY FStartDate DESC
  `);
  console.log(`dbo.FinYear rows (what GET /fin-years returns): ${finYearsRes.recordset.length}`);
  finYearsRes.recordset.forEach((f) =>
    console.log(`  id ${f.id} — "${f.name}" isActive=${JSON.stringify(f.isActive)} (${typeof f.isActive}) isLocked=${f.isLocked}`),
  );

  if (ID) {
    const mrRes = await pool.request().input("id", sql.Int, ID).query(`
      SELECT MRId, DocNo, Status, FinYearId FROM dbo.MaterialRequests WHERE MRId = @id
    `);
    console.log(`\nMR ${ID}:`, mrRes.recordset[0] || "(not found)");
  } else {
    const recentRes = await pool.request().query(`
      SELECT TOP 15 MRId, DocNo, Status, FinYearId FROM dbo.MaterialRequests ORDER BY MRId DESC
    `);
    console.log(`\nMost recent 15 Material Requests:`);
    recentRes.recordset.forEach((r) =>
      console.log(`  MRId ${r.MRId} | ${r.DocNo} | Status=${r.Status} | FinYearId=${r.FinYearId === null ? "NULL" : r.FinYearId}`),
    );
    const nullCountRes = await pool.request().query(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN FinYearId IS NULL THEN 1 ELSE 0 END) AS nullCount
      FROM dbo.MaterialRequests
    `);
    console.log(`\nOverall: ${nullCountRes.recordset[0].nullCount} of ${nullCountRes.recordset[0].total} Material Requests have a NULL FinYearId.`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
