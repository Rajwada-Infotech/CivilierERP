process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "sanity-test-secret";
process.env.HEALTH_TOKEN = process.env.HEALTH_TOKEN || "sanity-health-token";

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn() }));

jest.mock("../logger", () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
});

jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = req.headers["x-request-id"] || "sanity-request";
  req.log = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  next();
});

jest.mock("../utils/loadRoutes", () => ({
  safeLoadRoutes: jest.fn(async () => ({ loaded: [], failed: [] })),
  printRoutesSummary: jest.fn(),
}));

jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

describe("backend sanity: app bootstrap", () => {
  test("server exports async createApp and startServer functions", () => {
    const server = require("../server");

    expect(typeof server.createApp).toBe("function");
    expect(typeof server.startServer).toBe("function");
    expect(server.app).toBeUndefined();
  });

  test("createApp serves public root and health endpoints without DB/Redis", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const root = await request(app).get("/");
    expect(root.status).toBe(200);
    expect(root.text).toContain("CivilierERP API running");
    expect(root.headers["x-powered-by"]).toBeUndefined();

    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({
      status: "ok",
      name: "CivilierERP API",
    });
  });

  test("protected API routes reject missing bearer tokens before DB handlers run", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app).get("/api/account-group");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No token provided" });
  });

  test("internal health readiness is not exposed without the configured token", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
  });
});

describe("backend sanity: auth middleware", () => {
  function mockRes() {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  }

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("rejects a request with no Authorization header", async () => {
    jest.doMock("../redis", () => ({
      redisGetStrict: jest.fn(),
      pfaddActiveUser: jest.fn(),
    }));

    const auth = require("../middleware/auth");
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "No token provided" });
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects all authenticated requests with 503 when Redis blacklist check fails", async () => {
    jest.doMock("../redis", () => ({
      redisGetStrict: jest.fn().mockRejectedValue(new Error("redis down")),
      pfaddActiveUser: jest.fn(),
    }));

    const auth = require("../middleware/auth");
    const token = jwt.sign({ userId: 7, role: "admin" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error:
        "Authentication service temporarily unavailable. Please try again shortly.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts a valid JWT when blacklist lookup returns empty", async () => {
    const pfaddActiveUser = jest.fn(() => Promise.resolve());
    jest.doMock("../redis", () => ({
      redisGetStrict: jest.fn().mockResolvedValue(null),
      pfaddActiveUser,
    }));

    const auth = require("../middleware/auth");
    const token = jwt.sign(
      { userId: 11, email: "admin@example.com", role: "admin" },
      process.env.JWT_SECRET,
    );
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    await auth(req, res, next);

    expect(req.user).toMatchObject({
      userId: 11,
      email: "admin@example.com",
      role: "admin",
    });
    expect(req.token).toBe(token);
    expect(next).toHaveBeenCalledTimes(1);
    expect(pfaddActiveUser).toHaveBeenCalledWith(11);
  });
});

describe("backend sanity: DB retry wrapper", () => {
  test("queryWithRetry retries ECONNRESET once and returns the successful result", async () => {
    const { queryWithRetry } = require("../db");
    const fakePool = { request: jest.fn(() => ({ requestId: "req" })) };
    const fn = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket reset"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ recordset: [{ ok: 1 }] });

    await expect(queryWithRetry(fakePool, fn, 2)).resolves.toEqual({
      recordset: [{ ok: 1 }],
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fakePool.request).toHaveBeenCalledTimes(2);
  });

  test("queryWithRetry does not retry non-transient errors", async () => {
    const { queryWithRetry } = require("../db");
    const fakePool = { request: jest.fn(() => ({})) };
    const err = Object.assign(new Error("bad SQL"), { code: "EREQUEST" });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(queryWithRetry(fakePool, fn, 2)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("queryWithRetry retries ETIMEDOUT and returns the successful result", async () => {
    const { queryWithRetry } = require("../db");
    const fakePool = { request: jest.fn(() => ({ requestId: "req" })) };
    const fn = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValueOnce({ recordset: [{ ok: 1 }] });

    await expect(queryWithRetry(fakePool, fn, 2)).resolves.toEqual({
      recordset: [{ ok: 1 }],
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fakePool.request).toHaveBeenCalledTimes(2);
  });

  test("queryWithRetry retries ESOCKET and returns the successful result", async () => {
    const { queryWithRetry } = require("../db");
    const fakePool = { request: jest.fn(() => ({ requestId: "req" })) };
    const fn = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("socket error"), { code: "ESOCKET" }))
      .mockResolvedValueOnce({ recordset: [{ ok: 1 }] });

    await expect(queryWithRetry(fakePool, fn, 2)).resolves.toEqual({
      recordset: [{ ok: 1 }],
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fakePool.request).toHaveBeenCalledTimes(2);
  });

  test("queryWithRetry gives up and throws once retries are exhausted", async () => {
    const { queryWithRetry } = require("../db");
    const fakePool = { request: jest.fn(() => ({})) };
    const err = Object.assign(new Error("still timing out"), { code: "ETIMEDOUT" });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(queryWithRetry(fakePool, fn, 2)).rejects.toBe(err);
    // Initial attempt + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("backend sanity: route and migration inventory", () => {
  const backendRoot = path.join(__dirname, "..");

  test("core backend files exist", () => {
    [
      "server.js",
      "db.js",
      "redis.js",
      "middleware/auth.js",
      "services/approvalService.js",
      "escalationEngine.js",
    ].forEach((relativePath) => {
      expect(fs.existsSync(path.join(backendRoot, relativePath))).toBe(true);
    });
  });

  test("important API route modules exist", () => {
    [
      "users.js",
      "roles.js",
      "userRights.js",
      "purchaseOrders.js",
      "grns.js",
      "stockLedger.js",
      "transactions.js",
      "expenseBooking.js",
      "newPayment.js",
      "receivedPayment.js",
      "workOrder.js",
      "boq.js",
      "materialRequests.js",
      "materialIssues.js",
      "followupSalesDeed.js",
      "ticketRoutes.js",
    ].forEach((file) => {
      expect(fs.existsSync(path.join(backendRoot, "routes", file))).toBe(true);
    });
  });

  test("base auth migration is present before role/user-right migrations", () => {
    const migrations = fs
      .readdirSync(path.join(backendRoot, "migrations"), { recursive: true })
      .map((f) => path.basename(f))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    expect(migrations).toContain("005a-create-base-auth-schema.sql");
    expect(migrations.indexOf("005a-create-base-auth-schema.sql")).toBeLessThan(
      migrations.indexOf("006-add-roleid-to-users-drop-role.sql"),
    );
  });
});

describe("backend sanity: package test contract", () => {
  test("Jest is configured to discover backend/test/**/*.test.js", () => {
    const pkg = require("../package.json");

    expect(pkg.jest.testEnvironment).toBe("node");
    expect(pkg.jest.testMatch).toContain("**/test/**/*.test.js");
  });

  test("npm test does not pass silently when zero tests are discovered", () => {
    const pkg = require("../package.json");

    expect(pkg.scripts.test).not.toMatch(/--passWithNoTests/);
    expect(pkg.jest.passWithNoTests).not.toBe(true);
  });
});
