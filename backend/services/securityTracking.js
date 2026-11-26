"use strict";

/**
 * Guard tracking for the Civilier Security app (doc phase 3).
 *
 *   recordPings      a guard's phone uploads location pings in batches (queued while offline). Kept only inside the
 *                    guard's shift (15 min either side), once per (guard, time). Each ping is checked against the zones
 *                    of the guard's gate: InZone 1 / 0, or NULL when its accuracy is too poor to judge (or no zone).
 *                    LEFT_OUT_PINGS judged pings in a row outside the zone raise one LEFT_ZONE alert.
 *   sweepTracking    every 60 s: an on-duty guard whose phone has sent nothing for OFFLINE_MIN minutes gets one
 *                    DEVICE_OFFLINE alert (per silence); alerts nobody acknowledged for ESCALATE_MIN minutes are
 *                    pushed again, and after ESCALATE2_MIN to the super admins / admins too; hourly, pings and visitor photos older than RETENTION_DAYS are deleted.
 *   zone helpers     H3 cells (h3-js) or a hand-drawn polygon, with an allowed distance either side of the line.
 *   liveView / trail the live map (on-duty guards, last position, shift trail simplified for display) and a replay.
 * Alerts are pushed to Security Super Admin / Security Admin users and listed in the app and on the web.
 */
const h3 = require("h3-js");
const { sql } = require("../db");
const logger = require("../logger");
const { sendToUsers } = require("./pushNotifications");
const { guardAssignmentNow, onDutyGuards } = require("./securityDashboard");
const { projectPredicate } = require("./projectScope");

const MAX_ACCURACY_M = 50; // a fix less precise than this isn't judged in or out
const LEFT_OUT_PINGS = 3; // judged pings in a row outside before LEFT_ZONE
const OFFLINE_MIN = 5;
const ESCALATE_MIN = 10;
const ESCALATE2_MIN = 30;
const RETENTION_DAYS = 90;
const SHIFT_GRACE_MS = 15 * 60 * 1000;
const MAX_BATCH = 500;
const APP_KEY = "security-intercom";
const ALERT_TEXT = { LEFT_ZONE: "Left the zone", DEVICE_OFFLINE: "Device offline", UNANSWERED: "Request unanswered" };

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
function metres(aLat, aLng, bLat, bLng) {
  const x = rad(bLng - aLng) * Math.cos(rad((aLat + bLat) / 2));
  const y = rad(bLat - aLat);
  return Math.sqrt(x * x + y * y) * R;
}
/** Distance from a point to a segment, in metres (local flat projection: fine at gate scale). */
function toSegment(lat, lng, a, b) {
  const k = Math.cos(rad(lat));
  const px = lng * k, py = lat, ax = a[1] * k, ay = a[0], bx = b[1] * k, by = b[0];
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return rad(Math.hypot(px - (ax + t * dx), py - (ay + t * dy))) * R;
}
function inPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A zone row from the database → something `inZone` can test quickly. */
function prepareZone(z) {
  const allowed = Math.max(0, Number(z.AllowedDistanceM) || 0);
  if (z.Kind === "POLYGON") {
    let poly = [];
    try {
      poly = JSON.parse(z.Polygon || "[]").filter((p) => Array.isArray(p) && p.length === 2).map((p) => [Number(p[0]), Number(p[1])]);
    } catch {
      /* unreadable polygon: never matches */
    }
    return { id: z.ZoneId, kind: "POLYGON", poly, allowed };
  }
  let cells = [];
  try {
    cells = JSON.parse(z.H3Cells || "[]").filter((c) => typeof c === "string" && h3.isValidCell(c));
  } catch {
    /* unreadable cells: never matches */
  }
  const res = cells.length ? h3.getResolution(cells[0]) : Number(z.H3Resolution) || 11;
  return { id: z.ZoneId, kind: "H3", res, set: new Set(cells), allowed, ring: allowed ? Math.ceil(allowed / h3.getHexagonEdgeLengthAvg(res, "m")) : 0 };
}

/** { inZone, zoneId, cell } for one point against the prepared zones (inZone null when there is no zone). */
function judge(lat, lng, zones) {
  let cell = null;
  for (const z of zones) {
    if (z.kind === "H3") {
      const c = h3.latLngToCell(lat, lng, z.res);
      cell = cell || c;
      if (z.set.has(c)) return { inZone: true, zoneId: z.id, cell: c };
      if (z.ring && h3.gridDisk(c, z.ring).some((n) => z.set.has(n))) return { inZone: true, zoneId: z.id, cell: c };
    } else if (z.poly.length >= 3) {
      if (inPolygon(lat, lng, z.poly)) return { inZone: true, zoneId: z.id, cell };
      if (z.allowed) {
        for (let i = 0; i < z.poly.length; i++) {
          if (toSegment(lat, lng, z.poly[i], z.poly[(i + 1) % z.poly.length]) <= z.allowed) return { inZone: true, zoneId: z.id, cell };
        }
      }
    }
  }
  return { inZone: zones.length ? false : null, zoneId: zones[0]?.id ?? null, cell };
}

/** The zones a guard at this gate is held to: the gate's own zones, else the project's zones without a gate. */
async function zonesForGate(pool, gateId, projectId) {
  const rows = (
    await pool.request().input("g", sql.Int, gateId).input("p", sql.Int, projectId).query(`
      SELECT ZoneId, Kind, H3Cells, Polygon, H3Resolution, AllowedDistanceM, GateId
      FROM dbo.SecurityGeofenceZone WHERE IsActive = 1 AND ProjectId = @p AND (GateId = @g OR GateId IS NULL)`)
  ).recordset;
  const own = rows.filter((z) => z.GateId === gateId);
  return (own.length ? own : rows.filter((z) => z.GateId == null)).map(prepareZone);
}

/** H3 cells covering a circle around a point: the editor's "hexagons around the gate". */
function cellsAround(lat, lng, radiusM, res) {
  const centre = h3.latLngToCell(lat, lng, res);
  const k = Math.max(0, Math.ceil(radiusM / (h3.getHexagonEdgeLengthAvg(res, "m") * 1.5)));
  return h3.gridDisk(centre, k).filter((c) => {
    const [clat, clng] = h3.cellToLatLng(c);
    return metres(lat, lng, clat, clng) <= radiusM + h3.getHexagonEdgeLengthAvg(res, "m");
  });
}
/** A zone for drawing: polygons as-is, H3 cells as one outline each ([lat, lng] rings). */
function zoneShapes(z) {
  if (z.Kind === "POLYGON") {
    try {
      return [JSON.parse(z.Polygon || "[]")];
    } catch {
      return [];
    }
  }
  try {
    return JSON.parse(z.H3Cells || "[]").filter((c) => h3.isValidCell(c)).map((c) => h3.cellToBoundary(c));
  } catch {
    return [];
  }
}

/** Douglas–Peucker: keeps the shape of a trail with far fewer points (tolerance in metres). */
function simplify(points, tolM = 6) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = toSegment(points[i].lat, points[i].lng, [points[a].lat, points[a].lng], [points[b].lat, points[b].lng]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tolM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// ── Alerts ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function securityAdminIds(pool) {
  return (
    await pool.request().query(`
      SELECT u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
      WHERE ISNULL(u.discontinue, 0) = 0
        AND LOWER(REPLACE(REPLACE(LTRIM(RTRIM(r.RName)), N'-', N' '), N'_', N' ')) IN (N'security super admin', N'security admin')`)
  ).recordset.map((r) => r.id);
}

/** The web's Security Live page re-reads at once (socket room "security-live"). Best-effort. */
function tellLive(payload) {
  try {
    require("../socket").getIo()?.to("security-live").emit("security:live", payload);
  } catch {
    /* no socket server */
  }
}

async function raiseAlert(pool, { type, projectId, guardUserId, zoneId = null, detail, pingAt = null }) {
  const id = (
    await pool.request().input("t", sql.NVarChar(20), type).input("p", sql.Int, projectId).input("g", sql.Int, guardUserId).input("z", sql.Int, zoneId)
      .input("d", sql.NVarChar(500), detail).input("pa", sql.DateTime2(3), pingAt).query(`
      INSERT INTO dbo.SecurityAlert (Type, ProjectId, GuardUserId, ZoneId, Detail, PingAt) OUTPUT INSERTED.AlertId AS id VALUES (@t, @p, @g, @z, @d, @pa)`)
  ).recordset[0].id;
  tellLive({ alertId: id });
  void securityAdminIds(pool).then((ids) => sendToUsers(ids, { title: ALERT_TEXT[type], body: detail, data: { type: "security-alert", alertId: id } }, { apps: [APP_KEY] }));
  return id;
}

// ── Pings ───────────────────────────────────────────────────────────────────────────────────────────────────────
const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** Stores a guard's pings. Returns { stored, skipped, onShift } — onShift false tells the phone to stop tracking. */
async function recordPings(pool, guardUserId, raw) {
  if (!Array.isArray(raw)) throw Object.assign(new Error("Send pings as a list."), { status: 400 });
  const cur = await guardAssignmentNow(pool, guardUserId);
  if (!cur) return { stored: 0, skipped: raw.length, onShift: false };
  const from = new Date(cur.shiftStart).getTime() - SHIFT_GRACE_MS;
  const to = new Date(cur.shiftEnd).getTime() + SHIFT_GRACE_MS;
  const now = Date.now();

  const pings = [];
  for (const p of raw.slice(0, MAX_BATCH)) {
    const at = new Date(p?.at).getTime();
    const lat = num(p?.lat, -90, 90);
    const lng = num(p?.lng, -180, 180);
    if (!Number.isFinite(at) || lat == null || lng == null) continue;
    if (at < from || at > to || at > now + 60_000) continue; // off shift (or a phone clock far ahead): not kept
    pings.push({ at: new Date(at), lat, lng, acc: num(p?.accuracy, 0, 100000), bat: num(p?.battery, 0, 100) });
  }
  pings.sort((a, b) => a.at - b.at);

  const zones = await zonesForGate(pool, cur.gateId, cur.projectId);
  for (const p of pings) {
    const j = judge(p.lat, p.lng, zones);
    p.cell = j.cell;
    p.zoneId = j.zoneId;
    p.inZone = p.acc != null && p.acc > MAX_ACCURACY_M ? null : j.inZone;
  }

  let stored = 0;
  for (let i = 0; i < pings.length; i += 100) {
    const chunk = pings.slice(i, i + 100);
    const req = pool.request().input("g", sql.Int, guardUserId);
    const values = chunk.map((p, k) => {
      req.input(`t${k}`, sql.DateTime2(3), p.at).input(`la${k}`, sql.Decimal(9, 6), p.lat).input(`lo${k}`, sql.Decimal(9, 6), p.lng)
        .input(`ac${k}`, sql.Decimal(7, 1), p.acc).input(`b${k}`, sql.TinyInt, p.bat == null ? null : Math.round(p.bat))
        .input(`c${k}`, sql.NVarChar(16), p.cell).input(`z${k}`, sql.Int, p.zoneId).input(`i${k}`, sql.Bit, p.inZone);
      return `(@t${k}, @la${k}, @lo${k}, @ac${k}, @b${k}, @c${k}, @z${k}, @i${k})`;
    });
    // The same ping sent twice (a retry after a lost answer) is stored once.
    const r = await req.query(`
      INSERT INTO dbo.SecurityGuardPing (GuardUserId, PingAt, Latitude, Longitude, AccuracyM, BatteryPct, H3Cell, ZoneId, InZone)
      SELECT @g, v.t, v.la, v.lo, v.ac, v.b, v.c, v.z, v.i
      FROM (VALUES ${values.join(", ")}) AS v (t, la, lo, ac, b, c, z, i)
      WHERE NOT EXISTS (SELECT 1 FROM dbo.SecurityGuardPing x WHERE x.GuardUserId = @g AND x.PingAt = v.t)`);
    stored += r.rowsAffected[0] || 0;
  }

  if (stored) {
    await checkLeftZone(pool, guardUserId, cur);
    tellLive({ guardUserId });
  }
  return { stored, skipped: raw.length - stored, onShift: now <= to };
}

/** LEFT_OUT_PINGS judged pings in a row outside → one LEFT_ZONE alert, until the guard is seen inside again. */
async function checkLeftZone(pool, guardUserId, cur) {
  const last = (
    await pool.request().input("g", sql.Int, guardUserId).input("n", sql.Int, LEFT_OUT_PINGS).query(`
      SELECT TOP (@n) PingAt, InZone, ZoneId FROM dbo.SecurityGuardPing WHERE GuardUserId = @g AND InZone IS NOT NULL ORDER BY PingAt DESC`)
  ).recordset;
  if (last.length < LEFT_OUT_PINGS || last.some((p) => p.InZone)) return;
  // Already raised for this time out: an alert whose ping came after the guard was last seen inside. Ping times on both
  // sides (the phone's clock), so pings uploaded late from the offline queue compare correctly.
  const open = (
    await pool.request().input("g", sql.Int, guardUserId).query(`
      SELECT TOP 1 1 AS x FROM dbo.SecurityAlert a
      WHERE a.GuardUserId = @g AND a.Type = N'LEFT_ZONE'
        AND a.PingAt > ISNULL((SELECT MAX(PingAt) FROM dbo.SecurityGuardPing p WHERE p.GuardUserId = @g AND p.InZone = 1), '2000-01-01')`)
  ).recordset[0];
  if (open) return;
  const name = (await pool.request().input("g", sql.Int, guardUserId).query(`SELECT name FROM dbo.users WHERE id = @g`)).recordset[0]?.name || "A guard";
  await raiseAlert(pool, { type: "LEFT_ZONE", projectId: cur.projectId, guardUserId, zoneId: last[0].ZoneId, pingAt: last[0].PingAt, detail: `${name} is outside the ${cur.gateName} zone.` });
}

// ── Sweep: offline, escalation, retention ───────────────────────────────────────────────────────────────────────
let lastPurge = 0;
async function sweepTracking(pool) {
  const out = { offline: 0, escalated: 0, purged: 0 };
  const now = Date.now();
  const guards = await onDutyGuards(pool);
  for (const g of guards) {
    if (now - g.start.getTime() < OFFLINE_MIN * 60_000) continue; // the shift has just begun
    const r = (
      await pool.request().input("g", sql.Int, g.guardUserId).input("s", sql.DateTime2, g.start).query(`
        SELECT (SELECT MAX(PingAt) FROM dbo.SecurityGuardPing WHERE GuardUserId = @g AND PingAt >= @s) AS lastPing,
               (SELECT MAX(RaisedAt) FROM dbo.SecurityAlert WHERE GuardUserId = @g AND Type = N'DEVICE_OFFLINE') AS lastAlert`)
    ).recordset[0];
    const since = r.lastPing ? new Date(r.lastPing).getTime() : g.start.getTime();
    if (now - since < OFFLINE_MIN * 60_000) continue;
    if (r.lastAlert && new Date(r.lastAlert).getTime() >= since) continue; // already raised for this silence
    await raiseAlert(pool, {
      type: "DEVICE_OFFLINE",
      projectId: g.projectId,
      guardUserId: g.guardUserId,
      detail: r.lastPing ? `${g.guardName}'s phone (${g.gateName}) has sent no location for ${Math.round((now - since) / 60000)} minutes.` : `${g.guardName}'s phone (${g.gateName}) hasn't sent a location since the shift began.`,
    });
    out.offline++;
  }

  const stale = (
    await pool.request().input("m", sql.Int, ESCALATE_MIN).query(`
      UPDATE dbo.SecurityAlert SET EscalatedAt = SYSUTCDATETIME()
      OUTPUT INSERTED.AlertId, INSERTED.Type, INSERTED.Detail
      WHERE AcknowledgedAt IS NULL AND EscalatedAt IS NULL AND RaisedAt <= DATEADD(MINUTE, -@m, SYSUTCDATETIME())`)
  ).recordset;
  if (stale.length) {
    const ids = await securityAdminIds(pool);
    for (const a of stale) {
      void sendToUsers(ids, { title: `Not acknowledged: ${ALERT_TEXT[a.Type] ?? a.Type}`, body: a.Detail || "", data: { type: "security-alert", alertId: a.AlertId } }, { apps: [APP_KEY] });
    }
    out.escalated = stale.length;
  }

  // Still nobody after ESCALATE2_MIN: the super admins / admins are told too.
  const stale2 = (
    await pool.request().input("m", sql.Int, ESCALATE2_MIN).query(`
      UPDATE dbo.SecurityAlert SET Escalated2At = SYSUTCDATETIME()
      OUTPUT INSERTED.AlertId, INSERTED.Type, INSERTED.Detail
      WHERE AcknowledgedAt IS NULL AND EscalatedAt IS NOT NULL AND Escalated2At IS NULL AND RaisedAt <= DATEADD(MINUTE, -@m, SYSUTCDATETIME())`)
  ).recordset;
  if (stale2.length) {
    const top = (
      await pool.request().query(`
        SELECT u.id FROM dbo.users u JOIN dbo.Role r ON r.RId = u.RoleId
        WHERE ISNULL(u.discontinue, 0) = 0 AND LOWER(REPLACE(REPLACE(LTRIM(RTRIM(r.RName)), N'-', N' '), N'_', N' ')) IN (N'super admin', N'admin')`)
    ).recordset.map((r) => r.id);
    const ids = [...new Set([...top, ...(await securityAdminIds(pool))])];
    for (const a of stale2) {
      void sendToUsers(ids, { title: `Still not acknowledged: ${ALERT_TEXT[a.Type] ?? a.Type}`, body: a.Detail || "", data: { type: "security-alert", alertId: a.AlertId } }, { apps: [APP_KEY] });
    }
    out.escalated += stale2.length;
  }

  if (now - lastPurge > 60 * 60_000) {
    lastPurge = now;
    const p = await pool.request().input("d", sql.Int, RETENTION_DAYS).query(`
      DELETE TOP (20000) FROM dbo.SecurityGuardPing WHERE PingAt < DATEADD(DAY, -@d, SYSUTCDATETIME());
      UPDATE r SET HasPhoto = 0 FROM dbo.SecurityVisitorRequest r
        WHERE r.HasPhoto = 1 AND r.RequestedAt < DATEADD(DAY, -@d, SYSUTCDATETIME());
      DELETE ph FROM dbo.SecurityVisitorPhoto ph JOIN dbo.SecurityVisitorRequest r ON r.RequestId = ph.RequestId
        WHERE r.RequestedAt < DATEADD(DAY, -@d, SYSUTCDATETIME());`);
    out.purged = p.rowsAffected[0] || 0;
  }
  return out;
}

let timer = null;
function startTrackingSweepEngine() {
  if (timer) return;
  timer = setInterval(() => {
    const { getPool } = require("../db");
    sweepTracking(getPool()).catch((e) => e.number !== 208 && logger.error({ event: "SECURITY_TRACKING_SWEEP_FAILED", err: e.message }, "Tracking sweep failed"));
  }, 60 * 1000);
}

// ── Live map and replay ─────────────────────────────────────────────────────────────────────────────────────────
async function zonesInScope(pool, projectScope) {
  return (
    await pool.request().query(`
      SELECT z.ZoneId, z.ProjectId, z.GateId, z.Name, z.Kind, z.H3Cells, z.Polygon, z.H3Resolution, z.AllowedDistanceM, z.IsActive,
             g.Name AS gateName, ISNULL(e.name, N'') AS projectName
      FROM dbo.SecurityGeofenceZone z
      LEFT JOIN dbo.SecurityGate g ON g.GateId = z.GateId
      LEFT JOIN dbo.enterprise e ON e.id = z.ProjectId
      WHERE 1 = 1 ${projectPredicate(projectScope, "z.ProjectId")}
      ORDER BY e.name, z.Name`)
  ).recordset;
}

async function pingsBetween(pool, guardUserId, from, to) {
  return (
    await pool.request().input("g", sql.Int, guardUserId).input("f", sql.DateTime2, from).input("t", sql.DateTime2, to).query(`
      SELECT PingAt AS at, CAST(Latitude AS FLOAT) AS lat, CAST(Longitude AS FLOAT) AS lng, CAST(AccuracyM AS FLOAT) AS accuracy,
             BatteryPct AS battery, InZone AS inZone
      FROM dbo.SecurityGuardPing WHERE GuardUserId = @g AND PingAt >= @f AND PingAt <= @t ORDER BY PingAt`)
  ).recordset.map((p) => ({ ...p, inZone: p.inZone == null ? null : !!p.inZone }));
}

async function liveView(pool, projectScope) {
  const [guards, zones] = await Promise.all([onDutyGuards(pool, projectScope), zonesInScope(pool, projectScope)]);
  const out = [];
  for (const g of guards) {
    const pings = await pingsBetween(pool, g.guardUserId, g.start, new Date());
    const last = pings[pings.length - 1] || null;
    out.push({
      guardUserId: g.guardUserId,
      name: g.guardName,
      gateName: g.gateName,
      projectName: g.projectName,
      shiftStart: g.start,
      shiftEnd: g.end,
      last,
      trail: simplify(pings.filter((p) => p.accuracy == null || p.accuracy <= MAX_ACCURACY_M * 2)).map((p) => [p.lat, p.lng]),
    });
  }
  return {
    guards: out,
    zones: zones.filter((z) => z.IsActive).map((z) => ({ id: z.ZoneId, name: z.Name, gateName: z.gateName, shapes: zoneShapes(z) })),
  };
}

async function trailFor(pool, guardUserId, from, to) {
  const pings = await pingsBetween(pool, guardUserId, from, to);
  let distance = 0;
  for (let i = 1; i < pings.length; i++) distance += metres(pings[i - 1].lat, pings[i - 1].lng, pings[i].lat, pings[i].lng);
  return {
    points: simplify(pings, 4),
    count: pings.length,
    distanceM: Math.round(distance),
    outside: pings.filter((p) => p.inZone === false).length,
    judged: pings.filter((p) => p.inZone != null).length,
  };
}

module.exports = {
  MAX_ACCURACY_M,
  LEFT_OUT_PINGS,
  OFFLINE_MIN,
  ESCALATE_MIN,
  RETENTION_DAYS,
  prepareZone,
  judge,
  cellsAround,
  zoneShapes,
  simplify,
  recordPings,
  sweepTracking,
  startTrackingSweepEngine,
  liveView,
  trailFor,
  zonesInScope,
  securityAdminIds,
  tellLive,
};
