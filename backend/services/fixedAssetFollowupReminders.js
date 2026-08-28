/**
 * Follow-up reminder engine for the Fixed Asset "Owner & Quality Checking"
 * page. Mirrors services/crmSlaEngine.js: runs on a schedule (and on demand
 * via POST /api/fixed-asset-quality-check/run-reminders), scanning
 * dbo.FixedAssetQualityCheck for Pending follow-ups whose NextFollowUpDate
 * has arrived or passed, and pushes a notification to the Responsible User
 * through the shared dbo.SaNotification pipeline (the notification bell).
 *
 * De-dup: dbo.FixedAssetFollowUpReminderLog gets one row per quality-check
 * per calendar day, so a follow-up notifies once when it first becomes due
 * and then at most once a day while it stays overdue + Pending — never
 * twice the same day, and it stops entirely once the follow-up is marked
 * Completed or Cancelled.
 */
const { getPool, sql } = require("../db");
const { emitNotification } = require("./notify");
const logger = require("../logger");

const INTERVAL_MS = 60 * 60 * 1000; // hourly

async function runFollowupReminderCheck() {
  const pool = getPool();

  const due = await pool.request().query(`
    SELECT
      q.QualityCheckId, q.DocNo, q.AssetId, q.FAItemCode, q.ItemName,
      q.NextFollowUpDate, q.FollowUpType,
      -- Always notify the CURRENT assignment's Responsible User (so a transfer
      -- that changes the assignment re-routes future reminders automatically);
      -- fall back to the value snapshotted on the check.
      COALESCE((
        SELECT TOP 1 a.ResponsibleUserId
        FROM dbo.FixedAssetAssignment a
        WHERE a.AssetId = q.AssetId AND a.Status <> 'Deleted' AND a.ResponsibleUserId IS NOT NULL
        ORDER BY a.DocDate DESC, a.CreatedAt DESC, a.AssignmentId DESC
      ), q.ResponsibleUserId) AS ResponsibleUserId,
      DATEDIFF(DAY, q.NextFollowUpDate, CAST(SYSDATETIME() AS DATE)) AS DaysOverdue
    FROM dbo.FixedAssetQualityCheck q
    WHERE q.Status = 'Active'
      AND q.FollowUpStatus = 'Pending'
      AND q.NextFollowUpDate <= CAST(SYSDATETIME() AS DATE)
      AND NOT EXISTS (
        SELECT 1 FROM dbo.FixedAssetFollowUpReminderLog l
        WHERE l.QualityCheckId = q.QualityCheckId
          AND CAST(l.SentAt AS DATE) = CAST(SYSDATETIME() AS DATE)
      )
  `);

  let notified = 0;
  for (const row of due.recordset) {
    const overdue = row.DaysOverdue > 0;
    const kind = overdue ? "overdue" : "due";
    const label = `${row.FAItemCode || row.ItemName || "Asset"}`;
    const when = new Date(row.NextFollowUpDate).toLocaleDateString("en-IN");

    if (row.ResponsibleUserId) {
      const title = overdue ? "Asset Follow-Up Overdue" : "Asset Follow-Up Due Today";
      const body = overdue
        ? `${label} — ${row.FollowUpType || "follow-up"} was due ${when} (${row.DaysOverdue} day(s) overdue). ${row.DocNo || ""}`.trim()
        : `${label} — ${row.FollowUpType || "follow-up"} is scheduled for today (${when}). ${row.DocNo || ""}`.trim();
      await emitNotification(
        pool, row.ResponsibleUserId,
        overdue ? "fa_followup_overdue" : "fa_followup_due",
        title, body, row.QualityCheckId, "fixed_asset_quality_check",
      );
      notified++;
    }

    // Always log — even with no responsible user — so an unassigned overdue
    // follow-up is scanned once a day, not every single run.
    await pool.request()
      .input("QC", sql.Int, row.QualityCheckId)
      .input("Kind", sql.NVarChar(20), kind)
      .input("U", sql.Int, row.ResponsibleUserId || null)
      .query(`
        INSERT INTO dbo.FixedAssetFollowUpReminderLog (QualityCheckId, Kind, NotifiedUserId, SentAt)
        VALUES (@QC, @Kind, @U, SYSDATETIME())
      `);
  }

  return { scanned: due.recordset.length, notified };
}

let timer = null;
function startFollowupReminderEngine() {
  const run = () => {
    runFollowupReminderCheck()
      .then((s) => {
        if (s.scanned === 0) return;
        logger.info({ event: "FA_FOLLOWUP_REMINDER_DONE", ...s }, "Fixed Asset follow-up reminder check complete");
      })
      .catch((e) => logger.error({ event: "FA_FOLLOWUP_REMINDER_FAILED", err: e.message }, "Fixed Asset follow-up reminder check failed"));
  };
  run();
  timer = setInterval(run, INTERVAL_MS);
}
function stopFollowupReminderEngine() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runFollowupReminderCheck, startFollowupReminderEngine, stopFollowupReminderEngine };
