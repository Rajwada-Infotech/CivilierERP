/**
 * Deed Process overdue alerts: once a day, for every land still in Deed Process whose timeline (DeedTargetDate)
 * has passed, the verifier who set it and the user who entered the land get a bell (and phone) notification.
 * Runs from the worker; quietly does nothing until migrations 643/644 have run.
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

// Deed Registry Search: each registration office's search still open past its due date (enquiry date + that office's
// time limit) notifies the enquiry's users once a day. Quietly does nothing until migration 657 has run.
async function runDeedSearchOverdueJob() {
  const pool = getPool();
  if (!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalEnquiryOfficeSearch','U') AS t")).recordset[0].t) return 0;
  const due = (await pool.request().query(`
    UPDATE o SET AlertOn = CAST(GETDATE() AS DATE)
    OUTPUT INSERTED.EnquiryId, INSERTED.OfficeType, INSERTED.DueDate
    FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId
    WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected' AND o.Status = N'Pending' AND o.DueDate < CAST(GETDATE() AS DATE)
      AND (o.AlertOn IS NULL OR o.AlertOn < CAST(GETDATE() AS DATE))`)).recordset;
  for (const o of due) {
    const e = (await pool.request().input("id", o.EnquiryId).query("SELECT EnquiryNo, CreatedBy, AssignedUserId FROM dbo.LegalLandEnquiry WHERE EnquiryId = @id")).recordset[0];
    if (!e) continue;
    const days = Math.max(1, Math.round((Date.now() - new Date(o.DueDate).getTime()) / 86_400_000));
    const users = new Set([e.CreatedBy, e.AssignedUserId].filter(Boolean));
    const rec = (await pool.request().input("id", o.EnquiryId).query("SELECT DISTINCT RequestedBy FROM dbo.LegalEnquiryDeedSearch WHERE EnquiryId = @id AND RequestedBy IS NOT NULL")).recordset;
    for (const r of rec) users.add(r.RequestedBy);
    for (const userId of users) {
      await emitNotification(pool, userId, "legal_deed_search_overdue", `Deed search overdue: ${e.EnquiryNo} · ${o.OfficeType}`,
        `${o.OfficeType} search time limit passed ${days} day${days > 1 ? "s" : ""} ago. Open Legal → Deed Registry Search.`, o.EnquiryId, "legal_enquiry", { push: true });
    }
  }
  return due.length;
}

module.exports = { runDeedOverdueJob, runDeedSearchOverdueJob };
