"use strict";
/** Geofence check against the employee's assigned Work Locations (Work Location Master + EmployeeWorkLocation). */
const { sql } = require("../../db");

const R = 6371008.8; // mean Earth radius, metres
const rad = (d) => (d * Math.PI) / 180;
/** Haversine distance in metres. */
function haversine(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const maxAccuracy = () => Number(process.env.ATTENDANCE_GPS_MAX_ACCURACY_M) || 100;

/**
 * { ok, location, distanceM, accuracyM, reason } — ok when the point is inside at least one assigned, active location's
 * radius and the reported GPS accuracy is good enough. The nearest location is reported either way.
 */
async function checkGeofence(pool, employeeId, { lat, lng, acc }) {
  const locs = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT w.LocationId, w.LocationName, CAST(w.Latitude AS FLOAT) AS Lat, CAST(w.Longitude AS FLOAT) AS Lng, w.RadiusMeters
    FROM dbo.EmployeeWorkLocation x JOIN dbo.WorkLocationMaster w ON w.LocationId = x.LocationId AND w.IsActive = 1
    WHERE x.EmployeeId = @E`)).recordset;
  if (!locs.length) return { ok: false, reason: "No work location is assigned to you. Ask HR to add one in Employee Master." };
  if (acc == null || acc > maxAccuracy()) {
    return { ok: false, accuracyM: acc, reason: `Your GPS signal is too weak (±${acc ?? "?"} m, needs ±${maxAccuracy()} m or better). Move to an open area and try again.` };
  }
  const ranked = locs.map((l) => ({ ...l, d: haversine(lat, lng, l.Lat, l.Lng) })).sort((a, b) => a.d - b.d);
  const inside = ranked.find((l) => l.d <= l.RadiusMeters);
  const near = inside || ranked[0];
  const distanceM = Math.round(near.d);
  if (!inside) return { ok: false, location: near, distanceM, accuracyM: acc, reason: `You are ${distanceM} m from ${near.LocationName} (allowed ${near.RadiusMeters} m). Punch from your work location.` };
  return { ok: true, location: inside, distanceM, accuracyM: acc };
}

module.exports = { haversine, checkGeofence };
