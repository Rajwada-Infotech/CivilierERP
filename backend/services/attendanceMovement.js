"use strict";
/**
 * On-duty movement. While an employee is punched in, the app sends a location after every 100 m move. Each point is put in
 * one of three zones and the trips are kept in EmployeeAttendanceMovement:
 *   home    — inside one of the employee's own work locations     → closes any open trip / visit
 *   office  — inside another active Work Location Master office   → opens a Visit (entry / exit), marks the trip HasVisit
 *   outside — anywhere else                                       → opens an Outside trip (unless a break is running)
 * An Outside trip that ends back home without an office visit needs the employee's reason (asked by the app).
 *
 * GPS drift protection (all distances in metres, all settings in .env):
 *   ATTENDANCE_GPS_MAX_ACCURACY_M          100  points less accurate than this are ignored (the app is asked for a new fix)
 *   ATTENDANCE_GEOFENCE_INSIDE_BUFFER_M      5  inside  = distance ≤ radius − buffer          (50 m office → 45 m)
 *   ATTENDANCE_GEOFENCE_OUTSIDE_BUFFER_M    10  outside = distance − accuracy > radius + buffer (50 m office → 60 m)
 *                                               anything between is "Uncertain" — never counted as outside
 *   ATTENDANCE_OUTSIDE_CONFIRM_POINTS        3  consecutive reliable outside readings before a trip is opened
 *   ATTENDANCE_VISIT_CONFIRM_POINTS          2  consecutive readings inside another office before a visit is opened
 *   ATTENDANCE_MAX_SPEED_KMH               150  a point implying a faster move than this is a GPS jump and ignored
 *   ATTENDANCE_MIN_TRIP_SECONDS            180  a trip shorter than this with no visit is treated as drift (not asked)
 * Every point is kept in EmployeeLocationPoint with its accuracy, distance, radius and result (audit).
 */
const { sql } = require("../db");
const { haversine } = require("./face/geofence");

const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const maxAccuracy = () => num("ATTENDANCE_GPS_MAX_ACCURACY_M", 100) || 100;
const cfg = () => ({
  inBuf: num("ATTENDANCE_GEOFENCE_INSIDE_BUFFER_M", 5), outBuf: num("ATTENDANCE_GEOFENCE_OUTSIDE_BUFFER_M", 10),
  confirm: Math.max(1, Math.round(num("ATTENDANCE_OUTSIDE_CONFIRM_POINTS", 3))), visitConfirm: Math.max(1, Math.round(num("ATTENDANCE_VISIT_CONFIRM_POINTS", 2))),
  maxSpeed: num("ATTENDANCE_MAX_SPEED_KMH", 150) || 150, minTrip: num("ATTENDANCE_MIN_TRIP_SECONDS", 180),
});
const hasAudit = async (pool) => !!(await pool.request().query("SELECT OBJECT_ID('dbo.EmployeeLocationPoint', 'U') AS t")).recordset[0].t;

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

async function workLocations(pool, employeeId) {
  return (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT w.LocationId, w.LocationName, CAST(w.Latitude AS FLOAT) AS Lat, CAST(w.Longitude AS FLOAT) AS Lng, w.RadiusMeters,
           CASE WHEN x.EmployeeId IS NULL THEN 0 ELSE 1 END AS Own
    FROM dbo.WorkLocationMaster w
    LEFT JOIN dbo.EmployeeWorkLocation x ON x.LocationId = w.LocationId AND x.EmployeeId = @E
    WHERE w.IsActive = 1`)).recordset;
}

/**
 * Accuracy-aware geofence with hysteresis. A point is
 *   Inside    within radius − inside buffer of one of the employee's own locations (the reliable "home" reading);
 *   Uncertain not clearly inside, and the accuracy circle still reaches radius + outside buffer — never counted as out;
 *   Office    clearly outside every own location and within radius − inside buffer of another office;
 *   Outside   clearly outside every own location (distance − accuracy > radius + outside buffer) and no office.
 */
function classify(locs, lat, lng, acc, c) {
  const a = acc == null ? maxAccuracy() / 2 : acc; // unknown accuracy: assume half the limit
  const all = locs.map((l) => ({ ...l, d: haversine(lat, lng, l.Lat, l.Lng), r: Number(l.RadiusMeters) || 100 }));
  const own = all.filter((l) => l.Own).sort((x, y) => x.d - y.d);
  const nearest = own[0] ?? all.sort((x, y) => x.d - y.d)[0] ?? null;
  const base = { location: nearest, distance: nearest?.d ?? null, radius: nearest?.r ?? null };
  const inside = own.find((l) => l.d <= l.r - c.inBuf);
  if (inside) return { ...base, result: "Inside", location: inside, distance: inside.d, radius: inside.r };
  const unsure = own.find((l) => !(l.d - a > l.r + c.outBuf));
  if (unsure) return { ...base, result: "Uncertain", note: unsure.d <= unsure.r + c.outBuf
    ? `${Math.round(unsure.d)} m from ${unsure.LocationName} — between the inside line (${unsure.r - c.inBuf} m) and the outside line (${unsure.r + c.outBuf} m)`
    : `${Math.round(unsure.d)} m from ${unsure.LocationName} but ±${Math.round(a)} m accuracy reaches the outside line (${unsure.r + c.outBuf} m)` };
  const office = all.filter((l) => !l.Own && l.d <= l.r - c.inBuf).sort((x, y) => x.d - y.d)[0];
  if (office) return { ...base, result: "Office", office };
  return { ...base, result: "Outside" };
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

async function audit(pool, a, employeeId, p, k, result, note = null, movementId = null) {
  if (!(await hasAudit(pool))) return;
  await pool.request().input("A", sql.Int, a.AttendanceId).input("E", sql.Int, employeeId).input("Lat", sql.Decimal(9, 6), p.lat).input("Lng", sql.Decimal(9, 6), p.lng)
    .input("Acc", sql.Decimal(9, 1), p.acc).input("At", sql.DateTime2(0), p.at).input("L", sql.Int, k?.location?.LocationId ?? null)
    .input("D", sql.Decimal(9, 1), k?.distance == null ? null : Math.round(k.distance * 10) / 10).input("R", sql.Int, k?.radius ?? null)
    .input("Res", sql.NVarChar(20), result).input("N", sql.NVarChar(300), note ? String(note).slice(0, 300) : null).input("M", sql.Int, movementId)
    .query(`INSERT INTO dbo.EmployeeLocationPoint (AttendanceId, EmployeeId, Lat, Lng, AccuracyM, PointAt, LocationId, DistanceM, RadiusM, Result, Note, MovementId)
            VALUES (@A, @E, @Lat, @Lng, @Acc, @At, @L, @D, @R, @Res, @N, @M)`);
}

/** The reliable readings since the last Inside, newest first (Uncertain / rejected readings neither count nor reset). */
async function streak(pool, attendanceId) {
  const rows = (await pool.request().input("A", sql.Int, attendanceId).query(`
    SELECT TOP 20 PointId, Lat, Lng, AccuracyM, PointAt, DistanceM, RadiusM, Result, LocationId, Note FROM dbo.EmployeeLocationPoint
    WHERE AttendanceId = @A AND Result IN (N'Inside', N'Outside', N'Office') ORDER BY PointAt DESC, PointId DESC`)).recordset;
  const out = [];
  for (const r of rows) { if (r.Result === "Inside") break; out.push(r); }
  return out;
}

async function lastReliable(pool, attendanceId) {
  return (await pool.request().input("A", sql.Int, attendanceId).query(`
    SELECT TOP 1 CAST(Lat AS FLOAT) AS Lat, CAST(Lng AS FLOAT) AS Lng, PointAt FROM dbo.EmployeeLocationPoint
    WHERE AttendanceId = @A AND Result IN (N'Inside', N'Outside', N'Office', N'Uncertain') ORDER BY PointAt DESC, PointId DESC`)).recordset[0] || null;
}

const newId = async (pool, attendanceId, kind) => (await pool.request().input("A", sql.Int, attendanceId).input("K", sql.NVarChar(20), kind)
  .query("SELECT TOP 1 MovementId FROM dbo.EmployeeAttendanceMovement WHERE AttendanceId = @A AND Kind = @K ORDER BY MovementId DESC")).recordset[0]?.MovementId ?? null;

/** Close a trip; a very short one with no office visit is GPS drift — dismissed, not asked. */
async function closeTrip(pool, trip, at, c) {
  await close(pool, trip.MovementId, at);
  if (!(await hasAudit(pool))) return;
  await pool.request().input("Id", sql.Int, trip.MovementId).input("Min", sql.Int, Math.round(c.minTrip)).input("N", sql.NVarChar(300), `Under ${Math.round(c.minTrip / 60)} min outside with no office visit — treated as GPS drift`)
    .query(`UPDATE dbo.EmployeeAttendanceMovement SET AutoDismissed = 1, DismissNote = @N
            WHERE MovementId = @Id AND HasVisit = 0 AND Reason IS NULL AND DATEDIFF(second, StartAt, EndAt) < @Min`);
}

/**
 * Location points from the app. Processed in time order: unreliable points (poor accuracy, impossible speed) are
 * ignored, the rest classified Inside / Uncertain / Office / Outside; an Outside trip opens only after
 * ATTENDANCE_OUTSIDE_CONFIRM_POINTS reliable outside readings in a row (back-dated to the first), and is cancelled by
 * one reliable inside reading. The reply tells the app to take another reading when one is needed to decide.
 */
async function recordPoints(pool, employeeId, points) {
  const list = (Array.isArray(points) ? points : [points]).filter(Boolean).slice(0, 200)
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), acc: p.acc == null ? null : Number(p.acc), at: p.at ? new Date(p.at) : new Date() }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !Number.isNaN(+p.at))
    .sort((x, y) => x.at - y.at);
  const a = await openAttendance(pool, employeeId);
  if (!a) return { tracking: false, pending: await pending(pool, employeeId) };
  const c = cfg();
  const auditOn = await hasAudit(pool);
  const locs = await workLocations(pool, employeeId);
  const now = Date.now();
  let needFix = false;
  for (const p of list) {
    needFix = false; // only the newest point decides whether another reading is wanted
    if (p.at < new Date(a.InTime) || +p.at > now + 60_000) { await audit(pool, a, employeeId, p, null, "Ignored", "Outside the duty period"); continue; }
    if (p.acc != null && p.acc > maxAccuracy()) {
      await audit(pool, a, employeeId, p, null, "LowAccuracy", `±${Math.round(p.acc)} m is worse than ${maxAccuracy()} m`); needFix = true; continue;
    }
    const k = classify(locs, p.lat, p.lng, p.acc, c);
    if (auditOn) {
      const last = await lastReliable(pool, a.AttendanceId);
      if (last) {
        const secs = (p.at - new Date(last.PointAt)) / 1000;
        const metres = haversine(p.lat, p.lng, last.Lat, last.Lng);
        if (secs <= 0 && metres > 0) { await audit(pool, a, employeeId, p, k, "Ignored", "Older than the last reading"); continue; }
        const kmh = secs > 0 ? (metres / secs) * 3.6 : 0;
        if (kmh > c.maxSpeed && metres > (p.acc ?? 0) + 50) {
          await audit(pool, a, employeeId, p, k, "Jump", `${Math.round(metres)} m in ${Math.round(secs)} s = ${Math.round(kmh)} km/h (limit ${c.maxSpeed})`); needFix = true; continue;
        }
      }
    }
    const { trip, visit } = await openRows(pool, a.AttendanceId);
    if (k.result === "Uncertain") { await audit(pool, a, employeeId, p, k, "Uncertain", k.note); needFix = needFix || !trip; continue; }
    if (k.result === "Inside") {
      if (visit) await close(pool, visit.MovementId, p.at);
      if (trip) await closeTrip(pool, trip, p.at, c);
      await audit(pool, a, employeeId, p, k, "Inside", trip ? "Back inside — trip closed" : null, trip?.MovementId ?? null);
      continue;
    }
    // Outside or Office: record first, then confirm from the run of reliable readings.
    // An office reading is stored against that office (distance / radius of the office), so visits confirm per office.
    await audit(pool, a, employeeId, p, k.result === "Office" ? { location: k.office, distance: k.office.d, radius: k.office.r } : k, k.result,
      k.result === "Office" ? `Inside ${k.office.LocationName}` : `${Math.round(k.distance ?? 0)} m from ${k.location?.LocationName ?? "the office"} (±${Math.round(p.acc ?? 0)} m)`);
    const run = auditOn ? await streak(pool, a.AttendanceId) : [{ PointAt: p.at, Lat: p.lat, Lng: p.lng, AccuracyM: p.acc, DistanceM: k.distance, RadiusM: k.radius, Result: k.result }];
    const first = run[run.length - 1];
    let tripId = trip?.MovementId ?? null;
    if (!trip && !a.OnBreak && run.length >= c.confirm) {
      const accs = run.map((r) => Number(r.AccuracyM)).filter(Number.isFinite), dists = run.filter((r) => r.Result === "Outside").map((r) => Number(r.DistanceM)).filter(Number.isFinite);
      const note = `${run.length} consecutive reliable readings outside from ${new Date(first.PointAt).toISOString().slice(11, 16)} UTC`
        + (dists.length ? `; ${Math.round(Math.min(...dists))}–${Math.round(Math.max(...dists))} m from ${k.location?.LocationName ?? "the office"} (radius ${k.radius} m, outside line ${k.radius + c.outBuf} m)` : "")
        + (accs.length ? `; accuracy ±${Math.round(Math.min(...accs))}–${Math.round(Math.max(...accs))} m` : "");
      await open_(pool, a, employeeId, "Outside", new Date(first.PointAt), Number(first.Lat), Number(first.Lng), null, run.some((r) => r.Result === "Office") ? 1 : 0);
      tripId = await newId(pool, a.AttendanceId, "Outside");
      if (auditOn) await pool.request().input("Id", sql.Int, tripId).input("N", sql.NVarChar(400), note.slice(0, 400))
        .query("UPDATE dbo.EmployeeAttendanceMovement SET ConfirmNote = @N WHERE MovementId = @Id");
    } else if (!trip && !a.OnBreak) needFix = true; // an exit is pending — another reading decides it
    if (k.result === "Office") {
      // Visit: the last ATTENDANCE_VISIT_CONFIRM_POINTS reliable readings are all inside this same office.
      const recent = auditOn ? run.slice(0, c.visitConfirm) : [{ Result: "Office", LocationId: k.office.LocationId }];
      const sameOffice = recent.length >= (auditOn ? c.visitConfirm : 1) && recent.every((r) => r.Result === "Office" && r.LocationId === k.office.LocationId);
      if (visit && visit.LocationId !== k.office.LocationId) await close(pool, visit.MovementId, p.at);
      if ((!visit || visit.LocationId !== k.office.LocationId) && sameOffice) {
        await open_(pool, a, employeeId, "Visit", p.at, p.lat, p.lng, k.office.LocationId);
        if (tripId) await pool.request().input("Id", sql.Int, tripId).query("UPDATE dbo.EmployeeAttendanceMovement SET HasVisit = 1 WHERE MovementId = @Id");
      } else if (!sameOffice) needFix = true;
    } else if (visit) await close(pool, visit.MovementId, p.at);
  }
  // needFix: the app should take another reading soon (poor accuracy, a jump, an uncertain point or an unconfirmed exit).
  return { tracking: true, needFix, pending: await pending(pool, employeeId) };
}

/**
 * What the app must ask a reason for: finished Outside trips with no office visit, and any location-off spell (also
 * while still off). Skipped ones are not asked again — HR sees them highlighted.
 */
async function pending(pool, employeeId) {
  const r = await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT MovementId, Kind, StartAt, EndAt FROM dbo.EmployeeAttendanceMovement
    WHERE EmployeeId = @E AND Reason IS NULL AND Skipped = 0 AND StartAt >= DATEADD(day, -7, SYSUTCDATETIME())
      ${(await hasAudit(pool)) ? "AND AutoDismissed = 0" : ""}
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
           ${(await hasAudit(pool)) ? ", m.ConfirmNote, m.AutoDismissed, m.DismissNote" : ""}
    FROM dbo.EmployeeAttendanceMovement m LEFT JOIN dbo.WorkLocationMaster w ON w.LocationId = m.LocationId
    WHERE m.AttendanceId = @A ORDER BY m.StartAt, m.MovementId`);
  return r.recordset.map((x) => ({
    movementId: x.MovementId, kind: x.Kind, locationId: x.LocationId, locationName: x.LocationName || null,
    start: new Date(x.StartAt).toISOString(), end: x.EndAt ? new Date(x.EndAt).toISOString() : null,
    seconds: x.EndAt ? Math.max(0, Math.round((new Date(x.EndAt) - new Date(x.StartAt)) / 1000)) : null,
    hasVisit: !!x.HasVisit, reason: x.Reason || null, skipped: !!x.Skipped,
    confirmNote: x.ConfirmNote || null, autoDismissed: !!x.AutoDismissed, dismissNote: x.DismissNote || null,
    // Needs HR's eye: location switched off, or a trip outside without a reason (skipped or not given).
    alert: x.Kind === "LocationOff" || (x.Kind === "Outside" && !x.HasVisit && !x.Reason && !!x.EndAt && !x.AutoDismissed),
  }));
}

/** The raw location points of one attendance day (audit), for HR. */
async function points(pool, attendanceId) {
  if (!(await hasAudit(pool))) return [];
  const r = await pool.request().input("A", sql.Int, attendanceId).query(`
    SELECT p.PointId, CAST(p.Lat AS FLOAT) AS Lat, CAST(p.Lng AS FLOAT) AS Lng, p.AccuracyM, p.PointAt, p.LocationId, w.LocationName, p.DistanceM, p.RadiusM, p.Result, p.Note, p.MovementId
    FROM dbo.EmployeeLocationPoint p LEFT JOIN dbo.WorkLocationMaster w ON w.LocationId = p.LocationId WHERE p.AttendanceId = @A ORDER BY p.PointAt, p.PointId`);
  return r.recordset.map((x) => ({ pointId: x.PointId, lat: x.Lat, lng: x.Lng, accuracyM: x.AccuracyM == null ? null : Number(x.AccuracyM), at: new Date(x.PointAt).toISOString(),
    locationName: x.LocationName || null, distanceM: x.DistanceM == null ? null : Number(x.DistanceM), radiusM: x.RadiusM, result: x.Result, note: x.Note || null, movementId: x.MovementId }));
}

module.exports = { recordPoints, pending, locationStatus, skip, giveReason, closeAll, list, points, MovementError, classify };
