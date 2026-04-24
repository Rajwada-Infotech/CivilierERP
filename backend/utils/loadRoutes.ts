import fs from "fs";
import path from "path";
import type { Express, Router } from "express";

type RouteConfig = {
  path: string;
  file: string;
};

type LoadOptions = {
  baseDir?: string;
  logger?: {
    info: (msg: string | object) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  failFast?: boolean;
  verbose?: boolean;
};

type LoadResults = {
  loaded: string[];
  skipped: { label: string; reason: string }[];
  failed: { label: string; error: string }[];
};

export async function safeLoadRoutes(
  app: Express,
  routes: RouteConfig[],
  options: LoadOptions = {},
): Promise<LoadResults> {
  const {
    baseDir = process.cwd(),
    logger = console,
    failFast = false,
    verbose = false,
  } = options;

  const results: LoadResults = {
    loaded: [],
    skipped: [],
    failed: [],
  };

  for (const { path: routePath, file } of routes) {
    const label = routePath.replace("/api/", "");

    try {
      const tsPath = path.resolve(baseDir, file + ".ts");
      const jsPath = path.resolve(baseDir, file + ".js");

      let fullPath: string | null = null;

      if (fs.existsSync(jsPath)) fullPath = jsPath;
      else if (fs.existsSync(tsPath)) fullPath = tsPath;

      if (!fullPath) {
        logger.warn(`Route file missing: ${file}`);
        results.skipped.push({ label, reason: "missing_file" });
        continue;
      }

      const imported = await import(fullPath);
      const router: Router = (imported.default || imported) as Router;

      if (typeof router !== "function") {
        logger.warn(`Invalid route export: ${file}`);
        results.skipped.push({ label, reason: "invalid_export" });
        continue;
      }

      app.use(routePath, router);

      if (verbose) logger.info(`Loaded route: ${label}`);

      results.loaded.push(label);
    } catch (err: any) {
      logger.error(`Failed loading route: ${label} — ${err.message}`);

      results.failed.push({
        label,
        error: err.message,
      });

      if (failFast) throw err;
    }
  }

  return results;
}
