"use strict";

/**
 * backend/scripts/baseline-migrations.js
 *
 * One-time "adopt an existing database into the migration tool" helper.
 *
 * Problem it solves: on databases where the schema was built/restored WITHOUT
 * umzug ever recording anything, dbo.__Migrations is empty. `migrate.js up`
 * then treats every migration (001…N) as pending and tries to re-run all of
 * them — including non-idempotent drops/renames — which fails or corrupts the
 * already-applied schema.
 *
 * This script marks migrations as already-applied by inserting their tracked
 * names (umzug tracks by file BASENAME) into dbo.__Migrations, WITHOUT running
 * any migration SQL. After baselining, `migrate.js up` only applies genuinely
 * new migrations.
 *
 * It writes ONLY to the dbo.__Migrations tracking table — never to schema or
 * business data. It is idempotent (INSERT-if-absent) and reversible
 * (DELETE the rows it added).
 *
 * Usage (from backend/):
 *   node scripts/baseline-migrations.js               # dry-run: preview only
 *   node scripts/baseline-migrations.js --apply       # actually insert rows
 *   node scripts/baseline-migrations.js --apply --to 154-create-gl-posting-log.sql
 *
 * --to <basename>  baseline only up to and including that migration (by sorted
 *                  path order, matching umzug). Use on an environment that is
 *                  known to be applied only up to a certain point.
 *
 * IMPORTANT: only run this against a database whose schema you have confirmed
 * already reflects the migrations being baselined. Marking a migration applied
 * that was NOT actually applied will cause it to be skipped forever.
 */

require("../config/env").loadEnv();
const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const TABLE = "dbo.__Migrations";

function envBool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

// Discover every *.sql umzug would track, in the same sort order umzug uses
// (full relative path), reduced to the tracked basename.
function discoverMigrations() {
  const entries = fs
    .readdirSync(MIGRATIONS_DIR, { recursive: true })
    .map((p) => String(p).replace(/\\/g, "/"))
    .filter((p) => p.toLowerCase().endsWith(".sql"))
    .sort();

  const seen = new Map(); // basename -> relPath (first wins), tracks collisions
  const collisions = [];
  for (const rel of entries) {
    const base = path.basename(rel);
    if (seen.has(base)) collisions.push({ base, a: seen.get(base), b: rel });
    else seen.set(base, rel);
  }
  return { names: [...seen.keys()], collisions };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const toIdx = args.indexOf("--to");
  const toName = toIdx !== -1 ? args[toIdx + 1] : null;

  const { names, collisions } = discoverMigrations();

  let target = names;
  if (toName) {
    const cut = names.indexOf(toName);
    if (cut === -1) {
      console.error(`--to "${toName}" not found among migration basenames.`);
      process.exit(1);
    }
    target = names.slice(0, cut + 1);
  }

  const pool = await sql.connect({
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
    },
  });

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='__Migrations')
    CREATE TABLE ${TABLE} (
      name NVARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
  `);

  const existing = new Set(
    (await pool.request().query(`SELECT name FROM ${TABLE}`)).recordset.map(
      (r) => r.name,
    ),
  );

  const missing = target.filter((n) => !existing.has(n));

  console.log(`Database        : ${process.env.DB_NAME}`);
  console.log(`Migrations found: ${names.length}`);
  if (toName) console.log(`Baselining up to: ${toName} (${target.length} files)`);
  console.log(`Already tracked : ${existing.size}`);
  console.log(`To be marked    : ${missing.length}`);
  if (collisions.length) {
    console.log(
      `\n⚠ ${collisions.length} basename collision(s) — umzug tracks these as ONE:`,
    );
    collisions.forEach((c) => console.log(`   ${c.base}: ${c.a}  <->  ${c.b}`));
  }

  if (missing.length === 0) {
    console.log("\n✓ Nothing to baseline — tracker already covers these.");
    await pool.close();
    return;
  }

  if (!apply) {
    console.log("\n-- DRY RUN (no changes written). Would mark as applied:");
    missing.forEach((n) => console.log(`   + ${n}`));
    console.log("\nRe-run with --apply to write these rows.");
    await pool.close();
    return;
  }

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const n of missing) {
      await tx
        .request()
        .input("name", sql.NVarChar(255), n)
        .query(
          `IF NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE name=@name) INSERT INTO ${TABLE} (name) VALUES (@name)`,
        );
    }
    await tx.commit();
    console.log(`\n✓ Baselined ${missing.length} migration(s).`);
  } catch (err) {
    await tx.rollback().catch(() => {});
    console.error("\n✗ Baseline failed, rolled back:", err.message);
    process.exitCode = 1;
  }
  await pool.close();
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});
