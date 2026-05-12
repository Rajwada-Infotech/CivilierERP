const logger = require("./logger");
require("./config/env").loadEnv();
const sql = require("mssql");

const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    // FIX: increase TDS packet size (default 4096) for large result sets
    // over LAN. Larger packets = fewer round-trips for the same data.
    // 32768 is the maximum SQL Server supports.
    packetSize: 32768,
  },
  pool: {
    max: 20, // FIX: was 10 — with LAN latency, 10 connections saturate fast
    min: 2, // keep 2 warm connections so cold starts don't queue
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 10000, // fail fast if pool exhausted
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
    return pool;
  } catch (err) {
    logger.error(
      { event: "DB_CONNECTION_FAILED", err },
      "Database connection failed",
    );
    throw err;
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
