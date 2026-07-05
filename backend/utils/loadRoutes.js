"use strict";

const fs   = require("fs");
const path = require("path");

/**
 * Safely loads Express route files from a config array.
 * Logs results in a clean table at the end.
 *
 * @param {import("express").Express} app
 * @param {Array<{path: string, file: string}>} routes
 * @param {{
 *   baseDir?: string,
 *   logger?: { info: Function, warn: Function, error: Function },
 *   failFast?: boolean,
 *   verbose?: boolean
 * }} options
 */
async function safeLoadRoutes(app, routes, options = {}) {
  const {
    baseDir  = process.cwd(),
    logger   = console,
    failFast = false,
    verbose  = false,
  } = options;

  const results = { loaded: [], skipped: [], failed: [] };

  for (const { path: routePath, file } of routes) {
    const label = routePath.replace("/api/", "");

    try {
      // Support both .js and .ts extensions
      const jsPath = path.resolve(baseDir, file + ".js");
      const tsPath = path.resolve(baseDir, file + ".ts");

      let fullPath = null;
      if (fs.existsSync(jsPath))      fullPath = jsPath;
      else if (fs.existsSync(tsPath)) fullPath = tsPath;

      if (!fullPath) {
        logger.warn({ event: "ROUTE_MISSING", route: routePath, file }, `Route file missing: ${file}`);
        results.skipped.push({ label, reason: "missing_file" });
        continue;
      }

      // Strip extension for require() compatibility
      const requirePath = fullPath.replace(/\.(js|ts)$/, "");
      const router = require(requirePath);

      if (typeof router !== "function" && typeof router.default !== "function") {
        logger.warn({ event: "ROUTE_INVALID_EXPORT", route: routePath, file }, `Invalid export in: ${file}`);
        results.skipped.push({ label, reason: "invalid_export" });
        continue;
      }

      app.use(routePath, router.default || router);

      if (verbose) logger.info({ event: "ROUTE_LOADED", route: routePath, file }, `Route loaded: ${label}`);
      results.loaded.push(label);

    } catch (err) {
      logger.error({ event: "ROUTE_FAILED", route: routePath, file, err }, `Route failed: ${label} — ${err.message}`);
      results.failed.push({ label, error: err.message });
      if (failFast) throw err;
    }
  }

  return results;
}

/**
 * Prints a boxed summary after route loading.
 */
function printRoutesSummary(results, logger = console) {
  const { loaded, skipped, failed } = results;
  const total = loaded.length + skipped.length + failed.length;

  const allOk   = failed.length === 0 && skipped.length === 0;
  const hasFail  = failed.length > 0;

  const rows = [
    `  Route Loading Summary`,
    ``,
    `  ✓  Loaded : ${loaded.length}`,
    `  ⚠  Warn   : ${skipped.length}`,
    `  ✗  Failed : ${failed.length}`,
    `  ─  Total  : ${total}`,
  ];

  if (hasFail) {
    rows.push(``, `  Failed routes:`);
    failed.forEach(({ label, error }) => rows.push(`    • ${label}: ${error}`));
  }

  if (skipped.length > 0) {
    rows.push(``, `  Skipped routes:`);
    skipped.forEach(({ label, reason }) => rows.push(`    • ${label}: ${reason}`));
  }

  const width  = rows.reduce((m, r) => Math.max(m, r.length), 0) + 2;
  const top    = `╔${"═".repeat(width)}╗`;
  const bot    = `╚${"═".repeat(width)}╝`;
  const sep    = `╠${"═".repeat(width)}╣`;
  const box    = [
    top,
    `║${rows[0].padEnd(width)}║`,
    sep,
    ...rows.slice(1).map((r) => `║${r.padEnd(width)}║`),
    bot,
  ].join("\n");

  const status = allOk ? "info" : hasFail ? "error" : "warn";
  logger[status](`\n${box}\n`);
}

module.exports = { safeLoadRoutes, printRoutesSummary };