"use strict";

/**
 * backend/migrate.js
 *
 * Run with:
 *   node migrate.js up        — apply all pending migrations
 *   node migrate.js down      — roll back the last applied migration
 *   node migrate.js status    — list applied / pending migrations
 *   node migrate.js up --to 010-brs-index.sql   — apply up to a specific file
 *
 * Tracking table: dbo.__Migrations  (created automatically on first run)
 */

require("./config/env").loadEnv(); // loads backend/.env via dotenv
const path  = require("path");
const fs    = require("fs");
const { Umzug, memoryStorage } = require("umzug");
const sql   = require("mssql");
const logger = require("./logger");

// ─── DB pool (reuse config/db.js pattern) ────────────────────────────────────
const dbConfig = {
  server:   process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port:     parseInt(process.env.DB_PORT || "1433", 10),
  options: {
    encrypt:              process.env.DB_ENCRYPT === "true",
    trustServerCertificate: true,
  },
  pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
};

// ─── Custom MSSQL storage  ────────────────────────────────────────────────────
// Umzug's built-in storages target SQLite/Postgres; we wire our own for MSSQL.
function makeMssqlStorage(getPool) {
  const TABLE = "dbo.__Migrations";

  async function ensureTable(pool) {
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = '__Migrations'
      )
      CREATE TABLE ${TABLE} (
        name        NVARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
      );
    `);
  }

  return {
    async logMigration({ name }) {
      const pool = await getPool();
      await ensureTable(pool);
      await pool.request()
        .input("name", sql.NVarChar(255), name)
        .query(`INSERT INTO ${TABLE} (name) VALUES (@name)`);
    },
    async unlogMigration({ name }) {
      const pool = await getPool();
      await ensureTable(pool);
      await pool.request()
        .input("name", sql.NVarChar(255), name)
        .query(`DELETE FROM ${TABLE} WHERE name = @name`);
    },
    async executed() {
      const pool = await getPool();
      await ensureTable(pool);
      const result = await pool.request()
        .query(`SELECT name FROM ${TABLE} ORDER BY name ASC`);
      return result.recordset.map((r) => r.name);
    },
  };
}

// ─── Pool singleton ───────────────────────────────────────────────────────────
let _pool = null;
async function getPool() {
  if (!_pool) _pool = await sql.connect(dbConfig);
  return _pool;
}

// ─── Build umzug instance ─────────────────────────────────────────────────────
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

const umzug = new Umzug({
  migrations: {
    // Glob all *.sql files; umzug sorts by name so NNN- prefix keeps order.
    glob: ["*.sql", { cwd: MIGRATIONS_DIR }],

    resolve({ name, path: filePath }) {
      return {
        name,
        up: async () => {
          const pool = await getPool();
          const raw  = fs.readFileSync(filePath, "utf8");

          // Split on GO (T-SQL batch separator) so multi-batch files work.
          const batches = raw
            .split(/^\s*GO\s*$/im)
            .map((b) => b.trim())
            .filter(Boolean);

          for (const batch of batches) {
            await pool.request().query(batch);
          }
          logger.info({ migration: name }, "Migration applied");
        },
        // No down scripts — add them when needed per migration.
        down: async () => {
          logger.warn({ migration: name }, "No down migration defined — skipping");
        },
      };
    },
  },

  storage: makeMssqlStorage(getPool),

  logger: {
    info:  (msg) => logger.info(msg),
    warn:  (msg) => logger.warn(msg),
    error: (msg) => logger.error(msg),
    debug: (msg) => logger.debug(msg),
  },
});

// ─── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  const [,, command = "status", ...rest] = process.argv;

  try {
    switch (command) {
      case "up": {
        const toFlag = rest.indexOf("--to");
        const opts   = toFlag !== -1 ? { to: rest[toFlag + 1] } : {};
        const applied = await umzug.up(opts);
        if (applied.length === 0) {
          console.log("✓  No pending migrations.");
        } else {
          console.log(`✓  Applied ${applied.length} migration(s):`);
          applied.forEach((m) => console.log(`   • ${m.name}`));
        }
        break;
      }

      case "down": {
        const rolled = await umzug.down();
        if (rolled.length === 0) {
          console.log("✓  Nothing to roll back.");
        } else {
          console.log(`↩  Rolled back: ${rolled.map((m) => m.name).join(", ")}`);
        }
        break;
      }

      case "status": {
        const pending  = await umzug.pending();
        const executed = await umzug.executed();
        console.log(`\nApplied  (${executed.length}):`);
        executed.forEach((m) => console.log(`  ✓  ${m.name}`));
        console.log(`\nPending  (${pending.length}):`);
        pending.forEach((m)  => console.log(`  …  ${m.name}`));
        console.log();
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error("Usage: node migrate.js [up|down|status] [--to <migration-name>]");
        process.exit(1);
    }
  } catch (err) {
    logger.error({ err }, "Migration failed");
    console.error("\n✗  Migration error:", err.message);
    process.exit(1);
  } finally {
    if (_pool) await _pool.close();
  }
}

main();
