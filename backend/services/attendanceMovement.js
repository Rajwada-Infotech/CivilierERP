"use strict";
/**
 * On-duty movement. While an employee is punched in, the app sends a location after every 100 m move. Each point is put in
 * one of three zones and the trips are kept in EmployeeAttendanceMovement:
 *   home    — inside one of the employee's own work locations     → closes any open trip / visit
 *   office  — inside another active Work Location Master office   → opens a Visit (entry / exit), marks the trip HasVisit
 *   outside — anywhere else                                       → opens an Outside trip (unless a break is running)
 * An Outside trip that ends back home without an office visit needs the employee's reason (asked by the app).
 */
const { sql } = require("../db");
const { haversine } = require("./face/geofence");

const maxAccuracy = () => Number(process.env.ATTENDANCE_GPS_MAX_ACCURACY_M) || 100;

class MovementError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function openAttendance(pool, employeeId) {
  const r = await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT TOP 1 a.AttendanceId, a.InTime,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.EmployeeAttendanceBreak b WHERE b.AttendanceId = a.AttendanceId AND b.BreakEnd IS NULL) THEN 1 ELSE 0 END AS OnBreak
    FROM dbo.EmployeeAttendance a
    WHERE a.EmployeeId = @E AND a.OutTime IS NULL
    ORDER BY a.InTime DESC`);
  return r.recordset[0] || null;
}

async function zoneOf(pool, employeeId, lat, lng) {
  const locs = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT w.LocationId, w.LocationName, CAST(w.Latitude AS FLOAT) AS Lat, CAST(w.Longitude AS FLOAT) AS Lng, w.RadiusMeters,
           CASE WHEN x.EmployeeId IS NULL THEN 0 ELSE 1 END AS Own
    FROM dbo.WorkLocationMaster w
    LEFT JOIN dbo.EmployeeWorkLocation x ON x.LocationId = w.LocationId AND x.EmployeeId = @E
    WHERE w.IsActive = 1`)).recordset;
  const inside = locs.map((l) => ({ ...l, d: haversine(lat, lng, l.Lat, l.Lng) })).filter((l) => l.d <= l.RadiusMeters).sort((a, b) => b.Own - a.Own || a.d - b.d);
  if (!inside.length) return { zone: "outside" };
  return inside[0].Own ? { zone: "home", location: inside[0] } : { zone: "office", location: inside[0] };
}

async function openRows(pool, attendanceId) {
  const r = await pool.request().input("A", sql.Int, attendanceId).query(
    "SELECT MovementId, Kind, LocationId FROM dbo.EmployeeAttendanceMovement WHERE AttendanceId = @A AND EndAt IS NULL AND Kind <> N'LocationOff'",
  );
  return { trip: r.recordset.find((x) => x.Kind === "Outside") || null, visit: r.recordset.find((x) => x.Kind === "Visit") || null };
}

const close = (pool, id, at) => pool.request().input("Id", sql.Int, id).input("At", sql.DateTime2(0), at)
  .query("UPDATE dbo.EmployeeAttendanceMovement SET EndAt = CASE WHEN @At < StartAt THEN StartAt ELSE @At END WHERE MovementId = @Id AND EndAt IS NULL");

async function open_(pool, a, employeeId, kind, at, lat, lng, locationId = null, hasVisit = 0) {
  await pool.request()
    .input("A", sql.Int, a.AttendanceId).input("E", sql.Int, employeeId).input("K", sql.NVarChar(20), kind)
    .input("L", sql.Int, locationId).input("At", sql.DateTime2(0), at).input("Lat", sql.Float, lat).input("Lng", sql.Float, lng).input("V", sql.Bit, hasVisit)
    .query(`INSERT INTO dbo.EmployeeAttendanceMovement (AttendanceId, EmployeeId, Kind, LocationId, StartAt, StartLat, StartLng, HasVisit)
            VALUES (@A, @E, @K, @L, @At, @Lat, @Lng, @V)`);
}

/** One location point from the app. Points are processed in time order; poor-accuracy points are skipped. */
async function recordPoints(pool, employeeId, points) {
  const list = (Array.isArray(points) ? points : [points]).filter(Boolean).slice(0, 200)
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), acc: p.acc == null ? null : Number(p.acc), at: p.at ? new Date(p.at) : new Date() }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !Number.isNaN(+p.at))
    .sort((x, y) => x.at - y.at);
  const a = await openAttendance(pool, employeeId);
  if (!a) return { tracking: false, pending: await pending(pool, employeeId) };
  const now = Date.now();
  for (const p of list) {
    if (p.acc != null && p.acc > maxAccuracy()) continue;
    if (p.at < new Date(a.InTime) || +p.at > now + 60_000) continue;
    const z = await zoneOf(pool, employeeId, p.lat, p.lng);
    const { trip, visit } = await openRows(pool, a.AttendanceId);
    if (z.zone === "home") {
      if (visit) await close(pool, visit.MovementId, p.at);
      if (trip) await close(pool, trip.MovementId, p.at);
    } else if (z.zone === "office") {
      if (visit && visit.LocationId !== z.location.LocationId) await close(pool, visit.MovementId, p.at);
      if (!visit || visit.LocationId !== z.location.LocationId) await open_(pool, a, employeeId, "Visit", p.at, p.lat, p.lng, z.location.LocationId);
      if (trip) await pool.request().input("Id", sql.Int, trip.MovementId).query("UPDATE dbo.EmployeeAttendanceMovement SET HasVisit = 1 WHERE MovementId = @Id");
      else await open_(pool, a, employeeId, "Outside", p.at, p.lat, p.lng, null, 1);
    } else {
      if (visit) await close(pool, visit.MovementId, p.at);
      if (!trip && !a.OnBreak) await open_(pool, a, employeeId, "Outside", p.at, p.lat, p.lng);
    }
  }
  return { tracking: true, pending: await pending(pool, employeeId) };
}

/**
 * What the app must ask a reason for: finished Outside trips with no office visit, and any location-off spell (also
 * while still off). Skipped ones are not asked again — HR sees them highlighted.
 */
async function pending(pool, employeeId) {
  const r = await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT MovementId, Kind, StartAt, EndAt FROM dbo.EmployeeAttendanceMovement
    WHERE EmployeeId = @E AND Reason IS NULL AND Skipped = 0 AND StartAt >= DATEADD(day, -7, SYSUTCDATETIME())
      AND ((Kind = N'Outside' AND EndAt IS NOT NULL AND HasVisit = 0) OR Kind = N'LocationOff')
    ORDER BY StartAt`);
  return r.recordset.map((x) => ({
    movementId: x.MovementId, kind: x.Kind,
    leftAt: new Date(x.StartAt).toISOString(), returnedAt: x.EndAt ? new Date(x.EndAt).toISOString() : null,
  }));
}

/** The phone's location was switched off (enabled=false) or on again while the employee is punched in. */
async function locationStatus(pool, employeeId, { enabled, at }) {
  const when = at ? new Date(at) : new Date();
  if (Number.isNaN(+when) || +when > Date.now() + 60_000) throw new MovementError("Invalid time.");
  const a = await openAttendance(pool, employeeId);
  if (!a) return { tracking: false, pending: await pending(pool, employeeId) };
  const t = when < new Date(a.InTime) ? new Date(a.InTime) : when;
  const open = (await pool.request().input("A", sql.Int, a.AttendanceId)
    .query("SELECT TOP 1 MovementId FROM dbo.EmployeeAttendanceMovement WHERE AttendanceId = @A AND Kind = N'LocationOff' AND EndAt IS NULL")).recordset[0];
  if (enabled) { if (open) await close(pool, open.MovementId, t); }
  else if (!open) await open_(pool, a, employeeId, "LocationOff", t, null, null);
  return { tracking: true, pending: await pending(pool, employeeId) };
}

/** The employee closed the popup without a reason: not asked again, highlighted for HR. */
async function skip(pool, employeeId, movementId) {
  const r = await pool.request().input("Id", sql.Int, movementId).input("E", sql.Int, employeeId)
    .query("UPDATE dbo.EmployeeAttendanceMovement SET Skipped = 1 WHERE MovementId = @Id AND EmployeeId = @E AND Reason IS NULL");
  if (!r.rowsAffected[0]) throw new MovementError("Not found or already answered.", 404);
  return pending(pool, employeeId);
}

async function giveReason(pool, employeeId, movementId, reason) {
  const why = String(reason || "").trim();
  if (why.length < 3) throw new MovementError("Enter the reason (at least 3 characters).");
  const r = await pool.request().input("Id", sql.Int, movementId).input("E", sql.Int, employeeId).input("R", sql.NVarChar(500), why.slice(0, 500))
    .query(`UPDATE dbo.EmployeeAttendanceMovement SET Reason = @R, ReasonAt = SYSUTCDATETIME()
            WHERE MovementId = @Id AND EmployeeId = @E AND Kind IN (N'Outside', N'LocationOff') AND Reason IS NULL`);
  if (!r.rowsAffected[0]) throw new MovementError("This trip was not found or already has a reason.", 404);
  return pending(pool, employeeId);
}

/** Close whatever is still open when the employee punches out. */
async function closeAll(pool, employeeId, at = new Date()) {
  await pool.request().input("E", sql.Int, employeeId).input("At", sql.DateTime2(0), at)
    .query("UPDATE dbo.EmployeeAttendanceMovement SET EndAt = CASE WHEN @At < StartAt THEN StartAt ELSE @At END WHERE EmployeeId = @E AND EndAt IS NULL");
}

/** Every trip and office visit of one attendance day, for HR and the employee. */
async function list(pool, attendanceId) {
  const r = await pool.request().input("A", sql.Int, attendanceId).query(`
    SELECT m.MovementId, m.Kind, m.LocationId, w.LocationName, m.StartAt, m.EndAt, m.HasVisit, m.Reason, m.ReasonAt, m.Skipped
    FROM dbo.EmployeeAttendanceMovement m LEFT JOIN dbo.WorkLocationMaster w ON w.LocationId = m.LocationId
    WHERE m.AttendanceId = @A ORDER BY m.StartAt, m.MovementId`);
  return r.recordset.map((x) => ({
    movementId: x.MovementId, kind: x.Kind, locationId: x.LocationId, locationName: x.LocationName || null,
    start: new Date(x.StartAt).toISOString(), end: x.EndAt ? new Date(x.EndAt).toISOString() : null,
    seconds: x.EndAt ? Math.max(0, Math.round((new Date(x.EndAt) - new Date(x.StartAt)) / 1000)) : null,
    hasVisit: !!x.HasVisit, reason: x.Reason || null, skipped: !!x.Skipped,
    // Needs HR's eye: location switched off, or a trip outside without a reason (skipped or not given).
    alert: x.Kind === "LocationOff" || (x.Kind === "Outside" && !x.HasVisit && !x.Reason && !!x.EndAt),
  }));
}

module.exports = { recordPoints, pending, locationStatus, skip, giveReason, closeAll, list, MovementError };
