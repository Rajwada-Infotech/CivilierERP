#!/usr/bin/env node
"use strict";

/**
 * Patrol rounds for testing the Civilier Security app's Patrol pages: a few rounds for one guard today and yesterday,
 * each with a walked route (location pings) around the guard's gate. Development / test databases only — refuses to
 * run when NODE_ENV is "production".
 *
 *   node scripts/seed-security-patrols.js                     seed for "Guard One (test)"
 *   node scripts/seed-security-patrols.js --guard "Name"      another guard (by user name)
 *   node scripts/seed-security-patrols.js --remove            delete the seeded rounds and their pings
 *
 * Seeded rows are marked: rounds by an AccuracyM of 4.2 on their pings (a value real phones don't report exactly), so
 * --remove deletes only seeded pings and the rounds that cover them.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { connectDB, getPool, sql } = require("../db");
const tracking = require("../services/securityTracking");

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed test patrols on a production database.");
  process.exit(1);
}

const args = process.argv.slice(2);
const REMOVE = args.includes("--remove");
const gi = args.indexOf("--guard");
const GUARD = gi >= 0 ? args[gi + 1] : "Guard One (test)";
const MARK = 4.2;

// Rounds: [days ago, start hour (phone's local time), minutes walked, size (share of the largest loop that fits inside
// the zone), one stretch outside the zone?]
const ROUNDS = [
  [0, 9, 35, 0.8, false],
  [0, 12, 25, 0.6, true],
  [0, 15, 40, 0.9, false],
  [1, 10, 30, 0.75, false],
  [1, 14, 45, 0.95, true],
  [1, 19, 20, 0.5, false],
];
// The loop: out from the gate and back, a rounded rectangle (x east, y north, metres).
const loopAt = (t, reach) => [Math.cos(t * 2 * Math.PI) * reach - reach, Math.sin(t * 2 * Math.PI) * reach * 0.6];

async function main() {
  await connectDB();
  const pool = getPool();
  const guard = (await pool.request().input("n", sql.NVarChar(200), GUARD).query("SELECT TOP 1 id, name FROM dbo.users WHERE name = @n")).recordset[0];
  if (!guard) throw new Error(`No user named "${GUARD}".`);

  if (REMOVE) {
    const r = await pool.request().input("g", sql.Int, guard.id).input("m", sql.Decimal(7, 1), MARK).query(`
      DELETE p FROM dbo.SecurityPatrol p
      WHERE p.GuardUserId = @g AND EXISTS (SELECT 1 FROM dbo.SecurityGuardPing x WHERE x.GuardUserId = @g AND x.AccuracyM = @m
        AND x.PingAt >= p.StartedAt AND x.PingAt <= ISNULL(p.EndedAt, p.StartedAt));
      DECLARE @rounds INT = @@ROWCOUNT;
      DELETE FROM dbo.SecurityGuardPing WHERE GuardUserId = @g AND AccuracyM = @m;
      SELECT @rounds AS rounds, @@ROWCOUNT AS pings;`);
    console.log(`Removed ${r.recordset[0].rounds} rounds and ${r.recordset[0].pings} pings for ${guard.name}.`);
    return;
  }

  const gate = (
    await pool.request().input("g", sql.Int, guard.id).query(`
      SELECT TOP 1 g.GateId, g.ProjectId, g.Name, CAST(g.Latitude AS FLOAT) AS lat, CAST(g.Longitude AS FLOAT) AS lng
      FROM dbo.SecurityGuardAssignment a JOIN dbo.SecurityGate g ON g.GateId = a.GateId
      WHERE a.GuardUserId = @g AND a.IsActive = 1 ORDER BY a.EffectiveFrom DESC`)
  ).recordset[0];
  if (!gate) throw new Error(`${guard.name} isn't assigned to a gate.`);
  if (gate.lat == null || gate.lng == null) throw new Error(`Gate "${gate.Name}" has no location. Set it in Maintenance → Security Gates.`);
  const zones = (
    await pool.request().input("p", sql.Int, gate.ProjectId).input("gate", sql.Int, gate.GateId).query(`
      SELECT * FROM dbo.SecurityGeofenceZone WHERE IsActive = 1 AND ProjectId = @p AND (GateId = @gate OR GateId IS NULL)`)
  ).recordset.map(tracking.prepareZone);

  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((gate.lat * Math.PI) / 180));
  // The largest loop (up to 250 m out) whose every point is inside the zone; without a zone, 150 m.
  const inside = (reach) => {
    for (let i = 0; i <= 60; i++) {
      const [x, y] = loopAt(i / 60, reach);
      if (!tracking.judge(gate.lat + y * mLat, gate.lng + x * mLng, zones).inZone) return false;
    }
    return true;
  };
  let fit = 150;
  if (zones.length) {
    fit = 250;
    while (fit > 10 && !inside(fit)) fit *= 0.85;
  }
  let rounds = 0;
  let pings = 0;
  for (const [daysAgo, hour, minutes, size, strays] of ROUNDS) {
    const reach = fit * size;
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + minutes * 60000);
    if (end > new Date()) continue; // not walked yet today

    // A loop out from the gate and back: a rounded rectangle, a little wobble, a reading every 10 s.
    const n = Math.round((minutes * 60) / 10);
    const rows = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let [x, y] = loopAt(t, reach);
      if (strays && t > 0.4 && t < 0.5) x -= fit * 1.2 * Math.sin(((t - 0.4) / 0.1) * Math.PI); // wanders out and back
      x += (Math.random() - 0.5) * 6;
      y += (Math.random() - 0.5) * 6;
      const lat = gate.lat + y * mLat;
      const lng = gate.lng + x * mLng;
      const j = zones.length ? tracking.judge(lat, lng, zones) : { inZone: null, zoneId: null, cell: null };
      rows.push({ at: new Date(start.getTime() + i * 10000), lat, lng, j, bat: Math.max(20, 90 - Math.round(t * 5)) });
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await tx.request().input("g", sql.Int, guard.id).input("gate", sql.Int, gate.GateId).input("p", sql.Int, gate.ProjectId)
        .input("s", sql.DateTime2, start).input("e", sql.DateTime2, end).query(`
          INSERT INTO dbo.SecurityPatrol (GuardUserId, GateId, ProjectId, StartedAt, EndedAt) VALUES (@g, @gate, @p, @s, @e)`);
      const table = new sql.Table("dbo.SecurityGuardPing");
      table.create = false;
      table.columns.add("GuardUserId", sql.Int, { nullable: false });
      table.columns.add("PingAt", sql.DateTime2(3), { nullable: false });
      table.columns.add("Latitude", sql.Decimal(9, 6), { nullable: false });
      table.columns.add("Longitude", sql.Decimal(9, 6), { nullable: false });
      table.columns.add("AccuracyM", sql.Decimal(7, 1), { nullable: true });
      table.columns.add("BatteryPct", sql.TinyInt, { nullable: true });
      table.columns.add("H3Cell", sql.NVarChar(16), { nullable: true });
      table.columns.add("ZoneId", sql.Int, { nullable: true });
      table.columns.add("InZone", sql.Bit, { nullable: true });
      for (const r of rows) table.rows.add(guard.id, r.at, r.lat.toFixed(6), r.lng.toFixed(6), MARK, r.bat, r.j.cell, r.j.zoneId, r.j.inZone);
      await tx.request().bulk(table);
      await tx.commit();
      rounds += 1;
      pings += rows.length;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }
  console.log(`Seeded ${rounds} patrol rounds (${pings} pings) for ${guard.name} around ${gate.Name}. Remove with --remove.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
