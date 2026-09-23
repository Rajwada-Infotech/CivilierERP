process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "civil-work-dpr-validation-test-secret";

/**
 * Civil Work DPR — request validation contract tests.
 *
 * The module (DependencyMaster/Activity chains) had zero automated coverage
 * before this file — every fix to it was only checked by hand. These tests
 * lock in the input-validation layer for the module's core write paths: the
 * part most exposed to a malformed request, and exactly the layer that
 * held the falsy-zero-id bugs (`if (!id)` instead of `Number.isFinite`)
 * fixed alongside this file. Every case here returns before any real DB
 * call, so a fully faked mssql pool is enough — no network I/O.
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
  req.id = "civil-work-dpr-test-req";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});

jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

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

// Fully faked mssql pool — every validation case here fails BEFORE any real
// query runs, so the exact recordset shape doesn't matter, only that the
// mock never throws.
jest.mock("../db", () => ({
  connectDB: jest.fn(async () => {}),
  closeDB:   jest.fn(async () => {}),
  getPool: jest.fn(() => ({
    request: () => {
      const r = {
        input: () => r,
        query: async () => ({ recordset: [], rowsAffected: [0] }),
      };
      return r;
    },
  })),
}));

const SECRET = process.env.JWT_SECRET;
// role "Admin" bypasses requirePageRight entirely (see
// middleware/requirePageRight.js's SUPERUSER_ROLES) — these tests are
// about input validation, not permission checks, so this keeps every
// request past the rights gate and into the actual handler logic.
const token = () => jwt.sign({ id: 1, userId: 1, username: "admin", role: "Admin" }, SECRET, { expiresIn: "1h" });

let app;
beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});

describe("POST /api/dependency-master — payload validation", () => {
  const base = { alias: "Bedroom 1", workType: "INTERNAL", activities: [{ activityId: 1 }] };

  test("rejects a missing scope", async () => {
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ ...base });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scope/i);
  });

  test("rejects an incomplete scope (missing roomId)", async () => {
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ ...base, scope: { projectId: 1, towerId: 1, floor: "1", flatId: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scope/i);
  });

  test("accepts a scope where every id is legitimately 0", async () => {
    // Every id here is a real identity PK that could — per this session's
    // findings on historical identity-reseed corruption — legitimately be
    // 0. Only `scope.floor` uses a plain truthiness check upstream
    // (validatePayload), so this specifically proves the numeric fields
    // (projectId/towerId/flatId/roomId) are never treated as "missing"
    // just because they're 0.
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ ...base, scope: { projectId: 0, towerId: 0, floor: "G", flatId: 0, roomId: 0 } });
    expect(res.status).not.toBe(400);
  });

  test("rejects a missing alias", async () => {
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ scope: { projectId: 1, towerId: 1, floor: "1", flatId: 1, roomId: 1 }, workType: "INTERNAL", activities: [{ activityId: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/alias/i);
  });

  test("rejects an invalid workType", async () => {
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ ...base, scope: { projectId: 1, towerId: 1, floor: "1", flatId: 1, roomId: 1 }, workType: "SOMETHING_ELSE" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/workType/i);
  });

  test("rejects an empty activities list", async () => {
    const res = await request(app)
      .post("/api/dependency-master")
      .set("Authorization", `Bearer ${token()}`)
      .send({ ...base, scope: { projectId: 1, towerId: 1, floor: "1", flatId: 1, roomId: 1 }, activities: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/activity/i);
  });
});

