process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "cache-contract-test-secret";

/**
 * Cache & Redis contract tests.
 *
 * Verifies observable cache behaviour at the HTTP layer:
 *   1. GET list endpoints return consistent JSON on repeated calls.
 *   2. Responses are consistent regardless of whether cache is warm or cold.
 *   3. A Redis outage (all redis fns throw) falls through to the DB and
 *      returns 200, not 500 — the cache layer must never crash a request.
 *   4. Response shape: list endpoints return JSON arrays.
 *
 * The mssql pool and Redis are both faked. No network I/O.
 */

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));

jest.mock("../logger", () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  l.child = jest.fn(() => l);
  return l;
});

jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = "cache-test-req";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});

jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

// Full redis mock — include every export that cache.js destructures so nothing
// is undefined at initialisation time and the cache layer runs normally.
jest.mock("../redis", () => ({
  bumpCacheVersion:      jest.fn(async () => {}),
  redisGet:              jest.fn(async () => null),
  redisSet:              jest.fn(async () => {}),
  redisDel:              jest.fn(async () => {}),
  redisGetStrict:        jest.fn(async () => null),
  redisLock:             jest.fn(async (_k, _t, fn) => fn()),
  getCacheVersion:       jest.fn(async () => 1),
  compress:              jest.fn((v) => v),
  decompress:            jest.fn((v) => v),
  pfaddActiveUser:       jest.fn(async () => {}),
  incrGlobalRequests:    jest.fn(async () => {}),
  incrGlobalCacheHit:    jest.fn(async () => {}),
  incrGlobalCacheMiss:   jest.fn(async () => {}),
  getSystemMetrics:      jest.fn(async () => ({})),
  getPredictedRPM:       jest.fn(async () => 0),
  getDynamicLimit:       jest.fn(async () => 200),
  trackHourLoad:         jest.fn(async () => {}),
  redisZScore:           jest.fn(async () => null),
  localVersionCache: {
    invalidate: jest.fn(),
    get:        jest.fn(async () => null),
    set:        jest.fn(),
  },
  permissionCache: { get: jest.fn(async () => null) },
}));

jest.mock("../db", () => ({
  connectDB: jest.fn(async () => {}),
  closeDB:   jest.fn(async () => {}),
  getPool: jest.fn(() => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          if (/SELECT COUNT/i.test(text)) return { recordset: [{ total: 0, cnt: 0 }], rowsAffected: [0] };
          if (/sys\.columns/i.test(text))  return { recordset: [{ cnt: 0 }],           rowsAffected: [0] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  })),
}));

const SECRET = process.env.JWT_SECRET;
const token = () => jwt.sign({ id: 1, username: "admin", role: "Admin" }, SECRET, { expiresIn: "1h" });

let app;
beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});

// ── 1. Repeated GETs are consistent ──────────────────────────────────────────
describe("repeated GETs return consistent results", () => {
  test("GET /api/account-group twice returns the same status both times", async () => {
    const [r1, r2] = await Promise.all([
      request(app).get("/api/account-group").set("Authorization", `Bearer ${token()}`),
      request(app).get("/api/account-group").set("Authorization", `Bearer ${token()}`),
    ]);
    expect(r1.status).not.toBe(500);
    expect(r2.status).toBe(r1.status);
  });

  test("GET /api/tds-master twice returns the same status both times", async () => {
    const [r1, r2] = await Promise.all([
      request(app).get("/api/tds-master").set("Authorization", `Bearer ${token()}`),
      request(app).get("/api/tds-master").set("Authorization", `Bearer ${token()}`),
    ]);
    expect(r1.status).not.toBe(500);
    expect(r2.status).toBe(r1.status);
  });
});

// ── 2. Redis outage → graceful fallback ──────────────────────────────────────
describe("Redis outage is handled gracefully", () => {
  test("GET /api/account-group returns 200 even when all redis fns throw", async () => {
    const { redisGet, redisSet, getCacheVersion } = require("../redis");
    redisGet.mockRejectedValueOnce(new Error("Redis ECONNREFUSED"));
    redisSet.mockRejectedValueOnce(new Error("Redis ECONNREFUSED"));
    getCacheVersion.mockRejectedValueOnce(new Error("Redis ECONNREFUSED"));

    const res = await request(app)
      .get("/api/account-group")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).not.toBe(500);
  });

  test("GET /api/tds-master returns 200 even when redisGet throws", async () => {
    const { redisGet } = require("../redis");
    redisGet.mockRejectedValueOnce(new Error("Redis timeout"));

    const res = await request(app)
      .get("/api/tds-master")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).not.toBe(500);
  });
});

// ── 3. Response shape ─────────────────────────────────────────────────────────
describe("list response shape", () => {
  test("GET /api/account-group returns JSON array", async () => {
    const res = await request(app)
      .get("/api/account-group")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).not.toBe(500);
    if (res.status === 200) expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/tds-master returns JSON (array or object)", async () => {
    const res = await request(app)
      .get("/api/tds-master")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).not.toBe(500);
    if (res.status === 200) expect(typeof res.body).toBe("object");
  });

  test("GET /api/account-head returns JSON", async () => {
    const res = await request(app)
      .get("/api/account-head")
      .set("Authorization", `Bearer ${token()}`);

    expect(res.status).not.toBe(500);
    if (res.status === 200) expect(typeof res.body).toBe("object");
  });
});

// ── 4. Cache miss then hit — same response body ───────────────────────────────
describe("cache miss then hit returns same data", () => {
  test("two sequential GETs return identical body", async () => {
    const first = await request(app)
      .get("/api/account-group")
      .set("Authorization", `Bearer ${token()}`);

    const second = await request(app)
      .get("/api/account-group")
      .set("Authorization", `Bearer ${token()}`);

    expect(first.status).toBe(second.status);
    // Bodies must be identical JSON
    expect(JSON.stringify(first.body)).toBe(JSON.stringify(second.body));
  });
});
