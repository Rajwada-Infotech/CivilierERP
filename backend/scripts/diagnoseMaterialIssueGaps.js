// Read-only: checks the two blanks reported on the Material Issue detail
// view (Financial Year, Created By) for ISS-2026-00023 specifically (and
// MaterialIssues overall).
//
// Created By was a real code bug — GET /:id in materialIssues.js joined
// dbo.users on cu.id = mi.CreatedBy, but CreatedBy stores an email string
// (same convention as every other module — see purchaseOrders.js's own
// cu.email join), never a numeric users.id, so the join could never match.
// Already fixed in the route; this just confirms the fix will actually
// resolve names once deployed (i.e. that mi.CreatedBy values DO match a
// real users.email case-insensitively).
//
// Financial Year is checked for whether it's a genuine NULL data gap
// (same class of issue as the one found in MaterialRequests) rather than
// a query/join bug.
//
// Usage: node backend/scripts/diagnoseMaterialIssueGaps.js [--docno=ISS-2026-00023]

const { connectDB, getPool, sql, closeDB } = require("../db");

const docNoArg = process.argv.find((a) => a.startsWith("--docno="));
const DOC_NO = docNoArg ? docNoArg.split("=")[1] : "ISS-2026-00023";

async function main() {
  await connectDB();
  const pool = getPool();

  const rowRes = await pool.request().input("docNo", sql.NVarChar(100), DOC_NO).query(`
    SELECT IssueId, DocNo, FinYearId, CreatedBy FROM dbo.MaterialIssues WHERE DocNo = @docNo
  `);
  if (!rowRes.recordset.length) {
    console.log(`No MaterialIssues row with DocNo "${DOC_NO}".`);
  } else {
    const row = rowRes.recordset[0];
    console.log(`${DOC_NO}: IssueId=${row.IssueId} FinYearId=${row.FinYearId === null ? "NULL" : row.FinYearId} CreatedBy="${row.CreatedBy}"`);

    if (row.CreatedBy) {
      const userRes = await pool.request().input("email", sql.NVarChar(200), row.CreatedBy).query(`
        SELECT id, name, email FROM dbo.users WHERE LOWER(email) = LOWER(@email)
      `);
      console.log(userRes.recordset.length
        ? `  CreatedBy matches dbo.users: id ${userRes.recordset[0].id}, name "${userRes.recordset[0].name}" — the join fix will resolve this.`
        : `  CreatedBy "${row.CreatedBy}" does NOT match any dbo.users.email — will still show blank even after the join fix (stale/deleted user reference).`);
    }
  }

  const nullFyRes = await pool.request().query(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN FinYearId IS NULL THEN 1 ELSE 0 END) AS nullCount
    FROM dbo.MaterialIssues
  `);
  console.log(`\nOverall: ${nullFyRes.recordset[0].nullCount} of ${nullFyRes.recordset[0].total} Material Issues have a NULL FinYearId.`);

  const badCreatedByRes = await pool.request().query(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN u.id IS NULL THEN 1 ELSE 0 END) AS unmatched
    FROM dbo.MaterialIssues mi
    LEFT JOIN dbo.users u ON LOWER(u.email) = LOWER(mi.CreatedBy)
  `);
  console.log(`Overall: ${badCreatedByRes.recordset[0].unmatched} of ${badCreatedByRes.recordset[0].total} Material Issues have a CreatedBy that doesn't match any user's email.`);

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
