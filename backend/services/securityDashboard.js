"use strict";

/**
 * The Civilier Security app's dashboard reads, shared by routes/securityIntercom.js (staff: guard, security admin)
 * and routes/securityPortal.js (residents, signed in with their customer-portal account).
 * Tables: migrations/701-720/715-security-intercom.sql. Times are stored in UTC; "today" is the IST day.
 */
const { sql } = require("../db");
const { projectPredicate } = require("./projectScope");

const IST_MIN = 330;
const canonical = (r) => String(r || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
const ADMIN_ROLES = new Set(["security_super_admin", "security_admin", "super_admin", "admin"]);
const GUARD_ROLES = new Set(["guard", "security_guard", "security"]);
const CUSTOMER_ROLES = new Set(["customer", "resident"]);

function viewOf(role) {
  const r = canonical(role);
  if (ADMIN_ROLES.has(r)) return "admin";
  if (GUARD_ROLES.has(r)) return "guard";
  if (CUSTOMER_ROLES.has(r)) return "customer";
  return null;
}

/** The UTC instant at which the IST day `daysAgo` days back began. */
function istDayStartUtc(daysAgo = 0) {
  const ist = new Date(Date.now() + IST_MIN * 60000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysAgo) - IST_MIN * 60000);
}
/** YYYY-MM-DD of the IST day `daysAgo` days back. */
const istDate = (daysAgo = 0) => new Date(istDayStartUtc(daysAgo).getTime() + IST_MIN * 60000).toISOString().slice(0, 10);

/** Minutes after midnight of a SQL TIME value (mssql returns it as a Date on 1970-01-01 UTC). */
const timeMinutes = (t) => (t instanceof Date ? t.getUTCHours() * 60 + t.getUTCMinutes() : 0);

/** The shift's window that started on the IST day `daysAgo` back; an end at or before the start runs past midnight. */
function shiftWindow(startTime, endTime, daysAgo) {
  const day = istDayStartUtc(daysAgo).getTime();
  const s = timeMinutes(startTime);
  let e = timeMinutes(endTime);
  if (e <= s) e += 24 * 60;
  return { start: new Date(day + s * 60000), end: new Date(day + e * 60000) };
}

/** Assignment rows (with StartTime / EndTime / EffectiveFrom / EffectiveTo) → the windows that include now, or today's. */
function windowsOf(a, dateOk) {
  const out = [];
  for (const daysAgo of [1, 0]) {
    if (!dateOk(a, istDate(daysAgo))) continue;
    out.push({ ...shiftWindow(a.StartTime, a.EndTime, daysAgo), daysAgo });
  }
  return out;
}
const isoDate = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const coversDate = (a, ymd) => isoDate(a.EffectiveFrom) <= ymd && (!a.EffectiveTo || isoDate(a.EffectiveTo) >= ymd);

const VISITOR_SELECT = `
  SELECT TOP (@top) r.RequestId AS id, r.VisitorName AS visitorName, r.Reason AS reason, g.Name AS gateName,
         NULLIF(r.Block, N'') AS block, r.FlatNo AS flat, r.VehicleNo AS vehicleNo, r.Status AS status,
         r.RequestedAt AS requestedAt, r.DecidedAt AS decidedAt, dc.CustomerName AS decidedBy, gu.name AS guardName,
         r.HasPhoto AS hasPhoto, r.EscalatedAt AS escalatedAt, r.NoResponseBy AS noResponseBy, r.ProjectId AS projectId, g.NoResponsePolicy AS noResponsePolicy, r.PassId AS passId
  FROM dbo.SecurityVisitorRequest r
  JOIN dbo.SecurityGate g ON g.GateId = r.GateId
  LEFT JOIN dbo.CrmCustomer dc ON dc.Id = r.DecidedByCustomerId
  LEFT JOIN dbo.users gu ON gu.id = r.GuardUserId`;

const COUNT_SELECT = `
  SELECT COUNT(CASE WHEN r.RequestedAt >= @from THEN 1 END) AS today,
         COUNT(CASE WHEN r.RequestedAt >= @from AND r.Status = N'APPROVED' THEN 1 END) AS approved,
         COUNT(CASE WHEN r.RequestedAt >= @from AND r.Status = N'DENIED' THEN 1 END) AS denied,
         COUNT(CASE WHEN r.RequestedAt >= @from AND r.Status = N'NO_RESPONSE' THEN 1 END) AS noResponse,
         COUNT(CASE WHEN r.Status = N'PENDING' THEN 1 END) AS pending
  FROM dbo.SecurityVisitorRequest r`;

/** The guard's assignment for now: the shift running now, else the next one today, else today's that ended. */
async function guardAssignmentNow(pool, me) {
  const assignments = (
    await pool.request().input("me", sql.Int, me).input("d0", sql.Date, istDate(1)).input("d1", sql.Date, istDate(0)).query(`
      SELECT a.AssignmentId, a.GateId, g.ProjectId, a.EffectiveFrom, a.EffectiveTo, g.Name AS gateName, e.name AS projectName,
             s.StartTime, s.EndTime
      FROM dbo.SecurityGuardAssignment a
      JOIN dbo.SecurityGate g ON g.GateId = a.GateId AND g.IsActive = 1
      JOIN dbo.SecurityShift s ON s.Id = a.ShiftId
      LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
      WHERE a.GuardUserId = @me AND a.IsActive = 1
        AND a.EffectiveFrom <= @d1 AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @d0)`)
  ).recordset;
  const now = Date.now();
  const all = assignments.flatMap((a) => windowsOf(a, coversDate).map((w) => ({ a, w })));
  const pick =
    all.find(({ w }) => w.start.getTime() <= now && now < w.end.getTime()) ||
    all.filter(({ w }) => w.daysAgo === 0 && w.start.getTime() > now).sort((x, y) => x.w.start - y.w.start)[0] ||
    all.filter(({ w }) => w.daysAgo === 0).sort((x, y) => y.w.start - x.w.start)[0] ||
    null;
  if (!pick) return null;
  return {
    gateId: pick.a.GateId,
    projectId: pick.a.ProjectId,
    gateName: pick.a.gateName,
    projectName: pick.a.projectName || "",
    shiftStart: pick.w.start.toISOString(),
    shiftEnd: pick.w.end.toISOString(),
    onDuty: pick.w.start.getTime() <= now && now < pick.w.end.getTime(),
  };
}

async function guardDashboard(pool, me) {
  const cur = await guardAssignmentNow(pool, me);
  const pick = cur ? { a: { GateId: cur.gateId } } : null;
  const assignment = cur
    ? { gateName: cur.gateName, projectName: cur.projectName, shiftStart: cur.shiftStart, shiftEnd: cur.shiftEnd, onDuty: cur.onDuty }
    : null;

  // Requests at the guard's gate; with no assignment today, the ones this guard raised.
  const scope = pick ? "r.GateId = @gate" : "r.GuardUserId = @me";
  const req = () => pool.request().input("me", sql.Int, me).input("gate", sql.Int, pick ? pick.a.GateId : null).input("from", sql.DateTime2, istDayStartUtc(0));
  const [counts, pending, recent] = await Promise.all([
    req().query(`${COUNT_SELECT} WHERE ${scope}`),
    req().input("top", sql.Int, 20).query(`${VISITOR_SELECT} WHERE ${scope} AND r.Status = N'PENDING' ORDER BY r.RequestedAt DESC`),
    req().input("top", sql.Int, 20).query(`${VISITOR_SELECT} WHERE ${scope} AND r.RequestedAt >= @from ORDER BY r.RequestedAt DESC`),
  ]);
  return { assignment, counts: counts.recordset[0], pending: pending.recordset, recent: recent.recordset };
}

async function adminDashboard(pool, projectScope) {
  const gateScope = projectPredicate(projectScope, "g.ProjectId");
  const from = istDayStartUtc(0);
  const weekFrom = istDayStartUtc(6);

  const [counts, recent, alerts, openAlerts, week, assignments] = await Promise.all([
    pool.request().input("from", sql.DateTime2, from).query(`${COUNT_SELECT} JOIN dbo.SecurityGate g ON g.GateId = r.GateId WHERE 1 = 1 ${gateScope}`),
    pool.request().input("top", sql.Int, 20).query(`${VISITOR_SELECT} WHERE 1 = 1 ${gateScope} ORDER BY r.RequestedAt DESC`),
    pool.request().input("from", sql.DateTime2, from).query(`
      SELECT TOP 20 al.AlertId AS id, al.Type AS type, gu.name AS guardName, z.Name AS zoneName, al.RaisedAt AS at,
             au.name AS acknowledgedBy
      FROM dbo.SecurityAlert al
      LEFT JOIN dbo.users gu ON gu.id = al.GuardUserId
      LEFT JOIN dbo.users au ON au.id = al.AcknowledgedByUserId
      LEFT JOIN dbo.SecurityGeofenceZone z ON z.ZoneId = al.ZoneId
      WHERE (al.AcknowledgedAt IS NULL OR al.RaisedAt >= @from) ${projectPredicate(projectScope, "al.ProjectId")}
      ORDER BY CASE WHEN al.AcknowledgedAt IS NULL THEN 0 ELSE 1 END, al.RaisedAt DESC`),
    pool.request().query(`SELECT COUNT(*) AS n FROM dbo.SecurityAlert al WHERE al.AcknowledgedAt IS NULL ${projectPredicate(projectScope, "al.ProjectId")}`),
    pool.request().input("from", sql.DateTime2, weekFrom).query(`
      SELECT CONVERT(date, DATEADD(MINUTE, ${IST_MIN}, r.RequestedAt)) AS d,
             COUNT(CASE WHEN r.Status = N'APPROVED' THEN 1 END) AS approved,
             COUNT(CASE WHEN r.Status = N'DENIED' THEN 1 END) AS denied,
             COUNT(CASE WHEN r.Status = N'NO_RESPONSE' THEN 1 END) AS noResponse
      FROM dbo.SecurityVisitorRequest r JOIN dbo.SecurityGate g ON g.GateId = r.GateId
      WHERE r.RequestedAt >= @from ${gateScope}
      GROUP BY CONVERT(date, DATEADD(MINUTE, ${IST_MIN}, r.RequestedAt))`),
    pool.request().input("d0", sql.Date, istDate(1)).input("d1", sql.Date, istDate(0)).query(`
      SELECT a.GuardUserId, a.EffectiveFrom, a.EffectiveTo, u.name AS guardName, g.Name AS gateName, s.StartTime, s.EndTime,
             p.PingAt AS lastPingAt, p.InZone
      FROM dbo.SecurityGuardAssignment a
      JOIN dbo.SecurityGate g ON g.GateId = a.GateId AND g.IsActive = 1
      JOIN dbo.SecurityShift s ON s.Id = a.ShiftId
      LEFT JOIN dbo.users u ON u.id = a.GuardUserId
      OUTER APPLY (SELECT TOP 1 gp.PingAt, gp.InZone FROM dbo.SecurityGuardPing gp WHERE gp.GuardUserId = a.GuardUserId ORDER BY gp.PingAt DESC) p
      WHERE a.IsActive = 1 AND a.EffectiveFrom <= @d1 AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @d0) ${gateScope}`),
  ]);

  // On duty: a shift window that includes now. One row per guard.
  const now = Date.now();
  const onDuty = new Map();
  for (const a of assignments.recordset) {
    if (onDuty.has(a.GuardUserId)) continue;
    if (windowsOf(a, coversDate).some((w) => w.start.getTime() <= now && now < w.end.getTime())) {
      onDuty.set(a.GuardUserId, { guardId: a.GuardUserId, name: a.guardName || `User ${a.GuardUserId}`, gateName: a.gateName, lastPingAt: a.lastPingAt, inZone: a.InZone == null ? null : !!a.InZone });
    }
  }
  const guards = [...onDuty.values()].sort((x, y) => (x.inZone === false ? -1 : 0) - (y.inZone === false ? -1 : 0) || x.name.localeCompare(y.name));

  const byDay = new Map(week.recordset.map((r) => [isoDate(r.d), r]));
  const weekRows = Array.from({ length: 7 }, (_, i) => {
    const date = istDate(6 - i);
    const r = byDay.get(date);
    return { date, approved: r?.approved ?? 0, denied: r?.denied ?? 0, noResponse: r?.noResponse ?? 0 };
  });

  return {
    counts: { ...counts.recordset[0], guardsOnDuty: guards.length, openAlerts: openAlerts.recordset[0].n },
    pending: [],
    recent: recent.recordset,
    alerts: alerts.recordset,
    guards,
    week: weekRows,
  };
}

async function customerDashboard(pool, customerId, residentIdParam) {
  const flats = (
    await pool.request().input("me", sql.Int, customerId).query(`
      SELECT r.ResidentId AS residentId, r.ProjectId, ISNULL(e.name, N'') AS projectName, NULLIF(r.Block, N'') AS block,
             r.Block AS rawBlock, r.FlatNo AS flat, r.IsPrimary AS isPrimary
      FROM dbo.SecurityResident r
      LEFT JOIN dbo.enterprise e ON e.id = r.ProjectId
      WHERE r.CustomerId = @me AND r.IsActive = 1
      ORDER BY r.IsPrimary DESC, r.ResidentId`)
  ).recordset;

  const out = (rows) => rows.map(({ ProjectId: _p, rawBlock: _b, ...f }) => ({ ...f, isPrimary: !!f.isPrimary }));
  if (!flats.length) {
    return { flats: [], residentId: null, counts: { today: 0, approved: 0, denied: 0, noResponse: 0, pending: 0 }, pending: [], recent: [] };
  }
  let flat = flats[0];
  if (residentIdParam != null) {
    flat = flats.find((f) => f.residentId === residentIdParam);
    if (!flat) return { forbidden: true };
  }

  // "This week" for a resident: the last seven IST days.
  const req = () =>
    pool.request().input("p", sql.Int, flat.ProjectId).input("b", sql.NVarChar(50), flat.rawBlock || "").input("f", sql.NVarChar(50), flat.flat).input("from", sql.DateTime2, istDayStartUtc(6));
  const where = "r.ProjectId = @p AND r.Block = @b AND r.FlatNo = @f";
  const [counts, pending, recent] = await Promise.all([
    req().query(`${COUNT_SELECT} WHERE ${where}`),
    req().input("top", sql.Int, 20).query(`${VISITOR_SELECT} WHERE ${where} AND r.Status = N'PENDING' ORDER BY r.RequestedAt DESC`),
    req().input("top", sql.Int, 30).query(`${VISITOR_SELECT} WHERE ${where} ORDER BY r.RequestedAt DESC`),
  ]);
  return { flats: out(flats), residentId: flat.residentId, counts: counts.recordset[0], pending: pending.recordset, recent: recent.recordset };
}

/** Every guard whose shift window includes now (one row per guard), within the project scope. */
async function onDutyGuards(pool, projectScope = null) {
  const rows = (
    await pool.request().input("d0", sql.Date, istDate(1)).input("d1", sql.Date, istDate(0)).query(`
      SELECT a.GuardUserId, a.GateId, g.ProjectId, a.EffectiveFrom, a.EffectiveTo, u.name AS guardName, g.Name AS gateName,
             ISNULL(e.name, N'') AS projectName, s.StartTime, s.EndTime
      FROM dbo.SecurityGuardAssignment a
      JOIN dbo.SecurityGate g ON g.GateId = a.GateId AND g.IsActive = 1
      JOIN dbo.SecurityShift s ON s.Id = a.ShiftId
      LEFT JOIN dbo.users u ON u.id = a.GuardUserId
      LEFT JOIN dbo.enterprise e ON e.id = g.ProjectId
      WHERE a.IsActive = 1 AND a.EffectiveFrom <= @d1 AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @d0) ${projectPredicate(projectScope, "g.ProjectId")}`)
  ).recordset;
  const now = Date.now();
  const out = new Map();
  for (const a of rows) {
    if (out.has(a.GuardUserId)) continue;
    const w = windowsOf(a, coversDate).find((x) => x.start.getTime() <= now && now < x.end.getTime());
    if (w) out.set(a.GuardUserId, { guardUserId: a.GuardUserId, guardName: a.guardName || `User ${a.GuardUserId}`, gateId: a.GateId, gateName: a.gateName, projectId: a.ProjectId, projectName: a.projectName, start: w.start, end: w.end });
  }
  return [...out.values()];
}

module.exports = { onDutyGuards, VISITOR_SELECT, viewOf, guardAssignmentNow, guardDashboard, adminDashboard, customerDashboard, istDayStartUtc, istDate };
