"use strict";

/**
 * backend/services/workerRetentionService.js
 *
 * Civil Work DPR's Worker Attendance module: most workers logged here are
 * casual/temporary labour hired for a handful of days, not a stable crew.
 * dbo.Worker still gives each of them a real identity (keyed off Aadhaar
 * number as of migration 381) so attendance can be searched/summarized per
 * person while they're actually working -- but that identity has no
 * business persisting forever once they've moved on. A Worker with no
 * WorkerAttendance row in the last RETENTION_MONTHS is purged outright,
 * along with their attendance history and activity-roster membership. If
 * the same person shows up again later, they're registered fresh -- this
 * never tries to resurrect or merge into a deleted row.
 */

const logger = require("../logger");
const { getPool, sql } = require("../db");

const RETENTION_MONTHS = 4;

async function purgeStaleWorkers(pool) {
  const stale = await pool.request().input("months", sql.Int, RETENTION_MONTHS).query(`
    SELECT w.WorkerId
    FROM dbo.Worker w
    WHERE NOT EXISTS (
      SELECT 1 FROM dbo.WorkerAttendance wa
      WHERE wa.WorkerId = w.WorkerId
        AND wa.AttendanceDate >= DATEADD(month, -@months, CAST(SYSDATETIME() AS DATE))
    )
    AND w.CreatedAt < DATEADD(month, -@months, SYSDATETIME())
  `);

  const workerIds = stale.recordset.map((r) => r.WorkerId);
  if (!workerIds.length) return 0;

  const idList = workerIds.join(",");
  // No FK cascade on WorkerAttendance/WorkerActivityRoster -> Worker, so
  // their rows have to go first or the Worker delete below violates the FK.
  await pool.request().query(`DELETE FROM dbo.WorkerAttendance WHERE WorkerId IN (${idList})`);
  await pool.request().query(`DELETE FROM dbo.WorkerActivityRoster WHERE WorkerId IN (${idList})`);
  await pool.request().query(`DELETE FROM dbo.Worker WHERE WorkerId IN (${idList})`);

  return workerIds.length;
}

async function runWorkerRetentionJob(options = {}) {
  const pool = options.pool || getPool();
  try {
    const purged = await purgeStaleWorkers(pool);
    if (purged > 0) {
      logger.info(
        { event: "WORKER_RETENTION_PURGED", purged },
        `Purged ${purged} worker(s) with no attendance in the last ${RETENTION_MONTHS} months`,
      );
    }
    return { purged };
  } catch (err) {
    logger.error(
      { event: "WORKER_RETENTION_ERROR", err },
      "runWorkerRetentionJob failed",
    );
    throw err;
  }
}

module.exports = { runWorkerRetentionJob, RETENTION_MONTHS };
