// Read-only diagnostic — no writes. For a given Material Request DocNo,
// prints:
//   - its real dbo.MaterialRequests.Status column
//   - which dbo.ApprovalWorkflows row services/approvalService.js's
//     getWorkflow() matches (the QUOTED match: modules LIKE '%"X"%'),
//     i.e. the workflow that actually governs approve/reject
//   - which dbo.ApprovalWorkflows row routes/approvalWorkflows.js's /trail
//     matches (the LOOSE match: modules LIKE '%X%'), i.e. the workflow the
//     ApprovalStatusChain badge in the UI is built from
//   - both workflows' level counts, if they differ
//   - the full dbo.ApprovalAuditLog trail for the record
//
// Usage: node backend/scripts/diagnoseMrApprovalMismatch.js REQ-2026-00006

const { connectDB, getPool, sql, closeDB } = require("../db");

const docNo = process.argv[2];
if (!docNo) {
  console.error("Usage: node diagnoseMrApprovalMismatch.js <DocNo>");
  process.exit(1);
}

async function main() {
  await connectDB();
  const pool = getPool();

  const mrRes = await pool.request().input("docNo", sql.NVarChar(50), docNo).query(`
    SELECT MRId, DocNo, Status FROM dbo.MaterialRequests WHERE DocNo = @docNo
  `);
  const mr = mrRes.recordset[0];
  if (!mr) {
    console.log(`No MaterialRequests row found for DocNo "${docNo}".`);
    await closeDB();
    return;
  }
  console.log(`MRId ${mr.MRId}  DocNo ${mr.DocNo}  Status (real DB column) = "${mr.Status}"\n`);

  const quotedRes = await pool.request().input("id", sql.NVarChar(100), "MaterialRequests").query(`
    SELECT TOP 1 Id, Name, type, LevelsData, modules, CreatedAt
    FROM dbo.ApprovalWorkflows
    WHERE active = 1 AND modules LIKE '%"' + @id + '"%'
    ORDER BY CreatedAt DESC
  `);
  const looseRes = await pool.request().input("id", sql.NVarChar(100), "MaterialRequests").query(`
    SELECT TOP 1 Id, Name, type, LevelsData, modules, CreatedAt
    FROM dbo.ApprovalWorkflows
    WHERE active = 1 AND modules LIKE '%' + @id + '%'
    ORDER BY CreatedAt DESC
  `);

  const quoted = quotedRes.recordset[0];
  const loose = looseRes.recordset[0];

  function describe(row, label) {
    if (!row) { console.log(`${label}: no match.`); return; }
    let levels = [];
    try { levels = JSON.parse(row.LevelsData || "[]"); } catch {}
    console.log(`${label}: WorkflowId=${row.Id} "${row.Name}" — ${Array.isArray(levels) ? levels.length : "?"} level(s). modules=${row.modules}`);
  }

  describe(quoted, "Real approval engine (quoted match, getWorkflow)");
  describe(loose, "List-badge source (loose match, /trail)         ");

  if (quoted && loose && quoted.Id !== loose.Id) {
    console.log("\n⚠ MISMATCH — the two queries resolved to DIFFERENT workflow rows. The list badge and the real Status can legitimately disagree.");
  } else if (quoted && loose && quoted.Id === loose.Id) {
    console.log("\nSame workflow row both ways — the mismatch (if any) is not caused by this.");
  }

  const auditRes = await pool.request().input("TableName", sql.NVarChar(100), "MaterialRequests").input("RecordId", sql.Int, mr.MRId).query(`
    SELECT Level, Role, ApproverEmail, ActionStatus, Note, ActionAt
    FROM dbo.ApprovalAuditLog
    WHERE TableName = @TableName AND RecordId = @RecordId
    ORDER BY Level ASC, ActionAt ASC
  `);
  console.log(`\nApprovalAuditLog (${auditRes.recordset.length} row(s)):`);
  for (const r of auditRes.recordset) {
    console.log(`  Level ${r.Level}  ${r.ActionStatus}  ${r.ApproverEmail || r.Role || "?"}  ${r.ActionAt?.toISOString?.() ?? r.ActionAt}  ${r.Note || ""}`);
  }

  await closeDB();
}

main().catch((err) => {
  console.error("Diagnostic failed:", err);
  process.exit(1);
});
