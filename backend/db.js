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
  },
  connectionTimeout: 30000,
  requestTimeout: 30000,
};

let pool = null;

async function connectDB() {
  logger.info({ event: "DB_CONNECT_START" }, "Connecting to database");
  try {
    pool = await sql.connect(config);
    logger.info({ event: "DB_CONNECTED" }, "Database connected");

    // Pre-warm the pool: fire POOL_BURST parallel no-op queries so the pool
    // opens all min connections before the first real request arrives.
    // Without this, node-mssql opens connections lazily — each cold open on
    // an already-busy pool costs a TDS handshake (~1-3 s), which is why
    // every cold db.query was 1000-7000 ms even for trivial SELECTs.
    await warmupPool(pool);

    return pool;
  } catch (err) {
    logger.error(
      { event: "DB_CONNECTION_FAILED", err },
      "Database connection failed",
    );
    throw err;
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

// Retry a DB operation up to `retries` times on ECONNRESET.
// Usage: await queryWithRetry(pool, req => req.input(...).query(...))
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
      const isReset =
        err.code === "ECONNRESET" ||
        (err.message && err.message.includes("ECONNRESET"));
      if (i < retries && isReset) {
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
