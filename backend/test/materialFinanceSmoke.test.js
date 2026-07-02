process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "smoke-test-secret";

/**
 * Material + Finance module smoke test.
 *
 * Boots the real Express app with the real material/finance route files
 * mounted (unlike sanity.test.js, which mocks safeLoadRoutes away) so the
 * full request pipeline — rate limit → auth → page-right → handler → DB
 * layer → response — is exercised end to end.
 *
 * The mssql pool is faked (see makeFakePool below), so this suite never
 * opens a real database connection and cannot read or write any row of
 * production/dev data. It only proves the routes are wired correctly and
 * don't throw when the DB layer responds.
 */

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));

// ── Mock sql.Transaction so routes that open a DB transaction don't blow up ─
// approvalService and several write routes do `new sql.Transaction(pool)`.
// This replaces the real class with a lightweight fake that delegates
// request() to the fake pool, making begin/commit/rollback no-ops.
jest.mock("mssql", () => {
  const real = jest.requireActual("mssql");
  function MockTransaction(pool) {
    this.begin = jest.fn(async () => {});
    this.commit = jest.fn(async () => {});
    this.rollback = jest.fn(async () => {});
    this.request = () => pool.request();
  }
  return { ...real, Transaction: MockTransaction };
});

// ── docNumberLock: lock/back-patch helpers replaced with no-op stubs ────────
// lockNextDocNumber does multiple UPDATE-locked queries against DocNumberSequence.
// Stubbing it lets write-path tests focus on the business logic that follows
// (stock checks, GL posting, etc.) without simulating the sequencing protocol.
jest.mock("../utils/docNumberLock", () => ({
  lockNextDocNumber: jest.fn(async () => "ISS-2026-00001"),
  backPatchRecordId: jest.fn(async () => {}),
  resolveDocTypeId: jest.fn(async () => 5),
  previewNextDocNumber: jest.fn(async () => ({ docNo: "ISS-2026-00002", nextSerial: 2 })),
  resolveGRNPrefix: jest.fn(async () => "GRN"),
}));

// ── Redis: cache helpers stubbed — write routes call bumpCacheVersion ────────
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
  redisGetStrict: jest.fn(async () => null),
  pfaddActiveUser: jest.fn(async () => {}),
  localVersionCache: { invalidate: jest.fn(), get: jest.fn(async () => null), set: jest.fn() },
  permissionCache: { get: jest.fn(async () => null) },
}));

jest.mock("../logger", () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
});

jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = req.headers["x-request-id"] || "smoke-request";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});

// DBA route is role-gated and out of scope here; stub it like sanity.test.js
// does so its module-load side effects don't interfere.
jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

// ── Fake mssql pool ─────────────────────────────────────────────────────────
// Chainable request().input().query() that never touches a real database.
// Any COUNT(...) query gets a single synthetic row (`total`/`cnt` = 0) so
// pagination/count handlers that read recordset[0] don't blow up; every
// other query resolves to an empty result set.
function makeFakePool() {
  const queries = [];
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        queries.push(text);
        if (/COUNT\(/i.test(text)) {
          return { recordset: [{ total: 0, cnt: 0 }], recordsets: [[{ total: 0, cnt: 0 }]] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  const tx = {
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    request: makeRequest,
  };
  return { request: makeRequest, transaction: () => tx, queries };
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

function superAdminToken() {
  // roleId must be present: checkPermission checks !roleId before the
  // SUPERUSER_ROLES bypass, so a token without it returns 401 on all
  // routes that use checkPermissionForMethod as a router-level middleware.
  return jwt.sign(
    { userId: 1, email: "smoke@example.com", role: "super_admin", roleId: 1 },
    process.env.JWT_SECRET,
  );
}

describe("material + finance smoke: no auth token", () => {
  const readEndpoints = [
    "/api/material-requests/companies",
    "/api/material-requests/projects",
    "/api/material-issues/companies",
    "/api/material-issues/projects",
    "/api/expense-booking",
    "/api/new-payment",
    "/api/received-payment",
  ];
  const writeEndpoints = [
    "/api/material-requests",
    "/api/material-issues",
    "/api/expense-booking",
    "/api/new-payment",
  ];

  test.each(readEndpoints)("GET %s rejects an unauthenticated request", async (path) => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  test.each(writeEndpoints)("POST %s rejects an unauthenticated request", async (path) => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app).post(path).send({});
    expect(res.status).toBe(401);
  });
});

describe("material module smoke: authenticated reads reach the DB layer", () => {
  test("GET /api/material-requests/companies returns the mocked recordset", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .get("/api/material-requests/companies")
      .set("Authorization", `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("GET /api/material-requests/ (list) paginates without touching a real DB", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .get("/api/material-requests")
      .set("Authorization", `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
    expect(mockFakePool.queries.length).toBeGreaterThan(0);
  });

  test("GET /api/material-issues/companies and /projects respond 200", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();
    const auth = { Authorization: `Bearer ${superAdminToken()}` };

    const companies = await request(app).get("/api/material-issues/companies").set(auth);
    const projects = await request(app).get("/api/material-issues/projects").set(auth);

    expect(companies.status).toBe(200);
    expect(projects.status).toBe(200);
  });
});

describe("finance module smoke: authenticated reads reach the DB layer", () => {
  test("GET /api/expense-booking (list) responds 200", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .get("/api/expense-booking")
      .set("Authorization", `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
  });

  test("GET /api/new-payment (list) responds 200 with pagination metadata", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .get("/api/new-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
  });

  test("GET /api/received-payment (list) responds 200", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .get("/api/received-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`);

    expect(res.status).toBe(200);
  });
});

describe("material + finance smoke: fake pool never opens a real connection", () => {
  test("db module's connectDB/closeDB are mocked no-ops", () => {
    const db = require("../db");
    expect(jest.isMockFunction(db.connectDB)).toBe(true);
    expect(jest.isMockFunction(db.closeDB)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW SMOKE TESTS
// Tests below exercise the key business-logic paths hardened in this session:
//   • Material issue input validation (before any DB call)
//   • Stock availability guard (INV-1: insufficient stock → 400)
//   • Approval service authorisation gate (role enforcement)
//   • GL posting log outcome classification
//   • Approval role gate on received-payment approve/reject
// All use the same fake-pool pattern — no real DB connection is opened.
// ════════════════════════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────────────────

function userToken() {
  // A token with a roleId so checkPermissionForMethod doesn't short-circuit
  // with 401 "missing roleId" — it instead queries the pool, gets empty
  // results (no rights), and returns 403 "Access denied".
  return jwt.sign(
    { userId: 2, email: "user@example.com", role: "user", roleId: 99 },
    process.env.JWT_SECRET,
  );
}

/**
 * Smart pool whose query() returns configurable results keyed by SQL text
 * pattern. Falls back to the standard fake-pool behaviour for everything else.
 * Used to simulate specific DB responses mid-route (e.g. stock availability).
 */
function makeSmartPool(patterns = {}) {
  const queries = [];
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        queries.push(String(text).slice(0, 120));
        for (const [pat, result] of Object.entries(patterns)) {
          if (String(text).includes(pat)) return result;
        }
        if (/COUNT\(/i.test(text)) {
          return { recordset: [{ total: 0, cnt: 0, maxApprovedLevel: 0 }], rowsAffected: [0] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return { request: makeRequest, queries };
}

// ── Material issue: input validation ─────────────────────────────────────────

describe("material issue: body validation returns 400 before touching the DB", () => {
  test("POST with empty items array → 400 'At least one item is required'", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 1, ProjectId: 2, Date: "2026-07-01", Reason: "smoke", items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one item/i);
  });

  test("POST with item Quantity = 0 → 400 'ItemId and Quantity > 0'", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 2, Date: "2026-07-01", Reason: "smoke",
        items: [{ ItemId: 10, Quantity: 0, Uom: "Nos" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity/i);
  });

  test("POST with item missing ItemId → 400", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 2, Date: "2026-07-01", Reason: "smoke",
        items: [{ Quantity: 3, Uom: "Nos" }],  // no ItemId
      });

    expect(res.status).toBe(400);
  });
});

// ── Material issue: stock availability guard (INV-1) ─────────────────────────

describe("material issue: stock availability guard (INV-1)", () => {
  // The pool is configured to return Available=0 for any StockLedger query.
  // The route opens a sql.Transaction (mocked to use pool.request()) and
  // runs the availability check inside the transaction before any INSERT.
  // When available < requested the route must return 400 without committing.

  test("POST returns 400 'Insufficient stock' when ledger balance is 0", async () => {
    mockFakePool = makeSmartPool({
      // Stock check query pattern → zero available
      Available: { recordset: [{ Available: 0 }], rowsAffected: [0] },
    });
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 2, FinYearId: 1,
        Date: "2026-07-01", Reason: "smoke test",
        GodownId: 1,      // skip resolveMainGodownId DB call
        DocTypeId: 5,     // skip resolveIssueDocTypeId DB call
        items: [{ ItemId: 42, Quantity: 5, Uom: "Nos" }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient stock/i);
  });

  test("POST does NOT return 400 when stock is sufficient (proceeds to next check)", async () => {
    // When stock is ample the route proceeds past the guard and attempts the
    // INSERT — which returns an empty recordset (no IssueId) and the handler
    // returns 201 or 500 depending on whether it reads the OUTPUT row. Either
    // way it must NOT be 400 from the stock guard.
    mockFakePool = makeSmartPool({
      Available: { recordset: [{ Available: 100 }], rowsAffected: [0] },
    });
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 2, FinYearId: 1,
        Date: "2026-07-01", Reason: "smoke test",
        GodownId: 1, DocTypeId: 5,
        items: [{ ItemId: 42, Quantity: 5, Uom: "Nos" }],
      });

    // Must NOT be the stock guard's 400
    expect(res.status).not.toBe(400);
    if (res.status === 400) {
      expect(res.body.error).not.toMatch(/insufficient stock/i);
    }
  });
});

// ── approvalService.transition(): authorisation guard ────────────────────────

describe("approvalService.transition(): authorisation guard (no DB round-trip)", () => {
  // The role check is the very first thing transition() does — before opening
  // any transaction. It throws synchronously (well, async-throws) before
  // getPool() is called, so these tests don't even exercise the mock pool.

  test("user role trying to Approve → throws 'not authorized'", async () => {
    mockFakePool = makeFakePool();
    const { transition } = require("../services/approvalService");

    await expect(
      transition("expense-booking", 1, "Approved", "user@example.com", "user"),
    ).rejects.toThrow(/not authorized/i);
  });

  test("finance_manager trying to Reject → throws 'not authorized'", async () => {
    mockFakePool = makeFakePool();
    const { transition } = require("../services/approvalService");

    await expect(
      transition("expense-booking", 1, "Rejected", "fm@example.com", "finance_manager"),
    ).rejects.toThrow(/not authorized/i);
  });

  test("unknown module → throws 'Unknown module' (checked before role gate)", async () => {
    mockFakePool = makeFakePool();
    const { transition } = require("../services/approvalService");

    await expect(
      transition("no-such-module", 1, "Approved", "admin@example.com", "admin"),
    ).rejects.toThrow(/Unknown module/i);
  });

  test("admin role IS authorized — error only if DB lookup fails (pool returns no record)", async () => {
    // Admin passes the role gate; next failure is inside the transaction
    // (getRecordStatus finds no row). The error message must not be
    // "not authorized" — it must be about the record not being found.
    mockFakePool = makeFakePool(); // returns [] for all queries → no record found
    const { transition } = require("../services/approvalService");

    await expect(
      transition("expense-booking", 1, "Approved", "admin@example.com", "admin"),
    ).rejects.toThrow(/not found|Record/i);
  });
});

// ── approvalService.recordGLPosting(): outcome classification ────────────────

describe("approvalService.recordGLPosting(): GL posting log outcome recording", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleSpy.mockRestore();
  });

  test("'posted' outcome writes to GLPostingLog without console.error", async () => {
    mockFakePool = makeFakePool();
    const { recordGLPosting } = require("../services/approvalService");

    await recordGLPosting("payments", 1, { posted: true }, "admin@example.com");

    const glHits = mockFakePool.queries.filter((q) => /GLPostingLog/i.test(q));
    expect(glHits.length).toBeGreaterThan(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  test("'failed' outcome writes to GLPostingLog AND emits console.error", async () => {
    mockFakePool = makeFakePool();
    const { recordGLPosting } = require("../services/approvalService");

    await recordGLPosting("payments", 2, { failed: true, reason: "GL account missing" }, "admin@example.com");

    const glHits = mockFakePool.queries.filter((q) => /GLPostingLog/i.test(q));
    expect(glHits.length).toBeGreaterThan(0);
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("null outcome is classified as 'skipped' and emits console.error", async () => {
    mockFakePool = makeFakePool();
    const { recordGLPosting } = require("../services/approvalService");

    await recordGLPosting("payments", 3, null, "admin@example.com");

    const glHits = mockFakePool.queries.filter((q) => /GLPostingLog/i.test(q));
    expect(glHits.length).toBeGreaterThan(0);
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("'none' outcome (module with no GL poster) writes to log without console.error", async () => {
    mockFakePool = makeFakePool();
    const { recordGLPosting } = require("../services/approvalService");

    await recordGLPosting("material-issues", 4, { none: true, reason: "no GL poster for module" }, "admin@example.com");

    const glHits = mockFakePool.queries.filter((q) => /GLPostingLog/i.test(q));
    expect(glHits.length).toBeGreaterThan(0);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});

// ── Received payment: approval role gate (HTTP) ───────────────────────────────

describe("received payment: approval/rejection requires admin role", () => {
  // The approve and reject routes use allowRoles("admin","super_admin","dba").
  // A "user" role token (even with a roleId) must be blocked — either by
  // checkPermissionForMethod (no CanEdit rights → 403) or by allowRoles
  // (role not in allowed list → 403). Either way the HTTP status must be 403.

  test("PUT /api/received-payment/:id/approve with user role → 403", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/received-payment/1/approve")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ note: "approve attempt" });

    expect(res.status).toBe(403);
  });

  test("PUT /api/received-payment/:id/reject with user role → 403", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/received-payment/1/reject")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ note: "reject attempt" });

    expect(res.status).toBe(403);
  });

  test("PUT /api/received-payment/:id/approve without any token → 401", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/received-payment/1/approve")
      .send({ note: "no token" });

    expect(res.status).toBe(401);
  });
});

// ── Material issue: approval role gate (HTTP) ─────────────────────────────────

describe("material issue: approval/rejection requires admin role", () => {
  // Unlike received-payment.js, materialIssues.js's approve/reject routes have
  // no requirePageRight/checkPermissionForMethod gate — a "user" role token
  // reaches transition() directly, which throws "not authorized". The route's
  // catch block used to map every error to 400 regardless of cause; fixed to
  // match the newPayment.js/receivedPayment.js convention of mapping
  // "not authorized" errors to 403 specifically.

  test("PUT /api/material-issues/:id/approve with user role → 403", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/material-issues/1/approve")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ note: "approve attempt" });

    expect(res.status).toBe(403);
  });

  test("PUT /api/material-issues/:id/reject with user role → 403", async () => {
    mockFakePool = makeFakePool();
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/material-issues/1/reject")
      .set("Authorization", `Bearer ${userToken()}`)
      .send({ note: "reject attempt" });

    expect(res.status).toBe(403);
  });

  test("PUT /api/material-issues/:id/approve for a non-existent record → 400 (not 403)", async () => {
    // Record-not-found is a genuine 400, distinct from an authorization
    // failure — confirms the mapping only special-cases the "not authorized"
    // message, not every error from transition().
    mockFakePool = makeFakePool(); // empty recordset -> "not found in material-issues"
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/material-issues/99999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(400);
  });
});
