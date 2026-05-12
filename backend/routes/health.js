const express = require("express");
const router = express.Router();
const logger = require("../logger");
const { isDbReady, getPoolStats } = require("../db");
const { isRedisReady } = require("../redis");
const worker = require("../worker");

router.get("/", (_req, res) => {
  res.json({ status: "ok", name: "CivilierERP API" });
});

router.get("/live", (req, res) => {
  res.json({
    status: "alive",
    env: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.round(process.uptime()),
    requestId: req.id,
  });
});

router.get("/startup", (req, res) => {
  res.json({
    status: "ok",
    startedAt: req.app.locals.startupTime || null,
    uptimeSeconds: Math.round(process.uptime()),
    requestId: req.id,
  });
});

router.get("/ready", async (req, res) => {
  const [dbOk, redisOk] = await Promise.all([isDbReady(), isRedisReady()]);
  const poolStats = getPoolStats();
  const workerOk = worker.isRunning();

  const details = {
    db: dbOk ? "ok" : "fail",
    redis: redisOk ? "ok" : "fail",
    worker: workerOk ? "ok" : "fail",
    pool: poolStats,
  };

  const ready = dbOk && redisOk && workerOk;
  const statusCode = ready ? 200 : 503;

  logger.debug(
    { event: "HEALTH_READY_CHECK", requestId: req.id, details },
    "Health readiness check",
  );

  return res.status(statusCode).json({
    status: ready ? "ok" : "fail",
    details,
    requestId: req.id,
  });
});

module.exports = router;
