const logger = require("./logger");
require("dotenv").config();
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
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
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
      "Database connection failed"
    );
    throw err;
  }
}

function getPool() {
  if (!pool) throw new Error("DB pool not initialized. Call connectDB() first.");
  return pool;
}

module.exports = { sql, connectDB, getPool };
