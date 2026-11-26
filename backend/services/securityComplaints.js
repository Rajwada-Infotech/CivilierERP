"use strict";

/**
 * Residents' complaints about security guards (Civilier Security app). Table: migration 717 (dbo.SecurityComplaint).
 *
 *   complaintOptions   the resident's flats, the gates of their projects, the guards posted there (names only) and
 *                      their recent visitor requests, for the form
 *   raiseComplaint     a resident files one; the security admins are pushed
 *   myComplaints       the resident's own, with the admin's status and note
 *   listComplaints     security admins: the complaints in their projects (open first)
 *   reviewComplaint    a security admin moves it on (IN_REVIEW / RESOLVED / DISMISSED) with a note; the resident is told
 */
const { sql } = require("../db");
const { projectPredicate, projectAllowed } = require("./projectScope");
const { sendToUsers, sendToTokens, isExpoPushToken } = require("./pushNotifications");
const { toCustomers } = require("./securitySocket");

const APP_KEY = "security-intercom";
const CATEGORIES = {
  RUDE: "Rude or abusive",
  ABSENT: "Not at the gate",
  SLEEPING: "Sleeping on duty",
  LET_IN_WITHOUT_APPROVAL: "Let someone in without approval",
  DENIED_WRONGLY: "Turned away my visitor wrongly",
  SLOW: "Slow to respond",
  OTHER: "Something else",
};
const STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const clean = (v, max) => String(v ?? "").trim().slice(0, max);

async function complaintOptions(pool, customerId) {
  const flats = (
    await pool.request().input("c", sql.Int, customerId).query(`
      SELECT r.ResidentId AS residentId, r.ProjectId AS projectId, ISNULL(e.name, N'') AS projectName, NULLIF(r.Block, N'') AS block, r.FlatNo AS flat
      FROM dbo.SecurityResident r LEFT JOIN dbo.enterprise e ON e.id = r.ProjectId
      WHERE r.CustomerId = @c AND r.IsActive = 1 ORDER BY r.IsPrimary DESC, r.ResidentId`)
  ).recordset;
  const projects = [...new Set(flats.map((f) => f.projectId))];
  if (!projects.length) return { flats: [], gates: [], guards: [], visits: [], categories: CATEGORIES };
  const inProjects = projectPredicate(projects, "g.ProjectId");
  const [gates, guards, visits] = await Promise.all([
    pool.request().query(`SELECT g.GateId AS id, g.Name AS name, g.ProjectId AS projectId FROM dbo.SecurityGate g WHERE g.IsActive = 1 ${inProjects} ORDER BY g.Name`),
    // Guards posted at these gates in the last 60 days: names only.
    pool.request().query(`
      SELECT DISTINCT u.id AS id, u.name AS name
      FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId JOIN dbo.users u ON u.id = a.GuardUserId
      WHERE (a.EffectiveTo IS NULL OR a.EffectiveTo >= DATEADD(DAY, -60, SYSUTCDATETIME())) ${inProjects}
      ORDER BY u.name`),
    pool.request().input("c", sql.Int, customerId).query(`
      SELECT TOP 15 v.RequestId AS id, v.RequestedAt AS requestedAt, v.VisitorName AS visitorName, v.Reason AS reason, v.Status AS status,
             g.Name AS gateName, v.GuardUserId AS guardUserId, NULLIF(v.Block, N'') AS block, v.FlatNo AS flat
      FROM dbo.SecurityVisitorRequest v JOIN dbo.SecurityGate g ON g.GateId = v.GateId
      WHERE EXISTS (SELECT 1 FROM dbo.SecurityResident r WHERE r.CustomerId = @c AND r.IsActive = 1 AND r.ProjectId = v.ProjectId AND r.Block = v.Block AND r.FlatNo = v.FlatNo)
      ORDER BY v.RequestedAt DESC`),
  ]);
  return { flats, gates: gates.recordset, guards: guards.recordset, visits: visits.recordset, categories: CATEGORIES };
}

async function raiseComplaint(pool, customerId, body = {}) {
  const opts = await complaintOptions(pool, customerId);
  const flat = opts.flats.find((f) => f.residentId === Number(body.residentId)) || opts.flats[0];
  if (!flat) throw fail(404, "You have no flat registered for the Security app.");
  const category = String(body.category || "");
  if (!CATEGORIES[category]) throw fail(400, "Choose what the complaint is about.");
  const description = clean(body.description, 1000);
  if (description.length < 10) throw fail(400, "Describe what happened (at least a sentence).");
  const guardUserId = body.guardUserId ? Number(body.guardUserId) : null;
  if (guardUserId && !opts.guards.some((g) => g.id === guardUserId)) throw fail(400, "That guard isn't posted at your project.");
  const gateId = body.gateId ? Number(body.gateId) : null;
  if (gateId && !opts.gates.some((g) => g.id === gateId)) throw fail(400, "That gate isn't at your project.");
  const requestId = body.requestId ? Number(body.requestId) : null;
  const visit = requestId ? opts.visits.find((v) => v.id === requestId) : null;
  if (requestId && !visit) throw fail(400, "That visitor request isn't one of your flat's.");
  const incidentAt = body.incidentAt ? new Date(body.incidentAt) : null;
  if (incidentAt && (Number.isNaN(incidentAt.getTime()) || incidentAt > new Date(Date.now() + 5 * 60000))) throw fail(400, "The time of the incident isn't valid.");

  const id = (
    await pool.request().input("p", sql.Int, flat.projectId).input("c", sql.Int, customerId).input("b", sql.NVarChar(50), flat.block || "")
      .input("f", sql.NVarChar(50), flat.flat).input("g", sql.Int, guardUserId ?? visit?.guardUserId ?? null).input("gate", sql.Int, gateId)
      .input("r", sql.Int, requestId).input("cat", sql.NVarChar(30), category).input("d", sql.NVarChar(1000), description)
      .input("at", sql.DateTime2, incidentAt ?? (visit ? new Date(visit.requestedAt) : null)).query(`
        INSERT INTO dbo.SecurityComplaint (ProjectId, CustomerId, Block, FlatNo, GuardUserId, GateId, RequestId, Category, Description, IncidentAt)
        OUTPUT INSERTED.ComplaintId AS id VALUES (@p, @c, @b, @f, @g, @gate, @r, @cat, @d, @at)`)
  ).recordset[0].id;

  // The security admins hear of it: live in their app (user:<id>) and by push.
  void require("./securityTracking")
    .securityAdminIds(pool)
    .then((ids) => {
      try {
        const io = require("../socket").getIo();
        for (const uid of ids) io?.to(`user:${uid}`).emit("security:complaint", { complaintId: id, status: "OPEN" });
      } catch {
        /* no socket server */
      }
      return sendToUsers(ids, { title: `Complaint: ${CATEGORIES[category]}`, body: `Flat ${flat.block ? `${flat.block}-` : ""}${flat.flat} · ${description.slice(0, 120)}`, data: { type: "security-complaint", complaintId: id } }, { apps: [APP_KEY] });
    })
    .catch(() => {});
  try {
    require("../socket").getIo()?.to("security-live").emit("security:live", { complaintId: id });
  } catch {
    /* no socket server */
  }
  return { id };
}

const COMPLAINT_SELECT = `
  SELECT c.ComplaintId AS id, c.Category AS category, c.Description AS description, c.IncidentAt AS incidentAt, c.Status AS status,
         c.AdminNote AS adminNote, c.HandledAt AS handledAt, c.CreatedAt AS createdAt, NULLIF(c.Block, N'') AS block, c.FlatNo AS flat,
         c.GuardUserId AS guardUserId, gu.name AS guardName, g.Name AS gateName, c.RequestId AS requestId, hu.name AS handledBy,
         cu.CustomerName AS residentName, cu.Mobile AS residentMobile, ISNULL(e.name, N'') AS projectName
  FROM dbo.SecurityComplaint c
  LEFT JOIN dbo.users gu ON gu.id = c.GuardUserId
  LEFT JOIN dbo.users hu ON hu.id = c.HandledByUserId
  LEFT JOIN dbo.SecurityGate g ON g.GateId = c.GateId
  LEFT JOIN dbo.CrmCustomer cu ON cu.Id = c.CustomerId
  LEFT JOIN dbo.enterprise e ON e.id = c.ProjectId`;

async function myComplaints(pool, customerId) {
  const rows = (await pool.request().input("c", sql.Int, customerId).query(`${COMPLAINT_SELECT} WHERE c.CustomerId = @c ORDER BY c.CreatedAt DESC`)).recordset;
  // The resident doesn't need their own phone number back.
  return rows.map(({ residentMobile: _m, residentName: _n, ...r }) => ({ ...r, categoryLabel: CATEGORIES[r.category] ?? r.category }));
}

async function listComplaints(pool, projectScope, { status = null } = {}) {
  const rows = (
    await pool.request().input("s", sql.NVarChar(12), STATUSES.includes(status) ? status : null).query(`
      ${COMPLAINT_SELECT}
      WHERE (@s IS NULL OR c.Status = @s) ${projectPredicate(projectScope, "c.ProjectId")}
      ORDER BY CASE c.Status WHEN N'OPEN' THEN 0 WHEN N'IN_REVIEW' THEN 1 ELSE 2 END, c.CreatedAt DESC`)
  ).recordset;
  return rows.map((r) => ({ ...r, categoryLabel: CATEGORIES[r.category] ?? r.category }));
}

async function reviewComplaint(pool, projectScope, adminUserId, complaintId, body = {}) {
  const status = String(body.status || "");
  if (!["IN_REVIEW", "RESOLVED", "DISMISSED", "OPEN"].includes(status)) throw fail(400, "Choose the new status.");
  const note = clean(body.adminNote, 1000);
  if ((status === "RESOLVED" || status === "DISMISSED") && note.length < 5) throw fail(400, "Write a short note for the resident when you close a complaint.");
  const cur = (await pool.request().input("id", sql.Int, complaintId).query(`SELECT ProjectId, CustomerId FROM dbo.SecurityComplaint WHERE ComplaintId = @id`)).recordset[0];
  if (!cur || !projectAllowed(projectScope, cur.ProjectId)) throw fail(404, "Complaint not found.");
  await pool.request().input("id", sql.Int, complaintId).input("s", sql.NVarChar(12), status).input("n", sql.NVarChar(1000), note || null).input("u", sql.Int, adminUserId).query(`
    UPDATE dbo.SecurityComplaint SET Status = @s, AdminNote = ISNULL(@n, AdminNote), HandledByUserId = @u, HandledAt = SYSUTCDATETIME() WHERE ComplaintId = @id`);

  // The resident is told (live and by push).
  const label = { OPEN: "reopened", IN_REVIEW: "being looked into", RESOLVED: "resolved", DISMISSED: "closed" }[status];
  toCustomers([cur.CustomerId], "security:complaint", { complaintId, status });
  try {
    const r = await pool.request().input("c", sql.Int, cur.CustomerId).input("app", sql.NVarChar(50), APP_KEY).query(`
      SELECT DISTINCT t.Token FROM dbo.PushDeviceToken t JOIN dbo.CrmCustomerPortalUser pu ON pu.Id = t.PortalUserId
      WHERE pu.IsActive = 1 AND pu.CustomerId = @c AND t.AppKey = @app`);
    void sendToTokens(r.recordset.map((x) => x.Token).filter(isExpoPushToken), {
      title: `Your complaint is ${label}`,
      body: note || "Open the app to see the details.",
      data: { type: "security-complaint", complaintId },
    });
  } catch {
    /* the app shows it next time */
  }
  return { success: true };
}

module.exports = { CATEGORIES, complaintOptions, raiseComplaint, myComplaints, listComplaints, reviewComplaint };
