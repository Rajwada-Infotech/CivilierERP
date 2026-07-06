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
    const label = routePath.replace(/^\/api\//, "");

    try {
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
 * Prints a redesigned summary after route loading.
 */
function printRoutesSummary(results, logger = console) {
  const { loaded, skipped, failed } = results;
  const total   = loaded.length + skipped.length + failed.length;
  const allOk   = failed.length === 0 && skipped.length === 0;
  const hasFail = failed.length > 0;

  // ANSI colour codes (no-op if the terminal strips them)
  const c = {
    reset:  "\x1b[0m",
    bold:   "\x1b[1m",
    dim:    "\x1b[2m",
    green:  "\x1b[32m",
    yellow: "\x1b[33m",
    red:    "\x1b[31m",
    cyan:   "\x1b[36m",
    white:  "\x1b[97m",
    grey:   "\x1b[90m",
  };

  const symbol = { ok: "✔", warn: "◆", fail: "✘", bullet: "›" };

  // ── Header ──────────────────────────────────────────────────────────────
  const lines = [
    "",
    `  ${c.bold}${c.cyan}CIVILIER ERP${c.reset}  ${c.grey}·${c.reset}  Route Boot`,
    `  ${c.grey}${"─".repeat(36)}${c.reset}`,
    "",
  ];

  // ── Stats row ────────────────────────────────────────────────────────────
  const stat = (col, sym, label, val) =>
    `  ${col}${sym}${c.reset}  ${c.dim}${label}${c.reset}   ${c.bold}${col}${val}${c.reset}`;

  lines.push(stat(c.green,  symbol.ok,   "loaded  ", loaded.length));
  lines.push(stat(c.yellow, symbol.warn, "skipped ", skipped.length));
  lines.push(stat(c.red,    symbol.fail, "failed  ", failed.length));
  lines.push("");
  lines.push(`  ${c.grey}${"─".repeat(36)}${c.reset}`);
  lines.push(
    `  ${c.grey}total${c.reset}  ${c.bold}${c.white}${total}${c.reset}` +
    `  ${c.grey}routes registered${c.reset}`,
  );

  // ── Failed detail ─────────────────────────────────────────────────────
  if (hasFail) {
    lines.push("", `  ${c.red}${c.bold}Failed routes${c.reset}`);
    failed.forEach(({ label, error }) => {
      lines.push(`  ${c.red}${symbol.bullet}${c.reset}  ${c.bold}${label}${c.reset}`);
      lines.push(`     ${c.dim}${error}${c.reset}`);
    });
  }

  // ── Skipped detail ───────────────────────────────────────────────────
  if (skipped.length > 0) {
    lines.push("", `  ${c.yellow}${c.bold}Skipped routes${c.reset}`);
    skipped.forEach(({ label, reason }) => {
      lines.push(`  ${c.yellow}${symbol.bullet}${c.reset}  ${c.bold}${label}${c.reset}  ${c.dim}(${reason})${c.reset}`);
    });
  }

  lines.push("");

  const level = allOk ? "info" : hasFail ? "error" : "warn";
  logger[level](lines.join("\n"));
}

module.exports = { safeLoadRoutes, printRoutesSummary };
