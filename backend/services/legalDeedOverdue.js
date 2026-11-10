/**
 * Deed Process overdue alerts: once a day, for every land still in Deed Process whose timeline (DeedTargetDate)
 * has passed, the verifier who set it and the user who entered the land get a bell (and phone) notification.
 * Runs from the worker; quietly does nothing until migrations 633/634 have run.
 */
const { getPool } = require("../db");
const { emitNotification } = require("./notify");

async function runDeedOverdueJob() {
  const pool = getPool();
  const ready = (await pool.request().query(
    "SELECT COL_LENGTH('dbo.LegalLand', 'DeedTargetDate') AS a, COL_LENGTH('dbo.LegalLand', 'DeedOverdueAlertOn') AS b")).recordset[0];
  if (!ready.a || !ready.b) return 0;
  const due = (await pool.request().query(`
    UPDATE dbo.LegalLand SET DeedOverdueAlertOn = CAST(GETDATE() AS DATE)
    OUTPUT INSERTED.LandId, INSERTED.LandCode, INSERTED.LandName, INSERTED.DeedTargetDate, INSERTED.FinalVerifiedBy, INSERTED.CreatedBy
    WHERE IsActive = 1 AND WorkflowStatus = N'Deed Process' AND DeedTargetDate < CAST(GETDATE() AS DATE)
      AND (DeedOverdueAlertOn IS NULL OR DeedOverdueAlertOn < CAST(GETDATE() AS DATE))`)).recordset;
  for (const l of due) {
    const days = Math.max(1, Math.round((Date.now() - new Date(l.DeedTargetDate).getTime()) / 86_400_000));
    const title = `Deed overdue: ${l.LandCode}`;
    const body = `${l.LandName} — deed timeline passed ${days} day${days > 1 ? "s" : ""} ago. Open Legal → Deed Process.`;
    for (const userId of new Set([l.FinalVerifiedBy, l.CreatedBy].filter(Boolean))) {
      await emitNotification(pool, userId, "legal_deed_overdue", title, body, l.LandId, "legal_land", { push: true });
    }
  }
  return due.length;
}

module.exports = { runDeedOverdueJob };
