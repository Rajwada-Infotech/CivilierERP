const logger = require("./logger");
require("./config/env").loadEnv();
const sql = require("mssql");

// POOL_BURST: number of connections to pre-open at startup.
// On page load the app fires ~12-15 concurrent queries. Each connection beyond
// pool.min that hasn't been opened yet costs a full TDS handshake (~1-3 s over
// LAN), which is why every cold db.query was 1000-7000 ms even for trivial
// SELECT * queries. Setting min=15 and warming all 15 connections at startup
// means the pool is fully pre-heated before the first request arrives.
const POOL_BURST = 15;

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    packetSize: 32768,
  },
  pool: {
    max: 20,
    min: POOL_BURST, // keep POOL_BURST connections alive at all times
    idleTimeoutMillis: 60000, // raised: don't tear down connections after 30 s
    acquireTimeoutMillis: 10000,
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

module.exports = { sql, connectDB, getPool, getPoolStats, closeDB, isDbReady };
