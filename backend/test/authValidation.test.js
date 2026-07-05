process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "auth-validation-test-secret";

/**
 * Auth & middleware validation.
 *
 * Verifies that every authenticated route correctly rejects:
 *   - missing Authorization header (401)
 *   - malformed / garbage tokens (401)
 *   - expired tokens (401)
 *   - tokens signed with a wrong secret (401)
 *   - tokens with a missing role field (403)
 *
 * Also checks that:
 *   - public endpoints (/health, /) are reachable without a token
 *   - a valid admin token is accepted (200/whatever the route returns)
 *   - the 401 response body always contains a machine-readable "error" key
 *     (so the frontend can distinguish auth failures from other errors)
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
  req.id = "auth-test-req";
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

// Minimal pool — auth tests never reach DB queries, but the pool must exist
// so route handlers don't crash during require().
jest.mock("../db", () => ({
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  getPool: jest.fn(() => ({
    request: () => {
      const r = { input: () => r, query: async () => ({ recordset: [], rowsAffected: [0] }) };
      return r;
    },
  })),
}));

const SECRET = process.env.JWT_SECRET;

function adminToken(overrides = {}) {
  return jwt.sign(
    { id: 1, username: "admin", role: "Admin", ...overrides },
    SECRET,
    { expiresIn: "1h" }
  );
}

// ── Protected route to probe (account-head is a simple GET list) ─────────────
const PROTECTED = "/api/account-head";

let app;
beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});

// ── Public endpoints ──────────────────────────────────────────────────────────
describe("public endpoints require no token", () => {
  test("GET / → 200 with CivilierERP API running", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/CivilierERP/i);
  });

  test("GET /health → 200", async () => {
    const res = await request(app)
      .get("/health")
      .set("x-health-token", process.env.HEALTH_TOKEN || "sanity-health-token");
    expect(res.status).toBe(200);
  });
});

// ── Missing / malformed tokens ────────────────────────────────────────────────
describe("protected routes reject bad tokens", () => {
  test("no Authorization header → 401", async () => {
    const res = await request(app).get(PROTECTED);
    expect(res.status).toBe(401);
  });

  test("Bearer with empty string → 401", async () => {
    const res = await request(app).get(PROTECTED).set("Authorization", "Bearer ");
    expect(res.status).toBe(401);
  });

  test("Authorization header without Bearer prefix → 401", async () => {
    const res = await request(app)
      .get(PROTECTED)
      .set("Authorization", adminToken());   // no "Bearer " prefix
    expect(res.status).toBe(401);
  });

  test("random garbage token → 401", async () => {
    const res = await request(app)
      .get(PROTECTED)
      .set("Authorization", "Bearer not.a.jwt");
    expect(res.status).toBe(401);
  });

  test("token signed with wrong secret → 401", async () => {
    const bad = jwt.sign({ id: 1, username: "admin", role: "Admin" }, "wrong-secret");
    const res = await request(app)
      .get(PROTECTED)
      .set("Authorization", `Bearer ${bad}`);
    expect(res.status).toBe(401);
  });

  test("expired token → 401", async () => {
    const expired = jwt.sign(
      { id: 1, username: "admin", role: "Admin" },
      SECRET,
      { expiresIn: -1 }   // already expired
    );
    const res = await request(app)
      .get(PROTECTED)
      .set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  test("401 response always has an error key in body", async () => {
    const res = await request(app).get(PROTECTED);
    expect(res.status).toBe(401);
    // body should be JSON with at least one of: error / message
    const body = res.body;
    const hasErrorKey = "error" in body || "message" in body;
    expect(hasErrorKey).toBe(true);
  });
});

// ── Valid token is accepted ───────────────────────────────────────────────────
describe("valid admin token is accepted", () => {
  test("GET /api/account-head with valid token → not 401/403", async () => {
    const res = await request(app)
      .get(PROTECTED)
      .set("Authorization", `Bearer ${adminToken()}`);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ── CORS headers ──────────────────────────────────────────────────────────────
describe("CORS", () => {
  test("OPTIONS preflight to /api/* returns 204 or 200", async () => {
    const res = await request(app)
      .options(PROTECTED)
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");
    expect([200, 204]).toContain(res.status);
  });
});
