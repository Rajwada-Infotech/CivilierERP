process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "realtime-test-secret";

/**
 * Real-time rights propagation.
 *
 * Problem: an admin changes a user's (or a role's) page rights, and the
 * backend permission cache is invalidated immediately — enforcement on the
 * server is instant — but the affected user's browser session keeps stale
 * pagePermissions until a 5-minute poll fires or they re-login. This suite
 * verifies the fix: every rights-saving route emits "permissions:updated" to
 * the right socket.io room the moment the save succeeds, so the client can
 * react instantly (see src/contexts/AuthContext.tsx's socket listener).
 *
 * The mssql pool and socket.io are both faked — no real DB or socket server
 * is ever touched.
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
  req.id = req.headers["x-request-id"] || "rt-test-request";
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

jest.mock("mssql", () => {
  const real = jest.requireActual("mssql");
  function MockTransaction(pool) {
    this.begin = jest.fn(async () => {});
    this.commit = jest.fn(async () => {});
    this.rollback = jest.fn(async () => {});
    this.request = () => pool.request();
  }
  return { ...real, Transaction: MockTransaction, Request: class { constructor(tx) { return tx.request(); } } };
});

// ── Fake mssql pool ─────────────────────────────────────────────────────────
function makeFakePool() {
  const queries = [];
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        queries.push(text);
        if (/COUNT\(/i.test(text)) {
          return { recordset: [{ total: 0, cnt: 0 }], rowsAffected: [0] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return { request: makeRequest, transaction: () => ({ request: makeRequest }), queries };
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

// ── Fake socket.io — captures every emit so tests can assert on room/event ──
let mockEmittedEvents;
let mockIoShouldThrow = false;
jest.mock("../socket", () => ({
  getIo: () => {
    if (mockIoShouldThrow) throw new Error("Socket.io not initialized. Call initSocket() first.");
    return {
      to: (room) => ({
        emit: (event, payload) => {
          mockEmittedEvents.push({ room, event, payload });
        },
      }),
    };
  },
  initSocket: jest.fn(),
}));

function adminToken() {
  return jwt.sign(
    { userId: 1, email: "admin@example.com", role: "admin", roleId: 2 },
    process.env.JWT_SECRET,
  );
}

beforeEach(() => {
  mockFakePool = makeFakePool();
  mockEmittedEvents = [];
  mockIoShouldThrow = false;
  jest.resetModules();
});

describe("role rights save pushes permissions:updated to the role's room", () => {
  test("POST /api/roles/:roleId/rights emits to room 'role:<roleId>'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/roles/7/rights")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ pagePermissions: [{ page: "material-issues", actions: ["view"] }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const push = mockEmittedEvents.find((e) => e.event === "permissions:updated");
    expect(push).toBeDefined();
    expect(push.room).toBe("role:7");
  });

  test("save still succeeds (200) even if socket.io isn't initialized", async () => {
    mockIoShouldThrow = true;
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/roles/7/rights")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ pagePermissions: [] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockEmittedEvents.length).toBe(0);
  });
});

describe("per-user rights save pushes permissions:updated to that user's room", () => {
  test("PUT /api/user-rights/:userId emits to room 'user:<userId>'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/user-rights/42")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ rightsJson: [{ page: "grn-master", actions: ["view", "create"] }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const push = mockEmittedEvents.find((e) => e.event === "permissions:updated");
    expect(push).toBeDefined();
    expect(push.room).toBe("user:42");
  });

  test("PATCH /api/users/:id/permissions emits to room 'user:<id>'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .patch("/api/users/99/permissions")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ pagePermissions: [{ page: "purchase-orders", actions: ["view"] }] });

    expect(res.status).toBe(200);

    const push = mockEmittedEvents.find((e) => e.event === "permissions:updated");
    expect(push).toBeDefined();
    expect(push.room).toBe("user:99");
  });

  test("save still succeeds even if socket.io isn't initialized (PUT /api/user-rights/:userId)", async () => {
    mockIoShouldThrow = true;
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/user-rights/42")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ rightsJson: [] });

    expect(res.status).toBe(200);
    expect(mockEmittedEvents.length).toBe(0);
  });
});

describe("socket.js: connection handler joins a role-scoped room", () => {
  // Verifies the room-join logic added to socket.js's connection handler
  // directly, without needing a real socket.io server/client pair.
  test("joins room 'role:<roleId>' in addition to the personal user room", () => {
    let connectionHandler;
    const joinedRooms = [];

    jest.doMock("socket.io", () => ({
      Server: class {
        constructor() {}
        use() {}
        on(event, handler) {
          if (event === "connection") connectionHandler = handler;
        }
      },
    }));
    jest.doMock("../db", () => ({ getPool: () => makeFakePool(), sql: require("mssql") }));
    jest.doMock("../redis", () => ({ redisGetStrict: jest.fn(async () => null) }));
    jest.doMock("../middleware/role", () => ({ normalizeRole: (r) => String(r || "").toLowerCase() }));
    jest.doMock("../config/origins", () => ({ ALLOWED_ORIGINS: ["http://localhost"] }));

    // Bypass the file-level jest.mock("../socket", ...) above — that mock
    // replaces initSocket with a no-op jest.fn(), which is exactly right for
    // the HTTP route tests (they only need getIo()) but wrong here, where
    // it's the real initSocket()'s connection-handler logic under test.
    const { initSocket } = jest.requireActual("../socket");
    initSocket({}); // fake httpServer — Server() is mocked above, never touches it

    const fakeSocket = {
      id: "sock1",
      data: { user: { userId: 5, role: "user", roleId: 4 } },
      join: (room) => joinedRooms.push(room),
      on: jest.fn(),
    };
    connectionHandler(fakeSocket);

    expect(joinedRooms).toContain("user:5");
    expect(joinedRooms).toContain("role:4");
  });
});
