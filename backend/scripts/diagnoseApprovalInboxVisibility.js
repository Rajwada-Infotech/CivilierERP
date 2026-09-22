// Read-only diagnostic: director-role users (Prashant, Parvin, Bikash)
// reported the Approval Inbox showing new JV/MR/PO/etc Pending entries but
// not older ones. isVisibleToViewer() (backend/routes/approvalInbox.js)
// computes each record's "current level" live, on every request, by
// replaying its ApprovalAuditLog against the module's CURRENT
// ApprovalWorkflows config — there's no stored snapshot of what the
// workflow looked like when the record was submitted. If Approval Setup
// was edited after older records already had some approval history, that
// history gets replayed against the new level layout and can land a
// record on a level the viewer isn't named on, or past the last level
// entirely, even though its DB Status is still Pending — silently hiding
// it from every non-admin viewer (admins bypass the whole check, which is
// why nobody noticed sooner).
//
// This script re-derives, per module, exactly what isVisibleToViewer()
// would compute for every currently-Pending record — no data is changed.
//
// Usage:
//   node backend/scripts/diagnoseApprovalInboxVisibility.js
//   node backend/scripts/diagnoseApprovalInboxVisibility.js material-requests purchase-orders

const { connectDB, getPool, closeDB } = require("../db");
const { MODULE_MAP, getWorkflow, resolveCurrentLevel } = require("../services/approvalService");

async function main() {
  const onlyModules = process.argv.slice(2);
  await connectDB();
  const pool = getPool();

  for (const [module, map] of Object.entries(MODULE_MAP)) {
    if (onlyModules.length && !onlyModules.includes(module)) continue;

    let workflow;
    try {
      workflow = await getWorkflow(module);
    } catch (e) {
      console.log(`[${module}] getWorkflow failed: ${e.message}`);
      continue;
    }
    if (!workflow || !workflow.LevelDefs?.length) {
      console.log(`[${module}] no workflow configured — falls back to default approver set.`);
      continue;
    }

    const tableName = map.table.replace("dbo.", "");
    const pk = map.pk;
    const statusCol = map.status;

    let rows;
    try {
      rows = await pool
        .request()
        .query(`SELECT ${pk} AS Id FROM dbo.${tableName} WHERE ${statusCol} = 'Pending'`);
    } catch (e) {
      console.log(`[${module}] query failed: ${e.message}`);
      continue;
    }

    console.log(
      `\n=== ${module}  (dbo.${tableName}, ${rows.recordset.length} Pending) ===`,
    );
    console.log(
      "LevelDefs:",
      JSON.stringify(
        workflow.LevelDefs.map((l, i) => ({
          level: i + 1,
          roles: l.roles,
          userIds: l.userIds,
          mode: l.mode,
        })),
      ),
    );
    if (!rows.recordset.length) continue;

    const totalLevels = workflow.Levels || workflow.LevelDefs.length;
    let stuck = 0;
    let ok = 0;

    for (const r of rows.recordset) {
      const recordId = parseInt(r.Id, 10);
      const currentLevel = await resolveCurrentLevel(
        tableName,
        recordId,
        totalLevels,
        workflow.LevelDefs,
      );

      const marker = await pool
        .request()
        .input("t", tableName)
        .input("id", recordId).query(`
          SELECT COUNT(*) AS markerCount
          FROM dbo.ApprovalAuditLog
          WHERE TableName=@t AND RecordId=@id AND Level=0 AND ActionStatus='Pending'
        `);
      const hasMarker = marker.recordset[0]?.markerCount > 0;

      const audit = await pool
        .request()
        .input("t", tableName)
        .input("id", recordId).query(`
          SELECT Level, ActionStatus, ActionAt, UserId
          FROM dbo.ApprovalAuditLog
          WHERE TableName=@t AND RecordId=@id
          ORDER BY ActionAt
        `);

      if (currentLevel > totalLevels) {
        stuck++;
        console.log(
          `  [STUCK — vanishes for every non-admin viewer] ${module} #${recordId}: ` +
            `resolved level ${currentLevel} > totalLevels ${totalLevels}, hasResubmitMarker=${hasMarker}\n` +
            `    audit=${JSON.stringify(audit.recordset)}`,
        );
      } else {
        ok++;
        const def = workflow.LevelDefs[currentLevel - 1];
        console.log(
          `  [level ${currentLevel}/${totalLevels}] ${module} #${recordId}: ` +
            `named=${JSON.stringify({ roles: def?.roles, userIds: def?.userIds })}, hasResubmitMarker=${hasMarker}\n` +
            `    audit=${JSON.stringify(audit.recordset)}`,
        );
      }
    }
    console.log(`  Summary: resolves-within-range=${ok}  stuck-past-final-level=${stuck}`);
  }

  await closeDB();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
