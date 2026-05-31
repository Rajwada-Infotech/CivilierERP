const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, validate: false }));
const logger = require("../logger");
const { isDbReady } = require("../db");
const { isRedisReady } = require("../redis");
const worker = require("../worker");

// ─── Internal-only middleware ─────────────────────────────────────────────────
// /health/ready and /health/startup expose service-level detail that is useful
// for orchestrators (K8s, Render health checks) but must not be public.
// Protect them with a static bearer token set in HEALTH_TOKEN.
// Kubernetes / Render: set the token in the probe's httpHeaders config.
// If HEALTH_TOKEN is not configured the endpoints return 503 immediately —
// fail-safe: misconfigured infra should never silently expose internals.
function requireHealthToken(req, res, next) {
  const expected = process.env.HEALTH_TOKEN;

  if (!expected) {
    logger.warn(
      { event: "HEALTH_TOKEN_MISSING" },
      "HEALTH_TOKEN not set — blocking detail health endpoint",
    );
    return res.status(503).json({ error: "Health check not configured" });
  }

  const provided = req.headers["x-health-token"] ?? req.query.token;
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// GET /health — minimal public ping (name only, no env or infra data)
router.get("/", (_req, res) => {
  res.json({ status: "ok", name: "CivilierERP API" });
});

// GET /health/live — liveness probe (no NODE_ENV, no internal details)
// Safe to be public: only tells the load balancer the process is alive.
router.get("/live", (req, res) => {
  res.json({
    status: "alive",
    uptimeSeconds: Math.round(process.uptime()),
    requestId: req.id,
  });
});

// GET /health/startup — guarded: reveals startup timestamp (internal use)
router.get("/startup", requireHealthToken, (req, res) => {
  res.json({
    status: "ok",
    startedAt: req.app.locals.startupTime || null,
    uptimeSeconds: Math.round(process.uptime()),
    requestId: req.id,
  });
});

// GET /health/ready — guarded: reveals per-service status (internal use only)
// Returns boolean ok/fail per dependency — no pool sizes, no raw stats.
// Pool statistics are available in the metrics dashboard for authenticated users.
router.get("/ready", requireHealthToken, async (req, res) => {
  const [dbOk, redisOk] = await Promise.all([isDbReady(), isRedisReady()]);
  const workerOk = worker.isRunning();

  // Pool stats are deliberately excluded from this response.
  // They include connection counts that reveal infrastructure capacity;
  // use GET /api/admin/metrics (authenticated) for that data.
  const details = {
    db: dbOk ? "ok" : "fail",
    redis: redisOk ? "ok" : "fail",
    worker: workerOk ? "ok" : "fail",
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



