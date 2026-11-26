"use strict";

/**
 * backend/routes/securityIntercom.js: the Civilier Security app's staff side, mounted at /api/security (staff login).
 * Residents use routes/securityPortal.js with their customer-portal account instead.
 *
 *   GET  /dashboard?view=<guard|admin>              the app's home for a Guard / Security Super Admin (by role NAME)
 *
 * Visitor approval (the app):
 *   GET  /flats?q=                       guard: flats with residents at the guard's gate's project (no names)
 *   POST /visitors                       guard: { clientRequestId, block, flatNo, reason, visitorName?, visitorPhone?,
 *                                        vehicleNo?, photoBase64? } (same clientRequestId again = the same request)
 *   GET  /visitors/:id                   guard of that gate / who raised it, or a security admin in scope
 *   GET  /visitors/:id/photo             same people
 *   GET  /visitors/:id/contacts          the guard: the flat's residents and their numbers, to call them
 *   POST /visitors/:id/no-response       the guard closes a request nobody answered
 *
 * Tracking (doc phase 3):
 *   POST /pings                          guard's phone: { pings: [{ at, lat, lng, accuracy?, battery? }] } -> { stored, onShift }
 *   (guard)             GET /patrols/current   POST /patrols/start   POST /patrols/end     patrol rounds
 *   security-live       GET /live  GET /guards/tracked  GET /guards/:id/trail?from&to  GET /alerts?open=1
 *                       POST /alerts/:id/acknowledge  GET /visitor-log?from&to&gateId&status&q&page
 *   security-geofences  GET /geofences  POST /geofences/preview  POST /geofences  PUT /geofences/:id  DELETE /geofences/:id
 *
 * Calls (LiveKit) and guest passes:
 *   GET  /calls/available                  { inApp } — whether in-app calling is set up
 *   POST /calls                            guard -> resident: { requestId, customerId }
 *   GET  /calls/incoming                   a call ringing for me now
 *   GET  /calls/:id   POST /calls/:id/answer | /decline | /end
 *   GET  /passes/expected                  guard: guest passes valid now at the guard's project
 *   DELETE /gates/:id (unused only)   DELETE /guard-assignments/:id
 *   security-live       GET /complaints?status   PUT /complaints/:id { status, adminNote }   (residents' complaints about guards)
 *
 * Web admin (Maintenance), each behind its own page right:
 *   security-gates      GET /gates  POST /gates  PUT /gates/:id
 *   security-guards     GET /guard-options  GET /guard-assignments  POST /guard-assignments  PUT /guard-assignments/:id
 *   security-residents  GET /residents  GET /residents/customers?q=  POST /residents  PUT /residents/:id
 *                       GET /residents/:id/audit  POST /residents/sync { projectId? }
 * Every list and write is limited to the user's project scope.
 */

const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { requirePageRight } = require("../middleware/requirePageRight");
const { projectPredicate, projectAllowed } = require("../services/projectScope");
const { viewOf, guardDashboard, adminDashboard, guardAssignmentNow } = require("../services/securityDashboard");
const visitors = require("../services/securityVisitors");
const tracking = require("../services/securityTracking");
const calls = require("../services/securityCalls");
const h3 = require("h3-js");
const { syncSecurityResidents } = require("../services/securityResidentSync");

const me = (req) => Number(req.user?.userId) || null;
const bad = (res, error, code = 400) => res.status(code).json({ error });
const int = (v) => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v, max) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : "";
};
const coord = (v, lim) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : undefined;
};
const ymd = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const fail = (req, res, err, what) => {
  if (err.number === 208) return bad(res, "Security isn't set up on this server yet (migration 715 hasn't run).", 503);
  if (err.number === 2627 || err.number === 2601) return bad(res, `That ${what} already exists.`, 409);
  req.log?.error?.({ err }, `security ${what} failed`);
  return bad(res, `The ${what} could not be saved.`, 500);
};

// ── App dashboard (guard / security admin) ──────────────────────────────────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  const mine = viewOf(req.user?.role);
  if (!me(req) || !mine || mine === "customer") return bad(res, "This account has no security role.", 403);
  const asked = req.query.view ? String(req.query.view) : mine;
  if (asked !== mine) return bad(res, "That view is for another role.", 403);
  try {
    const pool = getPool();
    return res.json(mine === "guard" ? await guardDashboard(pool, me(req)) : await adminDashboard(pool, req.projectScope ?? null));
  } catch (err) {
    if (err.number === 208) return bad(res, "Security isn't set up on this server yet.", 404);
    req.log?.error?.({ err }, "security dashboard failed");
    return bad(res, "The security dashboard could not be read.", 500);
  }
});

/** The projects (enterprise rows of type P) this user may manage, for the pages' project pickers. */
async function projectOptions(pool, scope) {
  return (await pool.request().query(`SELECT e.id AS id, e.name AS name FROM dbo.enterprise e WHERE e.business_type = 'P' ${projectPredicate(scope, "e.id")} ORDER BY e.name`)).recordset;
}

// ── Gates ───────────────────────────────────────────────────────────────────────────────────────────────────────
router.get("/gates", requirePageRight("security-gates", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const gates = (
      await pool.request().query(`
        SELECT g.GateId AS id, g.ProjectId AS projectId, ISNULL(e.name, N'') AS projectName, g.Name AS name,
               g.Latitude AS latitude, g.Longitude AS longitude, g.IsActive AS isActive, g.NoResponsePolicy AS noResponsePolicy,
               (SELECT COUNT(*) FROM dbo.SecurityGuardAssignment a WHERE a.GateId = g.GateId AND a.IsActive = 1
                  AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CONVERT(date, DATEADD(MINUTE, 330, SYSUTCDATETIME())))) AS guards
        FROM dbo.SecurityGate g LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
        WHERE 1 = 1 ${projectPredicate(req.projectScope, "g.ProjectId")}
        ORDER BY e.name, g.Name`)
    ).recordset;
    res.json({ gates, projects: await projectOptions(pool, req.projectScope) });
  } catch (err) {
    fail(req, res, err, "gate list");
  }
});

function gateBody(req, res) {
  const b = req.body || {};
  const projectId = int(b.projectId);
  const name = text(b.name, 100);
  const latitude = coord(b.latitude, 90);
  const longitude = coord(b.longitude, 180);
  if (!projectId) return bad(res, "Choose the project.");
  if (!name) return bad(res, "Enter the gate's name.");
  if (latitude === undefined || longitude === undefined) return bad(res, "Latitude must be between -90 and 90, longitude between -180 and 180.");
  if ((latitude == null) !== (longitude == null)) return bad(res, "Enter both latitude and longitude, or neither.");
  if (!projectAllowed(req.projectScope, projectId)) return bad(res, "That project isn't in your project access.", 403);
  const policy = ["HOLD", "ALLOW", "CALL_OFFICE"].includes(b.noResponsePolicy) ? b.noResponsePolicy : "HOLD";
  return { projectId, name, latitude, longitude, policy, isActive: b.isActive === undefined ? true : !!b.isActive };
}

router.post("/gates", requirePageRight("security-gates", "create"), async (req, res) => {
  const g = gateBody(req, res);
  if (!g || res.headersSent) return;
  try {
    const r = await getPool().request().input("p", sql.Int, g.projectId).input("n", sql.NVarChar(100), g.name)
      .input("la", sql.Decimal(9, 6), g.latitude).input("lo", sql.Decimal(9, 6), g.longitude).input("pol", sql.NVarChar(12), g.policy).input("u", sql.Int, me(req)).query(`
        IF EXISTS (SELECT 1 FROM dbo.SecurityGate WHERE ProjectId = @p AND Name = @n) THROW 51000, N'dup', 1;
        INSERT INTO dbo.SecurityGate (ProjectId, Name, Latitude, Longitude, NoResponsePolicy, CreatedBy) OUTPUT INSERTED.GateId AS id VALUES (@p, @n, @la, @lo, @pol, @u)`);
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    if (err.number === 51000) return bad(res, "This project already has a gate with that name.", 409);
    fail(req, res, err, "gate");
  }
});

router.put("/gates/:id", requirePageRight("security-gates", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid gate.");
  const g = gateBody(req, res);
  if (!g || res.headersSent) return;
  try {
    const r = await getPool().request().input("id", sql.Int, id).input("p", sql.Int, g.projectId).input("n", sql.NVarChar(100), g.name)
      .input("la", sql.Decimal(9, 6), g.latitude).input("lo", sql.Decimal(9, 6), g.longitude).input("a", sql.Bit, g.isActive).input("pol", sql.NVarChar(12), g.policy).input("u", sql.Int, me(req)).query(`
        IF EXISTS (SELECT 1 FROM dbo.SecurityGate WHERE ProjectId = @p AND Name = @n AND GateId <> @id) THROW 51000, N'dup', 1;
        UPDATE dbo.SecurityGate SET ProjectId = @p, Name = @n, Latitude = @la, Longitude = @lo, IsActive = @a, NoResponsePolicy = @pol, UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME()
        WHERE GateId = @id ${projectPredicate(req.projectScope, "ProjectId")}`);
    if (!r.rowsAffected.some((n) => n > 0)) return bad(res, "Gate not found.", 404);
    res.json({ success: true });
  } catch (err) {
    if (err.number === 51000) return bad(res, "This project already has a gate with that name.", 409);
    fail(req, res, err, "gate");
  }
});

// ── Guard assignments ───────────────────────────────────────────────────────────────────────────────────────────
// Guards are users whose role is named Guard / Security Guard (by name, never by id).
const GUARD_ROLE_SQL = `LOWER(REPLACE(REPLACE(LTRIM(RTRIM(r.RName)), N'-', N' '), N'_', N' ')) IN (N'guard', N'security guard')`;

router.get("/guard-options", requirePageRight("security-guards", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [guards, shifts, gates] = await Promise.all([
      pool.request().query(`
        SELECT u.id AS id, u.name AS name, u.email AS email
        FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE ISNULL(u.discontinue, 0) = 0 AND ${GUARD_ROLE_SQL}
        ORDER BY u.name`),
      pool.request().query(`SELECT Id AS id, Name AS name, StartTime AS startTime, EndTime AS endTime FROM dbo.SecurityShift WHERE Status = N'Active' ORDER BY StartTime`),
      pool.request().query(`
        SELECT g.GateId AS id, g.Name AS name, ISNULL(e.name, N'') AS projectName
        FROM dbo.SecurityGate g LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
        WHERE g.IsActive = 1 ${projectPredicate(req.projectScope, "g.ProjectId")} ORDER BY e.name, g.Name`),
    ]);
    const hhmm = (t) => (t instanceof Date ? t.toISOString().slice(11, 16) : String(t ?? "").slice(0, 5));
    res.json({
      guards: guards.recordset,
      shifts: shifts.recordset.map((s) => ({ id: s.id, name: s.name, startTime: hhmm(s.startTime), endTime: hhmm(s.endTime) })),
      gates: gates.recordset,
    });
  } catch (err) {
    fail(req, res, err, "guard options");
  }
});

router.get("/guard-assignments", requirePageRight("security-guards", "view"), async (req, res) => {
  try {
    const rows = (
      await getPool().request().query(`
        SELECT a.AssignmentId AS id, a.GuardUserId AS guardUserId, u.name AS guardName, a.GateId AS gateId, g.Name AS gateName,
               ISNULL(e.name, N'') AS projectName, a.ShiftId AS shiftId, s.Name AS shiftName,
               CONVERT(char(5), s.StartTime, 108) AS startTime, CONVERT(char(5), s.EndTime, 108) AS endTime,
               CONVERT(char(10), a.EffectiveFrom, 23) AS effectiveFrom, CONVERT(char(10), a.EffectiveTo, 23) AS effectiveTo,
               a.IsActive AS isActive
        FROM dbo.SecurityGuardAssignment a
        JOIN dbo.SecurityGate g ON g.GateId = a.GateId
        JOIN dbo.SecurityShift s ON s.Id = a.ShiftId
        LEFT JOIN dbo.users u ON u.id = a.GuardUserId
        LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
        WHERE 1 = 1 ${projectPredicate(req.projectScope, "g.ProjectId")}
        ORDER BY a.IsActive DESC, u.name, a.EffectiveFrom DESC`)
    ).recordset;
    res.json(rows);
  } catch (err) {
    fail(req, res, err, "guard list");
  }
});

async function assignmentBody(req, res, pool) {
  const b = req.body || {};
  const guardUserId = int(b.guardUserId);
  const gateId = int(b.gateId);
  const shiftId = int(b.shiftId);
  const effectiveFrom = ymd(b.effectiveFrom);
  const effectiveTo = b.effectiveTo ? ymd(b.effectiveTo) : null;
  if (!guardUserId) return bad(res, "Choose the guard.");
  if (!gateId) return bad(res, "Choose the gate.");
  if (!shiftId) return bad(res, "Choose the shift.");
  if (!effectiveFrom) return bad(res, "Enter the date the assignment starts.");
  if (b.effectiveTo && !effectiveTo) return bad(res, "The end date isn't a valid date.");
  if (effectiveTo && effectiveTo < effectiveFrom) return bad(res, "The end date can't be before the start date.");
  const chk = (
    await pool.request().input("u", sql.Int, guardUserId).input("g", sql.Int, gateId).input("s", sql.Int, shiftId).query(`
      SELECT (SELECT COUNT(*) FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId WHERE u.id = @u AND ISNULL(u.discontinue, 0) = 0 AND ${GUARD_ROLE_SQL}) AS guardOk,
             (SELECT TOP 1 ProjectId FROM dbo.SecurityGate WHERE GateId = @g AND IsActive = 1) AS gateProject,
             (SELECT COUNT(*) FROM dbo.SecurityShift WHERE Id = @s AND Status = N'Active') AS shiftOk`)
  ).recordset[0];
  if (!chk.guardOk) return bad(res, "That user isn't an active guard (role Guard or Security Guard).");
  if (chk.gateProject == null) return bad(res, "That gate doesn't exist or is inactive.");
  if (!chk.shiftOk) return bad(res, "That shift doesn't exist or is inactive.");
  if (!projectAllowed(req.projectScope, chk.gateProject)) return bad(res, "That gate's project isn't in your project access.", 403);
  return { guardUserId, gateId, shiftId, effectiveFrom, effectiveTo, isActive: b.isActive === undefined ? true : !!b.isActive };
}

router.post("/guard-assignments", requirePageRight("security-guards", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const a = await assignmentBody(req, res, pool);
    if (!a || res.headersSent) return;
    const r = await pool.request().input("u", sql.Int, a.guardUserId).input("g", sql.Int, a.gateId).input("s", sql.Int, a.shiftId)
      .input("f", sql.Date, a.effectiveFrom).input("t", sql.Date, a.effectiveTo).input("by", sql.Int, me(req)).query(`
        INSERT INTO dbo.SecurityGuardAssignment (GuardUserId, GateId, ShiftId, EffectiveFrom, EffectiveTo, CreatedBy)
        OUTPUT INSERTED.AssignmentId AS id VALUES (@u, @g, @s, @f, @t, @by)`);
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    fail(req, res, err, "guard assignment");
  }
});

router.put("/guard-assignments/:id", requirePageRight("security-guards", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid assignment.");
  try {
    const pool = getPool();
    const a = await assignmentBody(req, res, pool);
    if (!a || res.headersSent) return;
    const r = await pool.request().input("id", sql.Int, id).input("u", sql.Int, a.guardUserId).input("g", sql.Int, a.gateId).input("s", sql.Int, a.shiftId)
      .input("f", sql.Date, a.effectiveFrom).input("t", sql.Date, a.effectiveTo).input("act", sql.Bit, a.isActive).input("by", sql.Int, me(req)).query(`
        UPDATE a SET GuardUserId = @u, GateId = @g, ShiftId = @s, EffectiveFrom = @f, EffectiveTo = @t, IsActive = @act, UpdatedBy = @by, UpdatedAt = SYSUTCDATETIME()
        FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId
        WHERE a.AssignmentId = @id ${projectPredicate(req.projectScope, "g.ProjectId")}`);
    if (!r.rowsAffected.some((n) => n > 0)) return bad(res, "Assignment not found.", 404);
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "guard assignment");
  }
});

// ── Residents ───────────────────────────────────────────────────────────────────────────────────────────────────
router.get("/residents", requirePageRight("security-residents", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const projectId = int(req.query.projectId);
    const rows = (
      await pool.request().input("p", sql.Int, projectId).query(`
        SELECT r.ResidentId AS id, r.CustomerId AS customerId, c.CustomerName AS customerName, c.Mobile AS mobile,
               r.ProjectId AS projectId, ISNULL(e.name, N'') AS projectName, r.Block AS block, r.FlatNo AS flatNo,
               r.IsPrimary AS isPrimary, r.IsActive AS isActive, r.Source AS source, r.BookingId AS bookingId, bk.BookingNo AS bookingNo,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCustomerPortalUser pu WHERE pu.CustomerId = r.CustomerId AND pu.IsActive = 1) THEN 1 ELSE 0 END AS hasPortalLogin,
               r.CreatedAt AS createdAt, r.DeactivatedAt AS deactivatedAt
        FROM dbo.SecurityResident r
        LEFT JOIN dbo.CrmCustomer c ON c.Id = r.CustomerId
        LEFT JOIN dbo.enterprise e ON e.id = r.ProjectId
        LEFT JOIN dbo.CrmBooking bk ON bk.Id = r.BookingId
        WHERE (@p IS NULL OR r.ProjectId = @p) ${projectPredicate(req.projectScope, "r.ProjectId")}
        ORDER BY e.name, r.Block, r.FlatNo, r.IsPrimary DESC, c.CustomerName`)
    ).recordset;
    res.json({ residents: rows.map((r) => ({ ...r, hasPortalLogin: !!r.hasPortalLogin })), projects: await projectOptions(pool, req.projectScope) });
  } catch (err) {
    fail(req, res, err, "resident list");
  }
});

router.get("/residents/customers", requirePageRight("security-residents", "create"), async (req, res) => {
  const q = text(req.query.q, 60);
  if (q.length < 2) return res.json([]);
  try {
    const digits = q.replace(/\D/g, "");
    const rows = (
      await getPool().request().input("q", sql.NVarChar(80), `%${q}%`).input("d", sql.NVarChar(20), digits.length >= 4 ? `%${digits.slice(-10)}%` : null).query(`
        SELECT TOP 20 c.Id AS id, c.CustomerName AS name, c.Mobile AS mobile, c.CustomerNo AS customerNo,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.CrmCustomerPortalUser pu WHERE pu.CustomerId = c.Id AND pu.IsActive = 1) THEN 1 ELSE 0 END AS hasPortalLogin
        FROM dbo.CrmCustomer c
        WHERE c.IsActive = 1 AND (c.CustomerName LIKE @q OR c.CustomerNo LIKE @q OR (@d IS NOT NULL AND c.Mobile LIKE @d))
        ORDER BY c.CustomerName`)
    ).recordset;
    res.json(rows.map((r) => ({ ...r, hasPortalLogin: !!r.hasPortalLogin })));
  } catch (err) {
    fail(req, res, err, "customer search");
  }
});

const residentAudit = (pool, residentId, action, byUserId, detail) =>
  pool.request().input("r", sql.Int, residentId).input("a", sql.NVarChar(20), action).input("u", sql.Int, byUserId).input("d", sql.NVarChar(500), detail)
    .query(`INSERT INTO dbo.SecurityResidentAudit (ResidentId, Action, ByUserId, Source, Detail) VALUES (@r, @a, @u, N'ADMIN', @d)`);

router.post("/residents", requirePageRight("security-residents", "create"), async (req, res) => {
  const b = req.body || {};
  const customerId = int(b.customerId);
  const projectId = int(b.projectId);
  const block = text(b.block, 50);
  const flatNo = text(b.flatNo, 50);
  if (!customerId) return bad(res, "Choose the customer.");
  if (!projectId) return bad(res, "Choose the project.");
  if (!flatNo) return bad(res, "Enter the flat number.");
  if (!projectAllowed(req.projectScope, projectId)) return bad(res, "That project isn't in your project access.", 403);
  try {
    const pool = getPool();
    const c = (await pool.request().input("c", sql.Int, customerId).query(`SELECT COUNT(*) AS n FROM dbo.CrmCustomer WHERE Id = @c AND IsActive = 1`)).recordset[0];
    if (!c.n) return bad(res, "That customer doesn't exist or is inactive.");
    const tx = pool.transaction();
    await tx.begin();
    try {
      const existing = (
        await tx.request().input("c", sql.Int, customerId).input("p", sql.Int, projectId).input("bl", sql.NVarChar(50), block).input("f", sql.NVarChar(50), flatNo)
          .query(`SELECT ResidentId, IsActive FROM dbo.SecurityResident WITH (UPDLOCK, HOLDLOCK) WHERE CustomerId = @c AND ProjectId = @p AND Block = @bl AND FlatNo = @f`)
      ).recordset[0];
      if (existing?.IsActive) {
        await tx.rollback();
        return bad(res, "This customer is already a resident of that flat.", 409);
      }
      let id;
      if (existing) {
        id = existing.ResidentId;
        await tx.request().input("r", sql.Int, id).input("pr", sql.Bit, !!b.isPrimary)
          .query(`UPDATE dbo.SecurityResident SET IsActive = 1, DeactivatedAt = NULL, IsPrimary = @pr, Source = N'ADMIN', UpdatedAt = SYSUTCDATETIME() WHERE ResidentId = @r`);
        await residentAudit(tx, id, "REACTIVATED", me(req), "Added again by an admin");
      } else {
        id = (
          await tx.request().input("c", sql.Int, customerId).input("p", sql.Int, projectId).input("bl", sql.NVarChar(50), block).input("f", sql.NVarChar(50), flatNo).input("pr", sql.Bit, !!b.isPrimary).query(`
            INSERT INTO dbo.SecurityResident (CustomerId, ProjectId, Block, FlatNo, IsPrimary, Source) OUTPUT INSERTED.ResidentId AS id VALUES (@c, @p, @bl, @f, @pr, N'ADMIN')`)
        ).recordset[0].id;
        await residentAudit(tx, id, "ADDED", me(req), text(b.note, 400) || "Added by an admin");
      }
      await tx.commit();
      res.status(201).json({ id });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  } catch (err) {
    fail(req, res, err, "resident");
  }
});

router.put("/residents/:id", requirePageRight("security-residents", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid resident.");
  const b = req.body || {};
  if (b.isActive === undefined && b.isPrimary === undefined) return bad(res, "Nothing to change.");
  try {
    const pool = getPool();
    const cur = (
      await pool.request().input("r", sql.Int, id).query(`SELECT IsActive, IsPrimary FROM dbo.SecurityResident WHERE ResidentId = @r ${projectPredicate(req.projectScope, "ProjectId")}`)
    ).recordset[0];
    if (!cur) return bad(res, "Resident not found.", 404);
    const isActive = b.isActive === undefined ? !!cur.IsActive : !!b.isActive;
    const isPrimary = b.isPrimary === undefined ? !!cur.IsPrimary : !!b.isPrimary;
    await pool.request().input("r", sql.Int, id).input("a", sql.Bit, isActive).input("p", sql.Bit, isPrimary).query(`
      -- An admin's change makes the row the admin's: the CRM sync no longer adds it back or removes it.
      UPDATE dbo.SecurityResident SET IsActive = @a, IsPrimary = @p, Source = N'ADMIN', UpdatedAt = SYSUTCDATETIME(),
        DeactivatedAt = CASE WHEN @a = 0 THEN ISNULL(DeactivatedAt, SYSUTCDATETIME()) ELSE NULL END
      WHERE ResidentId = @r`);
    const action = isActive !== !!cur.IsActive ? (isActive ? "REACTIVATED" : "DEACTIVATED") : "UPDATED";
    await residentAudit(pool, id, action, me(req), text(b.note, 400) || (action === "UPDATED" ? (isPrimary ? "Made primary" : "Made a member") : null));
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "resident");
  }
});

router.get("/residents/:id/audit", requirePageRight("security-residents", "view"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid resident.");
  try {
    const rows = (
      await getPool().request().input("r", sql.Int, id).query(`
        SELECT a.AuditId AS id, a.Action AS action, a.Source AS source, a.Detail AS detail, a.At AS at, u.name AS byName
        FROM dbo.SecurityResidentAudit a
        JOIN dbo.SecurityResident r ON r.ResidentId = a.ResidentId
        LEFT JOIN dbo.users u ON u.id = a.ByUserId
        WHERE a.ResidentId = @r ${projectPredicate(req.projectScope, "r.ProjectId")}
        ORDER BY a.At DESC, a.AuditId DESC`)
    ).recordset;
    res.json(rows);
  } catch (err) {
    fail(req, res, err, "resident history");
  }
});

router.post("/residents/sync", requirePageRight("security-residents", "create"), async (req, res) => {
  const projectId = int(req.body?.projectId);
  // Without a project, a user limited to some projects syncs each of theirs; an unrestricted one syncs everything.
  const projects = projectId ? [projectId] : req.projectScope ? req.projectScope.map(Number) : [null];
  if (projectId && !projectAllowed(req.projectScope, projectId)) return bad(res, "That project isn't in your project access.", 403);
  try {
    const total = { added: 0, reactivated: 0, updated: 0, deactivated: 0 };
    for (const p of projects) {
      const s = await syncSecurityResidents(getPool(), { projectId: p, byUserId: me(req) });
      for (const k of Object.keys(total)) total[k] += s[k];
    }
    res.json(total);
  } catch (err) {
    fail(req, res, err, "resident sync");
  }
});

// ── Visitor approval (the app) ──────────────────────────────────────────────────────────────────────────────────
const isGuard = (req) => viewOf(req.user?.role) === "guard";
const visitorFail = (req, res, err) => {
  if (err.status) return bad(res, err.message, err.status);
  if (err.number === 208) return bad(res, "Security isn't set up on this server yet.", 404);
  req.log?.error?.({ err }, "security visitor request failed");
  return bad(res, "The visitor request could not be handled.", 500);
};

/** May this staff member see the request? Its guard, the guard now posted at its gate, or a security admin in scope. */
async function canSee(req, pool, row) {
  const role = viewOf(req.user?.role);
  if (role === "admin") return projectAllowed(req.projectScope, row.projectId);
  if (role !== "guard") return false;
  if (row.guardUserId === me(req)) return true;
  const cur = await guardAssignmentNow(pool, me(req));
  return !!cur && cur.gateId === row.gateId;
}

async function visitorFor(req, res) {
  const id = int(req.params.id);
  if (!id) {
    bad(res, "Invalid visitor request.");
    return null;
  }
  const pool = getPool();
  const row = (await pool.request().input("id", sql.Int, id).query(`
    SELECT r.RequestId AS id, r.GuardUserId AS guardUserId, r.ProjectId AS projectId, r.GateId AS gateId, r.VisitorPhone AS visitorPhone
    FROM dbo.SecurityVisitorRequest r WHERE r.RequestId = @id`)).recordset[0];
  if (!row || !(await canSee(req, pool, row))) {
    bad(res, "Visitor request not found.", 404);
    return null;
  }
  return { pool, row };
}

router.get("/flats", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard raises visitor requests.", 403);
  try {
    const pool = getPool();
    const cur = await guardAssignmentNow(pool, me(req));
    if (!cur) return res.json({ gate: null, flats: [] });
    const q = text(req.query.q, 40).toLowerCase().replace(/[\s.\-/]+/g, "");
    const rows = (
      await pool.request().input("p", sql.Int, cur.projectId).input("q", sql.NVarChar(60), q ? `%${q}%` : null).query(`
        SELECT TOP 50 r.Block AS block, r.FlatNo AS flatNo, COUNT(*) AS residents
        FROM dbo.SecurityResident r
        WHERE r.ProjectId = @p AND r.IsActive = 1
          AND (@q IS NULL OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(r.Block + r.FlatNo, N' ', N''), N'-', N''), N'.', N''), N'/', N'')) LIKE @q)
        GROUP BY r.Block, r.FlatNo
        ORDER BY r.Block, LEN(r.FlatNo), r.FlatNo`)
    ).recordset;
    res.json({ gate: { name: cur.gateName, projectName: cur.projectName }, flats: rows });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/visitors", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard raises visitor requests.", 403);
  try {
    const out = await visitors.createVisitorRequest(getPool(), me(req), req.body || {});
    res.status(out.created ? 201 : 200).json(out.request);
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/visitors/:id", async (req, res) => {
  try {
    const v = await visitorFor(req, res);
    if (!v) return;
    const request = await visitors.loadRequest(v.pool, v.row.id);
    res.json({ ...request, visitorPhone: v.row.visitorPhone, escalateAfterS: visitors.ESCALATE_S, expireAfterS: visitors.EXPIRE_S });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/visitors/:id/photo", async (req, res) => {
  try {
    const v = await visitorFor(req, res);
    if (!v) return;
    const p = (await v.pool.request().input("id", sql.Int, v.row.id).query(`SELECT ContentType, Data FROM dbo.SecurityVisitorPhoto WHERE RequestId = @id`)).recordset[0];
    if (!p) return bad(res, "No photo.", 404);
    res.set({ "Content-Type": p.ContentType, "Cache-Control": "private, max-age=300" }).send(p.Data);
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/visitors/:id/contacts", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only the guard calls residents.", 403);
  try {
    const v = await visitorFor(req, res);
    if (!v) return;
    const r = await visitors.loadRequest(v.pool, v.row.id);
    const residents = await visitors.residentsOf(v.pool, v.row.projectId, r.block || "", r.flat);
    res.json(residents.map((x) => ({ customerId: x.CustomerId, name: x.name, mobile: x.mobile, isPrimary: !!x.IsPrimary })));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/visitors/:id/no-response", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only the guard closes a visitor request.", 403);
  try {
    const v = await visitorFor(req, res);
    if (!v) return;
    const out = await visitors.markNoResponse(v.pool, me(req), v.row.id);
    res.json(out.request);
  } catch (err) {
    visitorFail(req, res, err);
  }
});

// ── Tracking ────────────────────────────────────────────────────────────────────────────────────────────────────
router.post("/pings", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard's phone sends location.", 403);
  try {
    res.json(await tracking.recordPings(getPool(), me(req), req.body?.pings));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

// ── Patrol rounds (guard): start a round at the guard's gate while on shift, end it when done. The route is the
// guard's location pings between the two times, so shift tracking must be on.
const patrols = require("../services/securityPatrols");

router.get("/patrols/current", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard patrols.", 403);
  try {
    res.json({ patrol: await patrols.currentPatrol(getPool(), me(req)) });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/patrols/start", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard patrols.", 403);
  try {
    const pool = getPool();
    const cur = await guardAssignmentNow(pool, me(req));
    if (!cur?.onDuty) return bad(res, "A patrol can start only during your shift.", 409);
    res.json({ patrol: await patrols.startPatrol(pool, me(req), cur.gateId, cur.projectId) });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/patrols/end", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard patrols.", 403);
  try {
    await patrols.endOpen(getPool(), me(req));
    res.json({ patrol: null });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/live", requirePageRight("security-live", "view"), async (req, res) => {
  try {
    res.json(await tracking.liveView(getPool(), req.projectScope ?? null));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/guards/tracked", requirePageRight("security-live", "view"), async (req, res) => {
  try {
    const rows = (
      await getPool().request().query(`
        SELECT DISTINCT u.id AS id, u.name AS name
        FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId JOIN dbo.users u ON u.id = a.GuardUserId
        WHERE 1 = 1 ${projectPredicate(req.projectScope, "g.ProjectId")} ORDER BY u.name`)
    ).recordset;
    res.json(rows);
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/guards/:id/trail", requirePageRight("security-live", "view"), async (req, res) => {
  const id = int(req.params.id);
  const from = new Date(String(req.query.from || ""));
  const to = new Date(String(req.query.to || ""));
  if (!id || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return bad(res, "Give the guard and a from / to time.");
  if (to - from > 36 * 3600 * 1000) return bad(res, "Replay at most 36 hours at a time.");
  try {
    const pool = getPool();
    // Only a guard posted (at some time) at a gate in the viewer's projects.
    const ok = (
      await pool.request().input("g", sql.Int, id).query(`
        SELECT TOP 1 1 AS x FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId
        WHERE a.GuardUserId = @g ${projectPredicate(req.projectScope, "g.ProjectId")}`)
    ).recordset[0];
    if (!ok) return bad(res, "Guard not found.", 404);
    res.json(await tracking.trailFor(pool, id, from, to));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/alerts", requirePageRight("security-live", "view"), async (req, res) => {
  const openOnly = req.query.open === "1";
  try {
    const rows = (
      await getPool().request().input("o", sql.Bit, openOnly).query(`
        SELECT TOP 200 al.AlertId AS id, al.Type AS type, al.Detail AS detail, al.RaisedAt AS at, al.EscalatedAt AS escalatedAt,
               al.AcknowledgedAt AS acknowledgedAt, au.name AS acknowledgedBy, gu.name AS guardName, z.Name AS zoneName,
               al.RequestId AS requestId, ISNULL(e.name, N'') AS projectName
        FROM dbo.SecurityAlert al
        LEFT JOIN dbo.users gu ON gu.id = al.GuardUserId
        LEFT JOIN dbo.users au ON au.id = al.AcknowledgedByUserId
        LEFT JOIN dbo.SecurityGeofenceZone z ON z.ZoneId = al.ZoneId
        LEFT JOIN dbo.enterprise e ON e.id = al.ProjectId
        WHERE (@o = 0 OR al.AcknowledgedAt IS NULL) ${projectPredicate(req.projectScope, "al.ProjectId")}
        ORDER BY CASE WHEN al.AcknowledgedAt IS NULL THEN 0 ELSE 1 END, al.RaisedAt DESC`)
    ).recordset;
    res.json(rows);
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/alerts/:id/acknowledge", requirePageRight("security-live", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid alert.");
  try {
    const r = await getPool().request().input("id", sql.Int, id).input("u", sql.Int, me(req)).query(`
      UPDATE dbo.SecurityAlert SET AcknowledgedAt = SYSUTCDATETIME(), AcknowledgedByUserId = @u
      WHERE AlertId = @id AND AcknowledgedAt IS NULL ${projectPredicate(req.projectScope, "ProjectId")}`);
    if (!r.rowsAffected[0]) return bad(res, "That alert is already acknowledged.", 409);
    res.json({ success: true });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/visitor-log", requirePageRight("security-live", "view"), async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return bad(res, "Invalid dates.");
  const status = ["PENDING", "APPROVED", "DENIED", "NO_RESPONSE"].includes(String(req.query.status)) ? String(req.query.status) : null;
  const gateId = int(req.query.gateId);
  const q = text(req.query.q, 60);
  const page = Math.max(1, int(req.query.page) || 1);
  // ?export=1: every matching row (5,000 at most) for a CSV, with the page's export right.
  const exporting = req.query.export === "1";
  if (exporting && !(await require("../middleware/requirePageRight").hasAnyPageAction(req, "security-live", ["export"]))) return bad(res, "You don't have the right to export the visitor log.", 403);
  const take = exporting ? 5000 : 50;
  try {
    const where = `r.RequestedAt >= @f AND r.RequestedAt <= @t AND (@s IS NULL OR r.Status = @s) AND (@g IS NULL OR r.GateId = @g)
      AND (@q IS NULL OR r.VisitorName LIKE @q OR r.VehicleNo LIKE @q OR r.VisitorPhone LIKE @q OR r.Reason LIKE @q
           OR (r.Block + N'-' + r.FlatNo) LIKE @q OR r.FlatNo LIKE @q)
      ${projectPredicate(req.projectScope, "r.ProjectId")}`;
    const mk = () =>
      getPool().request().input("f", sql.DateTime2, from).input("t", sql.DateTime2, to).input("s", sql.NVarChar(20), status)
        .input("g", sql.Int, gateId).input("q", sql.NVarChar(80), q ? `%${q}%` : null);
    const [rows, total] = await Promise.all([
      mk().input("off", sql.Int, exporting ? 0 : (page - 1) * 50).input("take", sql.Int, take).query(`
        SELECT r.RequestId AS id, r.RequestedAt AS requestedAt, r.Status AS status, g.Name AS gateName, ISNULL(e.name, N'') AS projectName,
               NULLIF(r.Block, N'') AS block, r.FlatNo AS flat, r.VisitorName AS visitorName, r.VisitorPhone AS visitorPhone,
               r.VehicleNo AS vehicleNo, r.Reason AS reason, r.HasPhoto AS hasPhoto, r.DecidedAt AS decidedAt,
               dc.CustomerName AS decidedBy, gu.name AS guardName, r.NoResponseBy AS noResponseBy
        FROM dbo.SecurityVisitorRequest r
        JOIN dbo.SecurityGate g ON g.GateId = r.GateId
        LEFT JOIN dbo.enterprise e ON e.id = r.ProjectId
        LEFT JOIN dbo.CrmCustomer dc ON dc.Id = r.DecidedByCustomerId
        LEFT JOIN dbo.users gu ON gu.id = r.GuardUserId
        WHERE ${where}
        ORDER BY r.RequestedAt DESC OFFSET @off ROWS FETCH NEXT @take ROWS ONLY`),
      mk().query(`SELECT COUNT(*) AS n FROM dbo.SecurityVisitorRequest r WHERE ${where}`),
    ]);
    res.json({ rows: rows.recordset, total: total.recordset[0].n, page, pageSize: 50 });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

// ── Geofences ───────────────────────────────────────────────────────────────────────────────────────────────────
const H3_RES = [9, 10, 11, 12];
const parseJson = (v) => {
  try {
    return JSON.parse(v || "[]");
  } catch {
    return [];
  }
};

router.get("/geofences", requirePageRight("security-geofences", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [zones, gates] = await Promise.all([
      tracking.zonesInScope(pool, req.projectScope ?? null),
      pool.request().query(`
        SELECT g.GateId AS id, g.Name AS name, g.ProjectId AS projectId, ISNULL(e.name, N'') AS projectName,
               CAST(g.Latitude AS FLOAT) AS latitude, CAST(g.Longitude AS FLOAT) AS longitude
        FROM dbo.SecurityGate g LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
        WHERE g.IsActive = 1 ${projectPredicate(req.projectScope, "g.ProjectId")} ORDER BY e.name, g.Name`),
    ]);
    res.json({
      zones: zones.map((z) => ({
        id: z.ZoneId,
        projectId: z.ProjectId,
        projectName: z.projectName,
        gateId: z.GateId,
        gateName: z.gateName,
        name: z.Name,
        kind: z.Kind,
        resolution: z.H3Resolution,
        allowedDistanceM: z.AllowedDistanceM,
        isActive: !!z.IsActive,
        cells: z.Kind === "H3" ? parseJson(z.H3Cells) : [],
        polygon: z.Kind === "POLYGON" ? parseJson(z.Polygon) : [],
        shapes: tracking.zoneShapes(z),
      })),
      gates: gates.recordset,
      projects: await projectOptions(pool, req.projectScope),
    });
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/geofences/preview", requirePageRight("security-geofences", "view"), (req, res) => {
  const lat = coord(req.body?.lat, 90);
  const lng = coord(req.body?.lng, 180);
  const radius = Math.min(2000, Math.max(5, Number(req.body?.radiusM) || 0));
  const resolution = H3_RES.includes(Number(req.body?.resolution)) ? Number(req.body.resolution) : 11;
  if (lat == null || lng == null) return bad(res, "Give the centre's latitude and longitude.");
  const cells = tracking.cellsAround(lat, lng, radius, resolution);
  if (cells.length > 3000) return bad(res, "That makes too many hexagons. Use bigger hexagons or a smaller radius.");
  res.json({ cells, shapes: cells.map((c) => h3.cellToBoundary(c)) });
});

function zoneBody(req, res) {
  const b = req.body || {};
  const projectId = int(b.projectId);
  const gateId = b.gateId ? int(b.gateId) : null;
  const name = text(b.name, 100);
  const kind = b.kind === "POLYGON" ? "POLYGON" : "H3";
  const allowed = b.allowedDistanceM === "" || b.allowedDistanceM == null ? null : Math.round(Number(b.allowedDistanceM));
  if (!projectId) return bad(res, "Choose the project.");
  if (!name) return bad(res, "Name the zone.");
  if (allowed != null && (!Number.isFinite(allowed) || allowed < 0 || allowed > 500)) return bad(res, "Allowed distance must be 0 to 500 metres.");
  if (!projectAllowed(req.projectScope, projectId)) return bad(res, "That project isn't in your project access.", 403);
  let cells = null;
  let polygon = null;
  let resolution = null;
  if (kind === "H3") {
    cells = Array.isArray(b.cells) ? [...new Set(b.cells.map(String))].filter((c) => h3.isValidCell(c)) : [];
    if (!cells.length) return bad(res, "The zone has no hexagons. Make them around the gate first.");
    if (cells.length > 3000) return bad(res, "Too many hexagons (3,000 at most).");
    resolution = h3.getResolution(cells[0]);
    if (cells.some((c) => h3.getResolution(c) !== resolution)) return bad(res, "All hexagons must be the same size.");
  } else {
    polygon = Array.isArray(b.polygon) ? b.polygon.map((p) => [coord(p?.[0], 90), coord(p?.[1], 180)]).filter((p) => p[0] != null && p[1] != null) : [];
    if (polygon.length < 3) return bad(res, "Draw at least three points.");
    if (polygon.length > 200) return bad(res, "Use 200 points at most.");
  }
  return { projectId, gateId, name, kind, allowed, cells, polygon, resolution, isActive: b.isActive === undefined ? true : !!b.isActive };
}

async function gateInProject(pool, gateId, projectId) {
  if (!gateId) return true;
  return !!(await pool.request().input("g", sql.Int, gateId).input("p", sql.Int, projectId).query(`SELECT 1 AS x FROM dbo.SecurityGate WHERE GateId = @g AND ProjectId = @p`)).recordset[0];
}

const zoneInputs = (r, z) =>
  r.input("p", sql.Int, z.projectId).input("g", sql.Int, z.gateId).input("n", sql.NVarChar(100), z.name).input("k", sql.NVarChar(10), z.kind)
    .input("res", sql.TinyInt, z.resolution).input("c", sql.NVarChar(sql.MAX), z.cells ? JSON.stringify(z.cells) : null)
    .input("poly", sql.NVarChar(sql.MAX), z.polygon ? JSON.stringify(z.polygon) : null).input("a", sql.Int, z.allowed).input("act", sql.Bit, z.isActive);

router.post("/geofences", requirePageRight("security-geofences", "create"), async (req, res) => {
  const z = zoneBody(req, res);
  if (!z || res.headersSent) return;
  try {
    const pool = getPool();
    if (!(await gateInProject(pool, z.gateId, z.projectId))) return bad(res, "That gate isn't in the chosen project.");
    const r = await zoneInputs(pool.request(), z).input("u", sql.Int, me(req)).query(`
      INSERT INTO dbo.SecurityGeofenceZone (ProjectId, GateId, Name, Kind, H3Resolution, H3Cells, Polygon, AllowedDistanceM, CreatedBy)
      OUTPUT INSERTED.ZoneId AS id VALUES (@p, @g, @n, @k, @res, @c, @poly, @a, @u)`);
    res.status(201).json({ id: r.recordset[0].id });
  } catch (err) {
    fail(req, res, err, "zone");
  }
});

router.put("/geofences/:id", requirePageRight("security-geofences", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid zone.");
  const z = zoneBody(req, res);
  if (!z || res.headersSent) return;
  try {
    const pool = getPool();
    if (!(await gateInProject(pool, z.gateId, z.projectId))) return bad(res, "That gate isn't in the chosen project.");
    const r = await zoneInputs(pool.request(), z).input("id", sql.Int, id).input("u", sql.Int, me(req)).query(`
      UPDATE dbo.SecurityGeofenceZone SET ProjectId = @p, GateId = @g, Name = @n, Kind = @k, H3Resolution = @res, H3Cells = @c, Polygon = @poly,
        AllowedDistanceM = @a, IsActive = @act, UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME()
      WHERE ZoneId = @id ${projectPredicate(req.projectScope, "ProjectId")}`);
    if (!r.rowsAffected[0]) return bad(res, "Zone not found.", 404);
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "zone");
  }
});

// ── Deletes (only what nothing else points at; otherwise deactivate) ───────────────────────────────────────────
router.delete("/gates/:id", requirePageRight("security-gates", "delete"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid gate.");
  try {
    const pool = getPool();
    const used = (await pool.request().input("id", sql.Int, id).query(`
      SELECT (SELECT COUNT(*) FROM dbo.SecurityGuardAssignment WHERE GateId = @id) + (SELECT COUNT(*) FROM dbo.SecurityVisitorRequest WHERE GateId = @id)
           + (SELECT COUNT(*) FROM dbo.SecurityGeofenceZone WHERE GateId = @id) AS n`)).recordset[0].n;
    if (used) return bad(res, "This gate has guards, visitors or zones on record. Set it inactive instead.", 409);
    const r = await pool.request().input("id", sql.Int, id).query(`DELETE FROM dbo.SecurityGate WHERE GateId = @id ${projectPredicate(req.projectScope, "ProjectId")}`);
    if (!r.rowsAffected[0]) return bad(res, "Gate not found.", 404);
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "gate");
  }
});

router.delete("/guard-assignments/:id", requirePageRight("security-guards", "delete"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid assignment.");
  try {
    const r = await getPool().request().input("id", sql.Int, id).query(`
      DELETE a FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId
      WHERE a.AssignmentId = @id ${projectPredicate(req.projectScope, "g.ProjectId")}`);
    if (!r.rowsAffected[0]) return bad(res, "Assignment not found.", 404);
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "guard assignment");
  }
});

router.delete("/geofences/:id", requirePageRight("security-geofences", "delete"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid zone.");
  try {
    const pool = getPool();
    const used = (await pool.request().input("id", sql.Int, id).query(`SELECT COUNT(*) AS n FROM dbo.SecurityAlert WHERE ZoneId = @id`)).recordset[0].n;
    if (used) return bad(res, "Alerts refer to this zone. Set it inactive instead.", 409);
    const r = await pool.request().input("id", sql.Int, id).query(`DELETE FROM dbo.SecurityGeofenceZone WHERE ZoneId = @id ${projectPredicate(req.projectScope, "ProjectId")}`);
    if (!r.rowsAffected[0]) return bad(res, "Zone not found.", 404);
    res.json({ success: true });
  } catch (err) {
    fail(req, res, err, "zone");
  }
});

// ── Guest passes (guard) ────────────────────────────────────────────────────────────────────────────────────────
router.get("/passes/expected", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard sees expected guests.", 403);
  try {
    res.json(await visitors.expectedGuests(getPool(), me(req)));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

// ── Calls (staff side) ──────────────────────────────────────────────────────────────────────────────────────────
const staffParty = (req) => ({ kind: "STAFF", id: me(req) });

router.get("/calls/available", (_req, res) => res.json({ inApp: calls.configured() }));

router.post("/calls", async (req, res) => {
  if (!isGuard(req)) return bad(res, "Only a guard calls residents from a visitor request.", 403);
  const requestId = int(req.body?.requestId);
  const customerId = int(req.body?.customerId);
  if (!requestId || !customerId) return bad(res, "Choose the request and the resident.");
  try {
    res.status(201).json(await calls.guardCallsResident(getPool(), me(req), requestId, customerId));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/calls/incoming", async (req, res) => {
  try {
    res.json(await calls.incomingFor(getPool(), staffParty(req)));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.get("/calls/:id", async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid call.");
  try {
    res.json(await calls.getCall(getPool(), staffParty(req), id));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.post("/calls/:id/:action", async (req, res) => {
  const id = int(req.params.id);
  const action = req.params.action;
  if (!id || !["answer", "decline", "end"].includes(action)) return bad(res, "Invalid call action.");
  try {
    const pool = getPool();
    if (action === "answer") return res.json(await calls.answerCall(pool, staffParty(req), id));
    res.json(await calls.endCall(pool, staffParty(req), id, { decline: action === "decline" }));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

// ── Complaints about guards (security admins) ───────────────────────────────────────────────────────────────────
const complaints = require("../services/securityComplaints");

router.get("/complaints", requirePageRight("security-live", "view"), async (req, res) => {
  try {
    res.json(await complaints.listComplaints(getPool(), req.projectScope ?? null, { status: req.query.status ? String(req.query.status) : null }));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

router.put("/complaints/:id", requirePageRight("security-live", "edit"), async (req, res) => {
  const id = int(req.params.id);
  if (!id) return bad(res, "Invalid complaint.");
  try {
    res.json(await complaints.reviewComplaint(getPool(), req.projectScope ?? null, me(req), id, req.body || {}));
  } catch (err) {
    visitorFail(req, res, err);
  }
});

module.exports = router;
