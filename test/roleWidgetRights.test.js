process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "role-widget-rights-test-secret";

/**
 * Widget visibility (backend/routes/userWidgetRights.js) had zero role-level
 * concept before this session — purely per-user, defaulting to "all active
 * widgets" when unset. This adds dbo.RoleWidgetRights as a role baseline:
 * resolution order is per-user row > role row > all widgets. Also verifies
 * the /role/:roleId routes aren't shadowed by the "/:userId" wildcard route
 * (a real bug this test would have caught — Express matches "/role" as a
 * userId value if that route isn't registered first).
 */

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));

jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});

jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = req.headers["x-request-id"] || "role-widget-rights-test-request";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});

jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
  redisGetStrict: jest.fn(async () => null),
  pfaddActiveUser: jest.fn(async () => {}),
  localVersionCache: { invalidate: jest.fn(), get: jest.fn(async () => null), set: jest.fn() },
  permissionCache: { get: jest.fn(async () => null) },
}));

const ALL_WIDGETS = ["Bar Chart", "Line Chart", "Pie Chart", "Stat Card"];
let userWidgetsJson; // null = no per-user row
let roleWidgetsJson; // null = no role row
let userRoleId;

function makeFakePool() {
  const request_ = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.WidgetCatalog/i.test(text)) {
          return { recordset: ALL_WIDGETS.map((w) => ({ WidgetKey: w })) };
        }
        if (/FROM dbo\.UserWidgetRights/i.test(text)) {
          return { recordset: userWidgetsJson ? [{ WidgetsJson: userWidgetsJson }] : [] };
        }
        if (/FROM dbo\.RoleWidgetRights/i.test(text)) {
          return { recordset: roleWidgetsJson ? [{ WidgetsJson: roleWidgetsJson }] : [] };
        }
        if (/SELECT RoleId FROM dbo\.users/i.test(text)) {
          return { recordset: [{ RoleId: userRoleId }] };
        }
        if (/MERGE dbo\.RoleWidgetRights/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/MERGE dbo\.UserWidgetRights/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [] };
      },
    };
    return req;
  };
  return { request: request_ };
}

let mockFakePool;
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => mockFakePool,
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));

function adminToken() {
  return jwt.sign(
    { userId: 1, email: "admin@example.com", name: "Admin", role: "admin", roleId: 1 },
    process.env.JWT_SECRET,
  );
}

beforeEach(() => {
  mockFakePool = makeFakePool();
  userWidgetsJson = null;
  roleWidgetsJson = null;
  userRoleId = 5;
});

describe("Role Widget Rights: resolution order", () => {
  test("defaults to all widgets when neither user nor role has a row", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .get("/api/user-widget-rights/9")
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.allowedWidgets.sort()).toEqual([...ALL_WIDGETS].sort());
  });

  test("falls back to the role's widgets when the user has no per-user row", async () => {
    roleWidgetsJson = JSON.stringify(["Bar Chart", "Stat Card"]);
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .get("/api/user-widget-rights/9")
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.allowedWidgets.sort()).toEqual(["Bar Chart", "Stat Card"].sort());
  });

  test("a per-user row fully overrides the role's widgets", async () => {
    roleWidgetsJson = JSON.stringify(["Bar Chart", "Stat Card"]);
    userWidgetsJson = JSON.stringify(["Line Chart"]);
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .get("/api/user-widget-rights/9")
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.allowedWidgets).toEqual(["Line Chart"]);
  });

  test("GET /role/:roleId is not shadowed by the /:userId wildcard route", async () => {
    roleWidgetsJson = JSON.stringify(["Pie Chart"]);
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .get("/api/user-widget-rights/role/5")
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.allowedWidgets).toEqual(["Pie Chart"]);
  });

  test("PUT /role/:roleId saves the role baseline", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/user-widget-rights/role/5")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ allowedWidgets: ["Bar Chart"] });
    expect(res.status).toBe(200);
    expect(res.body.allowedWidgets).toEqual(["Bar Chart"]);
  });
});
