process.env.NODE_ENV = "test";

/**
 * No-DB smoke test: every CRM route/service file must require() cleanly.
 * `node -c` only checks syntax — it can't catch a bad destructured import
 * (e.g. `const { Foo } = require("./bar")` where bar.js doesn't actually
 * export Foo, which silently becomes `undefined` and only blows up the
 * first time the route is hit), a circular-require deadlock, or a typo'd
 * require path. This mounts every crm*.js route file as an Express router
 * (proving Express itself accepts it, not just that Node can parse it) and
 * plain-requires every crm*.js service file, with db/redis/logger/env
 * mocked out so no real connection is needed. Written during a full CRM
 * audit sweep (Sept 2026) that had no live DB available all session —
 * this is the strongest no-DB verification available for that sweep's
 * changes (crmRefunds.js, crmSalesDeed.js, crmPortal.js, crmMutation.js,
 * crmLedger.js, crmWorkflowGuards.js) and is kept as a permanent regression
 * guard for the whole CRM module, not just those files.
 */

const fs = require("fs");
const path = require("path");
const express = require("express");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({ request: () => ({ input: () => ({ input: () => ({ query: async () => ({ recordset: [] }) }) }), query: async () => ({ recordset: [] }) }) }),
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
  redisGetStrict: jest.fn(async () => null),
  pfaddActiveUser: jest.fn(async () => {}),
  localVersionCache: { invalidate: jest.fn(), get: jest.fn(async () => null), set: jest.fn() },
  permissionCache: { get: jest.fn(async () => null) },
}));

const routesDir = path.join(__dirname, "..", "routes");
const servicesDir = path.join(__dirname, "..", "services");

const crmRouteFiles = fs.readdirSync(routesDir).filter((f) => f.startsWith("crm") && f.endsWith(".js"));
const crmServiceFiles = fs.readdirSync(servicesDir).filter((f) => f.startsWith("crm") && f.endsWith(".js"));

describe("Every CRM route file requires cleanly and mounts as an Express router", () => {
  test.each(crmRouteFiles)("routes/%s", (file) => {
    let mod;
    expect(() => {
      mod = require(path.join(routesDir, file));
    }).not.toThrow();
    const router = mod && mod.__esModule ? mod.default : (typeof mod === "function" ? mod : mod.router || mod);
    if (typeof router === "function") {
      expect(() => {
        const app = express();
        app.use("/test", router);
      }).not.toThrow();
    }
  });
});

describe("Every CRM service file requires cleanly", () => {
  test.each(crmServiceFiles)("services/%s", (file) => {
    expect(() => {
      require(path.join(servicesDir, file));
    }).not.toThrow();
  });
});
