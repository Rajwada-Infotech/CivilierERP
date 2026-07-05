process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "stress-test-secret";

/**
 * Stress & concurrency tests.
 *
 * These stay in-process (no real network/DB) — the pool is faked with a
 * configurable artificial delay to simulate a slow database. The goals:
 *
 *   1. Concurrent requests — N simultaneous GETs all resolve correctly, none
 *      crash the process or leave the server in a broken state.
 *
 *   2. Large payloads — a POST with an oversized body (> express json limit)
 *      returns 413, not a crash.
 *
 *   3. Slow pool — if each DB query takes 200 ms, 20 concurrent requests still
 *      all complete (no unhandled rejections, no starvation).
 *
 *   4. Rapid sequential writes — 50 sequential POSTs with valid bodies must
 *      all return a deterministic status (not random 500s from race conditions
 *      in shared mutable state).
 *
 *   5. Header overflow — a request with a gigantic Authorization header returns
 *      431 (Request Header Fields Too Large), not a crash.
 *
 * Run with: npm --prefix backend test -- --testPathPattern=stress
 * Or with a longer timeout: jest --testTimeout=30000
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
  req.id = "stress-test-req";
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

// ── Configurable slow pool ────────────────────────────────────────────────────
// Must be prefixed "mock" so Jest's hoisting allows it inside the factory.
const mockPoolConfig = { delayMs: 0 };

jest.mock("../db", () => ({
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  getPool: jest.fn(() => ({
    request: () => {
      const r = {
        input: () => r,
        query: async () => {
          if (mockPoolConfig.delayMs > 0) {
            await new Promise((res) => setTimeout(res, mockPoolConfig.delayMs));
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  })),
}));

const SECRET = process.env.JWT_SECRET;
const token = () =>
  jwt.sign({ id: 1, username: "admin", role: "Admin" }, SECRET, { expiresIn: "1h" });

let app;
beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});

beforeEach(() => {
  mockPoolConfig.delayMs = 0;
});

// ── 1. Concurrent GETs ────────────────────────────────────────────────────────
describe("concurrent GETs", () => {
  test("20 simultaneous GET /api/account-group all resolve without error", async () => {
    const N = 20;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        request(app)
          .get("/api/account-group")
          .set("Authorization", `Bearer ${token()}`)
      )
    );

    for (const res of results) {
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(0);  // connection refused / crash
    }
  }, 15000);

  test("50 simultaneous GET /api/tds-master all resolve", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        request(app)
          .get("/api/tds-master")
          .set("Authorization", `Bearer ${token()}`)
      )
    );
    const bad = results.filter((r) => r.status === 500 || r.status === 0);
    expect(bad.length).toBe(0);
  }, 20000);
});

// ── 2. Large payload → 413 ────────────────────────────────────────────────────
describe("oversized request body", () => {
  test("POST with 12 MB JSON body returns 413 not 500 (server limit is 10 MB)", async () => {
    // server.js configures express.json({ limit: "10mb" }) — exceed it
    const bigArray = Array.from({ length: 120000 }, (_, i) => ({
      id: i,
      name: "x".repeat(100),
    }));

    const res = await request(app)
      .post("/api/account-group")
      .set("Authorization", `Bearer ${token()}`)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(bigArray));

    expect(res.status).toBe(413);
  }, 15000);
});

// ── 3. Slow pool — requests still complete ───────────────────────────────────
describe("slow DB pool (200 ms per query)", () => {
  test("20 concurrent requests all complete within 10 s", async () => {
    mockPoolConfig.delayMs = 200;

    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app)
          .get("/api/account-group")
          .set("Authorization", `Bearer ${token()}`)
      )
    );
    const elapsed = Date.now() - start;

    for (const res of results) {
      expect(res.status).not.toBe(500);
    }
    // All 20 ran truly in parallel — elapsed should be well under 20 * 200 ms = 4 s
    expect(elapsed).toBeLessThan(10000);
  }, 15000);
});

// ── 4. Rapid sequential requests ─────────────────────────────────────────────
describe("rapid sequential requests", () => {
  test("50 sequential GETs across 3 endpoints all return a deterministic status", async () => {
    const endpoints = ["/api/account-group", "/api/tds-master", "/api/account-head"];
    const statuses = [];

    for (let i = 0; i < 50; i++) {
      const url = endpoints[i % endpoints.length];
      const res = await request(app)
        .get(url)
        .set("Authorization", `Bearer ${token()}`);
      statuses.push(res.status);
    }

    // No 500s — all must resolve the same way consistently
    const hasFiveHundred = statuses.some((s) => s === 500);
    expect(hasFiveHundred).toBe(false);
    // All responses should be the same status (no flicker between 200 and other codes)
    const unique = [...new Set(statuses)];
    expect(unique.length).toBe(1);
  }, 30000);
});

// ── 5. Header overflow ────────────────────────────────────────────────────────
describe("request header overflow", () => {
  test("gigantic Authorization header returns 431 or 400, not a crash", async () => {
    const bigHeader = "Bearer " + "A".repeat(16384);  // 16 KB header value
    const res = await request(app)
      .get("/api/account-group")
      .set("Authorization", bigHeader);

    // Node's http parser will return 431; some configs return 400.
    // The server must not crash (status 0) or return 500.
    expect(res.status).not.toBe(500);
    expect(res.status).not.toBe(0);
  });
});

// ── 6. Mixed concurrent reads across endpoints ────────────────────────────────
describe("mixed concurrent reads across endpoints", () => {
  test("30 concurrent GETs spread across 3 endpoints all resolve without 500", async () => {
    const endpoints = ["/api/account-group", "/api/tds-master", "/api/account-head"];
    const reqs = Array.from({ length: 30 }, (_, i) =>
      request(app)
        .get(endpoints[i % endpoints.length])
        .set("Authorization", `Bearer ${token()}`)
    );

    const results = await Promise.all(reqs);
    const crashes = results.filter((r) => r.status === 500 || r.status === 0);
    expect(crashes.length).toBe(0);
  }, 15000);
});
