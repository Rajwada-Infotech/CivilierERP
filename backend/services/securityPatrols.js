"use strict";

/**
 * Patrol rounds: a guard on shift starts a patrol and ends it when the round is done (dbo.SecurityPatrol, migration
 * 718). The route is the guard's own location pings between the two times (dbo.SecurityGuardPing). A round left open
 * counts as ended 4 hours after it started, and starting a new round ends the open one.
 */
const { sql } = require("../db");
const { projectPredicate } = require("./projectScope");
const tracking = require("./securityTracking");

const MAX_HOURS = 4;
// When a round ended: its end, or 4 hours after the start if it was left open that long, else still going (NULL).
const ENDED = `COALESCE(p.EndedAt, CASE WHEN p.StartedAt < DATEADD(HOUR, -${MAX_HOURS}, SYSUTCDATETIME()) THEN DATEADD(HOUR, ${MAX_HOURS}, p.StartedAt) END)`;
const SELECT = `
  SELECT p.PatrolId AS id, p.GuardUserId AS guardUserId, u.name AS guardName, p.GateId AS gateId, g.Name AS gateName,
         p.ProjectId AS projectId, p.StartedAt AS startedAt, ${ENDED} AS endedAt
  FROM dbo.SecurityPatrol p
  JOIN dbo.SecurityGate g ON g.GateId = p.GateId
  LEFT JOIN dbo.users u ON u.id = p.GuardUserId`;

/** The guard's round still going, or null. */
async function currentPatrol(pool, guardUserId) {
  return (
    (await pool.request().input("g", sql.Int, guardUserId).query(`${SELECT} WHERE p.GuardUserId = @g AND ${ENDED} IS NULL ORDER BY p.StartedAt DESC`))
      .recordset[0] || null
  );
}

/** Starts a round at the guard's gate (ending one still open). */
async function startPatrol(pool, guardUserId, gateId, projectId) {
  await endOpen(pool, guardUserId);
  const id = (
    await pool.request().input("g", sql.Int, guardUserId).input("gate", sql.Int, gateId).input("p", sql.Int, projectId).query(`
      INSERT INTO dbo.SecurityPatrol (GuardUserId, GateId, ProjectId) OUTPUT INSERTED.PatrolId AS id VALUES (@g, @gate, @p)`)
  ).recordset[0].id;
  return currentPatrol(pool, guardUserId).then((p) => p || { id });
}

/** Ends the guard's open round(s); a round left past 4 hours ends at the 4-hour mark. */
async function endOpen(pool, guardUserId) {
  await pool.request().input("g", sql.Int, guardUserId).query(`
    UPDATE dbo.SecurityPatrol
    SET EndedAt = CASE WHEN StartedAt < DATEADD(HOUR, -${MAX_HOURS}, SYSUTCDATETIME()) THEN DATEADD(HOUR, ${MAX_HOURS}, StartedAt) ELSE SYSUTCDATETIME() END
    WHERE GuardUserId = @g AND EndedAt IS NULL`);
}

/** Rounds at these projects started between two times, newest first. */
async function patrolsIn(pool, projectIds, from, to) {
  const rows = (
    await pool.request().input("f", sql.DateTime2, from).input("t", sql.DateTime2, to).query(`
      ${SELECT} WHERE p.StartedAt >= @f AND p.StartedAt <= @t ${projectPredicate(projectIds, "p.ProjectId")} ORDER BY p.StartedAt DESC`)
  ).recordset;
  return rows;
}

/** One round, only when it is at one of these projects (null otherwise). */
async function patrolAt(pool, patrolId, projectIds) {
  return (
    (await pool.request().input("id", sql.Int, patrolId).query(`${SELECT} WHERE p.PatrolId = @id ${projectPredicate(projectIds, "p.ProjectId")}`)).recordset[0] ||
    null
  );
}

/** The route of one round (until now while it is still going). */
async function patrolTrail(pool, patrol) {
  const trail = await tracking.trailFor(pool, patrol.guardUserId, new Date(patrol.startedAt), patrol.endedAt ? new Date(patrol.endedAt) : new Date());
  // Residents see the route, not the phone's battery or accuracy.
  return { ...trail, points: trail.points.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, inZone: p.inZone })) };
}

module.exports = { MAX_HOURS, currentPatrol, startPatrol, endOpen, patrolsIn, patrolAt, patrolTrail };
