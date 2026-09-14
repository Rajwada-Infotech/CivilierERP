"use strict";

const logger = require("./logger");
const { getRedis } = require("./redis");
const { runTicketEscalationJob } = require("./services/ticketEscalationService");
const { runRecordsRetentionJob } = require("./services/recordsRetentionService");
const { runWorkerRetentionJob } = require("./services/workerRetentionService");

let workerInterval = null;
let ticketEscalationInterval = null;
let recordsRetentionInterval = null;
let workerRetentionInterval = null;
let workerRunning = false;

const RECORDS_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day is plenty for a 7-day grace window
const WORKER_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day is plenty for a 4-month window

function getTicketEscalationIntervalMs() {
  const configured = Number(process.env.TICKET_ESCALATION_INTERVAL_MS);
  return Number.isInteger(configured) && configured > 0
    ? configured
    : 5 * 60 * 1000;
}

async function decayEngagement() {
  try {
    const redis = await getRedis();
    const members = await redis.zrangebyscore(
      "engagement:score",
      "-inf",
      "+inf",
      "WITHSCORES",
    );
    if (!members || members.length === 0) return;

    const pipeline = redis.pipeline();
    for (let i = 0; i < members.length; i += 2) {
      const member = members[i];
      const score = parseFloat(members[i + 1]);
      const decayed = score * 0.9;
      if (decayed < 1) {
        pipeline.zrem("engagement:score", member);
      } else {
        pipeline.zadd("engagement:score", decayed, member);
      }
    }
    await pipeline.exec();
    logger.info(
      { event: "WORKER_DECAY_DONE", count: members.length / 2 },
      "Engagement decay complete",
    );
  } catch (err) {
    logger.error(
      { event: "WORKER_DECAY_ERROR", err },
      "decayEngagement failed",
    );
  }
}

async function cleanupInactiveUsers() {
  try {
    const redis = await getRedis();
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const keys = await redis.keys("engagement:last:*");
    if (!keys || keys.length === 0) return;

    const pipeline = redis.pipeline();
    keys.forEach((k) => pipeline.get(k));
    const results = await pipeline.exec();

    const removePipeline = redis.pipeline();
    let removed = 0;
    keys.forEach((key, idx) => {
      const ts = parseInt(results[idx][1], 10);
      if (!ts || ts < cutoff) {
        const userId = key.replace("engagement:last:", "");
        removePipeline.del(key);
        removePipeline.zrem("engagement:score", userId);
        removed++;
      }
    });

    if (removed > 0) await removePipeline.exec();
    logger.info(
      { event: "WORKER_CLEANUP_DONE", removed },
      "Inactive user cleanup complete",
    );
  } catch (err) {
    logger.error(
      { event: "WORKER_CLEANUP_ERROR", err },
      "cleanupInactiveUsers failed",
    );
  }
}

async function startWorker() {
  if (workerRunning) return;
  workerRunning = true;

  logger.info({ event: "WORKER_STARTED" }, "Redis Worker starting — decay & cleanup every hour");

  try {
    logger.info({ event: "WORKER_INIT" }, "Running initial decay & cleanup...");
    await decayEngagement();
    await cleanupInactiveUsers();
    await runTicketEscalationJob();
    await runRecordsRetentionJob();
    await runWorkerRetentionJob();
    logger.info({ event: "WORKER_INIT_DONE" }, "Initial decay & cleanup complete");
  } catch (err) {
    logger.error({ event: "WORKER_INIT_ERROR", err }, "Worker init failed");
  }

  workerInterval = setInterval(async () => {
    try {
      const redis = await getRedis();
      await redis.set("worker:heartbeat", Date.now(), "EX", 7200);
      logger.debug({ event: "WORKER_HEARTBEAT" }, "Worker heartbeat sent");

      logger.info({ event: "WORKER_DECAY_START" }, "Running engagement decay...");
      await decayEngagement();

      logger.info(
        { event: "WORKER_CLEANUP_START" },
        "Running inactive user cleanup...",
      );
      await cleanupInactiveUsers();
    } catch (err) {
      logger.error({ event: "WORKER_ERROR", err }, "Worker interval crashed");
    }
  }, 3600000);

  ticketEscalationInterval = setInterval(async () => {
    try {
      await runTicketEscalationJob();
    } catch (err) {
      const isPoolTimeout =
        err?.name === "TimeoutError" ||
        /operation timed out/i.test(err?.message || "");

      logger.error(
        { event: "WORKER_TICKET_ESCALATION_ERROR", err, isPoolTimeout },
        isPoolTimeout
          ? "Ticket escalation interval crashed — DB connection pool did not " +
              "hand out a connection in time (pool likely exhausted or " +
              "holding a dead connection). The pool health watchdog in " +
              "db.js should recover this automatically within ~30s; if it " +
              "recurs constantly, check DB_SERVER reachability and pool " +
              "stats via getPoolStats()."
          : "Ticket escalation interval crashed",
      );
    }
  }, getTicketEscalationIntervalMs());

  recordsRetentionInterval = setInterval(async () => {
    try {
      await runRecordsRetentionJob();
    } catch (err) {
      logger.error(
        { event: "WORKER_RECORDS_RETENTION_ERROR", err },
        "Records retention interval crashed",
      );
    }
  }, RECORDS_RETENTION_INTERVAL_MS);

  workerRetentionInterval = setInterval(async () => {
    try {
      await runWorkerRetentionJob();
    } catch (err) {
      logger.error(
        { event: "WORKER_LABOUR_RETENTION_ERROR", err },
        "Labour worker retention interval crashed",
      );
    }
  }, WORKER_RETENTION_INTERVAL_MS);
}

function stopWorker() {
  if (!workerRunning) return;
  clearInterval(workerInterval);
  clearInterval(ticketEscalationInterval);
  clearInterval(recordsRetentionInterval);
  clearInterval(workerRetentionInterval);
  workerInterval = null;
  ticketEscalationInterval = null;
  recordsRetentionInterval = null;
  workerRetentionInterval = null;
  workerRunning = false;
  logger.info({ event: "WORKER_STOPPED" }, "Redis worker stopped");
}

function isRunning() {
  return workerRunning;
}

module.exports = { startWorker, stopWorker, isRunning };
