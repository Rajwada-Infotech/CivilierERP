// Read-only: is the CRM booking approval chain (Review -> Marketing Head ->
// Director -> Confirmed, migration 308 + Approval Setup) in place on this
// database? Changes nothing.
//   node scripts/checkCrmApprovalSetup.js
const { connectDB, getPool, closeDB } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();
  const q = async (s) => (await pool.request().query(s)).recordset;
  const show = (title, rows) => { console.log(`\n== ${title}`); console.table(rows); };

  show("Migrations applied (308 = two-level booking approval)",
    await q(`SELECT name FROM dbo.__Migrations WHERE name LIKE '%308%' OR name LIKE '%two-level%' OR name LIKE '%approval%' ORDER BY name`));

  show("Approval workflows (all, incl. inactive)",
    await q(`SELECT Id, Name, active, Status, Levels, modules, LEFT(LevelsData, 400) AS LevelsData FROM dbo.ApprovalWorkflows ORDER BY Id`));

  show("CrmBooking approval columns present",
    await q(`SELECT c.name FROM sys.columns c WHERE c.object_id = OBJECT_ID('dbo.CrmBooking')
             AND c.name IN ('WorkflowStage','StageRemarks','RejectedFromStage','MarketingHeadApprovedAt','DirectorApprovedAt','ConfirmedAt','ReadyForApprovalAt')`));

  show("Approval tables present",
    await q(`SELECT name FROM sys.tables WHERE name IN ('CrmBookingStageLog','ApprovalAuditLog','ApprovalWorkflows','CrmApplicationVerificationChecklist')`));

  // Who the crm-bookings workflow names, read from its own LevelsData.
  const wf = (await q(`SELECT TOP 1 LevelsData FROM dbo.ApprovalWorkflows WHERE active = 1 AND modules LIKE '%"crm-bookings"%'`))[0];
  const levels = wf ? JSON.parse(wf.LevelsData || "[]") : [];
  const rows = [];
  for (const [i, lv] of levels.entries()) {
    const ids = (lv.userIds || []).map(Number).filter(Number.isFinite);
    const users = ids.length
      ? await q(`SELECT u.id, u.name, ro.RName AS RoleName FROM dbo.Users u LEFT JOIN dbo.Role ro ON ro.RId = u.RoleId WHERE u.id IN (${ids.join(",")})`)
      : [];
    rows.push({ Level: i + 1, Label: lv.label, Roles: (lv.roles || []).join(", ") || "—",
      NamedUsers: ids.map((id) => { const u = users.find((x) => x.id === id); return u ? `${id} ${u.name} (${u.RoleName ?? "no role"})` : `${id} NOT FOUND`; }).join("; ") || "—" });
  }
  show("crm-bookings approvers by level", rows);

  show("Users per approver role",
    await q(`SELECT ro.RName, COUNT(u.id) AS Users FROM dbo.Role ro LEFT JOIN dbo.Users u ON u.RoleId = ro.RId
             WHERE LOWER(ro.RName) IN ('director','marketing_head','admin','super_admin') GROUP BY ro.RName`));

  show("Submitted applications with no live booking (should be 0)",
    await q(`SELECT COUNT(*) AS Cnt FROM dbo.CrmApplication a
             WHERE a.IsActive = 1 AND a.Status = 'Pending' AND a.PreferredUnitId IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking b WHERE b.ApplicationId = a.Id AND b.IsActive = 1
                               AND b.Status NOT IN ('Cancelled','Rejected','Expired','Transferred'))`));

  const hasStage = (await q(`SELECT COL_LENGTH('dbo.CrmBooking','WorkflowStage') AS L`))[0].L != null;
  show("Bookings by status / stage",
    await q(`SELECT Status, ${hasStage ? "WorkflowStage" : "'(no column)' AS WorkflowStage"}, COUNT(*) AS Cnt
             FROM dbo.CrmBooking WHERE IsActive = 1 GROUP BY Status${hasStage ? ", WorkflowStage" : ""} ORDER BY Status`));

  show("Latest 10 bookings",
    await q(`SELECT TOP 10 Id, BookingNo, Status, ${hasStage ? "WorkflowStage," : ""} CreatedAt FROM dbo.CrmBooking ORDER BY Id DESC`));

  await closeDB();
})().catch(async (e) => { console.error("FAILED:", e.message); try { await closeDB(); } catch (_) {} process.exit(1); });
