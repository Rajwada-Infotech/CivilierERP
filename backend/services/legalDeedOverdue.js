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

// Post-registration tasks (mutation, tax, survey …) still open past their due date notify the assigned user (else whoever
// last updated the task) once a day (migration 712).
async function runPostRegOverdueJob() {
  const pool = getPool();
  if (!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalPostRegTask','AlertOn') AS c")).recordset[0].c) return 0;
  const due = (await pool.request().query(`
    UPDATE t SET AlertOn = CAST(GETDATE() AS DATE)
    OUTPUT INSERTED.TaskId, INSERTED.LandId, INSERTED.Task, INSERTED.DueDate, INSERTED.AssignedUserId, INSERTED.UpdatedBy
    FROM dbo.LegalPostRegTask t JOIN dbo.LegalLand l ON l.LandId = t.LandId AND l.IsActive = 1
    WHERE t.Status NOT IN (N'Completed', N'Rejected') AND t.DueDate < CAST(GETDATE() AS DATE)
      AND (t.AlertOn IS NULL OR t.AlertOn < CAST(GETDATE() AS DATE))`)).recordset;
  for (const t of due) {
    const l = (await pool.request().input("id", t.LandId).query("SELECT LandCode FROM dbo.LegalLand WHERE LandId = @id")).recordset[0];
    const days = Math.max(1, Math.round((Date.now() - new Date(t.DueDate).getTime()) / 86_400_000));
    const userId = t.AssignedUserId || t.UpdatedBy;
    if (userId) await emitNotification(pool, userId, "legal_postreg_overdue", `Overdue: ${t.Task} · ${l?.LandCode ?? ""}`,
      `Due ${days} day${days > 1 ? "s" : ""} ago. Open Legal → Post-registration.`, t.LandId, "legal_land", { push: true });
  }
  return due.length;
}

// Deed Registry Search: an office's search due within 2 days reminds the enquiry's users once (migration 713).
async function runDeedSearchDueSoonJob() {
  const pool = getPool();
  if (!(await pool.request().query("SELECT COL_LENGTH('dbo.LegalEnquiryOfficeSearch','DueSoonAlertOn') AS c")).recordset[0].c) return 0;
  const due = (await pool.request().query(`
    UPDATE o SET DueSoonAlertOn = CAST(GETDATE() AS DATE)
    OUTPUT INSERTED.EnquiryId, INSERTED.OfficeType, INSERTED.DueDate
    FROM dbo.LegalEnquiryOfficeSearch o JOIN dbo.LegalLandEnquiry e ON e.EnquiryId = o.EnquiryId
    WHERE e.IsActive = 1 AND e.LandId IS NULL AND e.EnquiryStatus <> N'Rejected' AND o.Status = N'Pending' AND o.DueSoonAlertOn IS NULL
      AND o.DueDate >= CAST(GETDATE() AS DATE) AND o.DueDate <= DATEADD(DAY, 2, CAST(GETDATE() AS DATE))`)).recordset;
  for (const o of due) {
    const e = (await pool.request().input("id", o.EnquiryId).query("SELECT EnquiryNo, CreatedBy, AssignedUserId FROM dbo.LegalLandEnquiry WHERE EnquiryId = @id")).recordset[0];
    if (!e) continue;
    for (const userId of new Set([e.CreatedBy, e.AssignedUserId].filter(Boolean))) {
      await emitNotification(pool, userId, "legal_deed_search_due", `Deed search due soon: ${e.EnquiryNo} · ${o.OfficeType}`,
        `Due ${new Date(o.DueDate).toISOString().slice(0, 10)}. Open Legal → Deed search.`, o.EnquiryId, "legal_enquiry", { push: true });
    }
  }
  return due.length;
}

/**
 * Legal verification activities: the assignee is reminded on the reminder days set in Setup (LegalActivityReminderRule,
 * e.g. 7 / 3 / 1 days before and on the due date), then daily once overdue. LegalActivityReminderLog stops repeats.
 */
async function runActivityDueJob() {
  const pool = getPool();
  if (!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalActivityReminderLog','U') AS t")).recordset[0].t) return 0;
  const rows = (await pool.request().query(`
    SELECT a.ActivityId, a.ActivityNo, a.ActivityName, a.AssignedUserId, a.DueDate, a.VerificationId, v.VerificationNo, v.LeadUserId, a.EscalatedOn,
           ISNULL(t.EscalateAfterDays, 3) AS EscalateAfterDays,
           DATEDIFF(DAY, CAST(GETDATE() AS DATE), a.DueDate) AS DaysLeft
    FROM dbo.LegalVerificationActivity a JOIN dbo.LegalActivityTemplate t ON t.TemplateId = a.TemplateId
    JOIN dbo.LegalVerification v ON v.VerificationId = a.VerificationId AND v.Status NOT IN (N'Closed', N'Verified', N'Rejected')
    WHERE a.AssignedUserId IS NOT NULL AND a.DueDate IS NOT NULL AND a.Status NOT IN (N'Submitted for Review', N'Closed', N'On Hold')
      AND (a.DueDate < CAST(GETDATE() AS DATE)
           OR DATEDIFF(DAY, CAST(GETDATE() AS DATE), a.DueDate) IN (SELECT DaysBefore FROM dbo.LegalActivityReminderRule WHERE IsActive = 1))`)).recordset;
  let sent = 0;
  for (const r of rows) {
    const kind = r.DaysLeft < 0 ? "overdue" : `D${r.DaysLeft}`;
    const done = (await pool.request().input("A", r.ActivityId).input("D", r.DueDate).input("K", kind).query(`
      SELECT 1 AS x FROM dbo.LegalActivityReminderLog WHERE ActivityId = @A AND DueDate = @D AND Kind = @K
        AND (@K <> 'overdue' OR SentOn = CAST(GETDATE() AS DATE))`)).recordset.length;
    if (done) continue;
    const due = new Date(r.DueDate).toISOString().slice(0, 10);
    const title = r.DaysLeft < 0 ? `Overdue ${-r.DaysLeft} day${r.DaysLeft === -1 ? "" : "s"}: ${r.ActivityName}` : r.DaysLeft === 0 ? `Due today: ${r.ActivityName}` : `Due in ${r.DaysLeft} day${r.DaysLeft === 1 ? "" : "s"}: ${r.ActivityName}`;
    await emitNotification(pool, r.AssignedUserId, r.DaysLeft < 0 ? "legal_activity_overdue" : "legal_activity_due", title,
      `${r.VerificationNo} · ${r.ActivityNo}. ${r.ActivityName} · due ${due}. Open Legal → My tasks.`, r.VerificationId, "legal_verification", { push: true }).catch(() => {});
    await pool.request().input("A", r.ActivityId).input("D", r.DueDate).input("K", kind)
      .query("INSERT INTO dbo.LegalActivityReminderLog (ActivityId, DueDate, Kind) VALUES (@A, @D, @K)");
    sent++;
    // Escalation: overdue for EscalateAfterDays (Setup → Verification Activities) → the lead and Legal Admins, once per due date.
    if (r.DaysLeft < 0 && -r.DaysLeft >= r.EscalateAfterDays && !r.EscalatedOn) {
      const { notify } = require("./legalNotify");
      await notify(pool, { users: [r.LeadUserId], roles: ["Legal Admin"], except: r.AssignedUserId, type: "legal_activity_escalated",
        title: `Escalated — overdue ${-r.DaysLeft} days: ${r.ActivityName}`, body: `${r.VerificationNo} · due ${due}. Reassign or follow up.`, refId: r.VerificationId, refType: "legal_verification" });
      await pool.request().input("A", r.ActivityId).query("UPDATE dbo.LegalVerificationActivity SET EscalatedOn = CAST(GETDATE() AS DATE) WHERE ActivityId = @A");
    }
  }
  return sent;
}

module.exports = { runDeedOverdueJob, runDeedSearchOverdueJob, runPostRegOverdueJob, runDeedSearchDueSoonJob, runActivityDueJob };
