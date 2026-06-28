const logger = require("./logger");
require("./config/env").loadEnv();
const sql = require("mssql");

function envBool(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

// POOL_BURST: connections to pre-open at startup.
// On page load the app fires ~12-15 concurrent queries per socket reconnect.
// min=15 keeps that many connections alive; max=30 gives headroom for burst
// storms without hitting the tarn "operation timed out" error seen at 08:22.
const POOL_BURST = 15;

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  options: {
    encrypt: envBool("DB_ENCRYPT", process.env.NODE_ENV === "production"),
    trustServerCertificate: envBool(
      "DB_TRUST_SERVER_CERTIFICATE",
      process.env.NODE_ENV !== "production",
    ),
    enableArithAbort: true,
    packetSize: 32768,
  },
  pool: {
    max: 30, // was 20 — raised to survive reconnect burst storms
    min: POOL_BURST, // keep POOL_BURST connections alive at all times
    idleTimeoutMillis: 60000,
    acquireTimeoutMillis: 15000, // was 10000 — extra 5 s for new connection handshake
    // propagateCreateError: if a brand-new connection can't be opened
    // (DB down, network blip), fail that one acquire fast instead of
    // tarn silently retrying forever and starving the queue behind it.
    propagateCreateError: true,
  },
  connectionTimeout: 30000,
  requestTimeout: 60000,
};

let pool = null;
let healthCheckInterval = null;
let reconnecting = false;

async function connectDB() {
  logger.info({ event: "DB_CONNECT_START" }, "Connecting to database");
  try {
    pool = await sql.connect(config);
    logger.info({ event: "DB_CONNECTED" }, "Database connected");

    pool.on("error", (err) => {
      logger.error({ event: "DB_POOL_ERROR", err }, "Connection pool error");
    });

    // Pre-warm the pool: fire POOL_BURST parallel no-op queries so the pool
    // opens all min connections before the first real request arrives.
    // Without this, node-mssql opens connections lazily — each cold open on
    // an already-busy pool costs a TDS handshake (~1-3 s), which is why
    // every cold db.query was 1000-7000 ms even for trivial SELECTs.
    await warmupPool(pool);

    startHealthWatchdog();

    return pool;
  } catch (err) {
    logger.error(
      { event: "DB_CONNECTION_FAILED", err },
      "Database connection failed",
    );
    throw err;
  }
}

// ── Pool health watchdog ──────────────────────────────────────────────────
// Root cause of the recurring "tarn operation timed out for an unknown
// reason" error: a connection's underlying TCP socket dies silently
// (idle-killed by SQL Server / a firewall NAT timeout / a transient
// network blip) without node-mssql noticing. tarn still believes that
// connection is healthy, hands it out on the next acquire, and the
// caller hangs until acquireTimeoutMillis — that hang is what surfaces
// as "login just spins" and "ticket escalation timed out".
//
// Fix: every 30s, run a trivial query through the pool. If it succeeds,
// the pool is healthy. If it fails or hangs, log pool stats (so we can
// see borrowed/pending counts at the moment of failure) and — if the
// pool looks fully exhausted/dead — tear it down and reconnect so the
// *next* real request gets a fresh pool instead of queuing behind a
// dead one.
const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 8000;

function startHealthWatchdog() {
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  healthCheckInterval = setInterval(async () => {
    if (!pool || reconnecting) return;

    const stats = getPoolStats(pool);
    try {
      await Promise.race([
        pool.request().query("SELECT 1 AS health"),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("health check timed out")),
            HEALTH_CHECK_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      logger.error(
        { event: "DB_POOL_UNHEALTHY", err, stats },
        "Pool health check failed — pool may be exhausted or holding dead connections",
      );

      // Only force a reconnect if the pool is actually maxed out and
      // stuck (borrowed === size, requests piling up in `pending`).
      // A single slow query shouldn't trigger a full pool teardown.
      if (stats && stats.borrowed >= stats.size && stats.pending > 0) {
        await forceReconnect();
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function forceReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  logger.warn(
    { event: "DB_POOL_FORCE_RECONNECT" },
    "Pool appears exhausted/dead — closing and reconnecting",
  );
  try {
    const dead = pool;
    pool = null;
    await dead.close().catch(() => {});
    await connectDB();
  } catch (err) {
    logger.error(
      { event: "DB_POOL_RECONNECT_FAILED", err },
      "Failed to reconnect pool after forced close",
    );
  } finally {
    reconnecting = false;
  }
}

async function warmupPool(p) {
  try {
    logger.info(
      { event: "DB_WARMUP_START", connections: POOL_BURST },
      "Pre-warming connection pool",
    );
    await Promise.all(
      Array.from({ length: POOL_BURST }, () =>
        p
          .request()
          .query("SELECT 1 AS warmup")
          .catch(() => {}),
      ),
    );
    logger.info({ event: "DB_WARMUP_DONE" }, "Connection pool pre-warmed");
  } catch {
    // warmup failure is non-fatal — server still starts
    logger.warn(
      { event: "DB_WARMUP_FAILED" },
      "Pool warmup failed — connections will open lazily",
    );
  }
}

function getPool() {
  if (!pool)
    throw new Error("DB pool not initialized. Call connectDB() first.");
  return pool;
}

function getPoolStats(targetPool = pool) {
  if (!targetPool) return null;

  return {
    size: targetPool.size,
    available: targetPool.available,
    borrowed: targetPool.borrowed,
    pending: targetPool.pending,
  };
}

async function closeDB() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
  if (!pool) return;

  const currentPool = pool;
  pool = null;
  await currentPool.close();
  logger.info({ event: "DB_CLOSED" }, "Database pool closed");
}

async function isDbReady() {
  try {
    const pool = getPool();
    await pool.request().query("SELECT 1 AS ok");
    return true;
  } catch (err) {
    logger.warn(
      { event: "DB_HEALTH_CHECK_FAILED", err },
      "Database readiness check failed",
    );
    return false;
  }
}

module.exports = {
  sql,
  connectDB,
  getPool,
  getPoolStats,
  closeDB,
  isDbReady,
  queryWithRetry,
};

// Retry a DB operation up to `retries` times on transient connection failures.
// Usage: await queryWithRetry(pool, req => req.input(...).query(...))
function isTransientSqlError(err) {
  const code = String(err?.code || "").toUpperCase();
  const message = String(err?.message || "").toUpperCase();
  const transientCodes = new Set([
    "ECONNRESET",
    "ETIMEDOUT",
    "ESOCKET",
    "ECONNCLOSED",
    "ECONNREFUSED",
    "ETIMEOUT",
  ]);

  return (
    transientCodes.has(code) ||
    err?.name === "TimeoutError" ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ESOCKET") ||
    message.includes("TIMEOUT") ||
    message.includes("TIMED OUT") ||
    message.includes("CONNECTION IS CLOSED") ||
    message.includes("ACQUIRE TIMEOUT")
  );
}

async function queryWithRetry(poolOrFn, fn, retries = 2) {
  // Support both queryWithRetry(pool, fn) and queryWithRetry(fn) signatures
  if (typeof poolOrFn === "function") {
    fn = poolOrFn;
    poolOrFn = null;
  }
  const getP = () => poolOrFn || getPool();
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn(getP().request());
    } catch (err) {
      if (i < retries && isTransientSqlError(err)) {
        logger.warn(
          { event: "DB_ECONNRESET_RETRY", attempt: i + 1, retries },
          "ECONNRESET — retrying query",
        );
        continue;
      }
      throw err;
    }
  }
}