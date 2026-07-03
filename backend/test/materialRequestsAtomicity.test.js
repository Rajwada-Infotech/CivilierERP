process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "material-requests-atomicity-test-secret";

/**
 * Material Requests: header + item-loop writes must be atomic.
 *
 * Regression tests for a bug found during a systematic pass over multi-step
 * write routes (2026-07-03): POST / and PUT /:id in materialRequests.js used
 * to run the header insert/update and the item-loop insert(s) on the plain
 * pool.request() directly (no transaction), so a failure partway through the
 * item loop left a permanently-committed, partial header. The PUT route was
 * worse — it deletes all existing items before re-inserting the new set, so
 * a mid-loop failure caused active data loss (neither the old nor the new
 * items survived). Live-verified against the real DB: row counts were
 * unchanged after a forced mid-loop failure (POST), and the original item
 * was preserved after a forced mid-loop failure (PUT). Fixed by wrapping
 * both routes' critical sections in pool.transaction().
 *
 * Here the mssql pool is faked, and pool.transaction() returns a spy object
 * so we can assert commit()/rollback() call behavior deterministically
 * without touching a real DB.
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
  req.id = req.headers["x-request-id"] || "mr-atomicity-test-request";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});

jest.mock("../routes/dba", () => {
  const express = require("express");
  return express.Router();
});

// Auto-submit (Draft -> Pending) is a separate concern from the atomicity
// fix under test here, and its real implementation uses `new sql.Transaction`
// directly rather than pool.transaction() — incompatible with the fake pool
// object below. Stub it out so it's a no-op.
jest.mock("../services/approvalService", () => ({
  transition: jest.fn(async () => {}),
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

let txSpy;

function makeFakePool() {
  const plainRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.MaterialRequests\s+WHERE MRId/i.test(text)) {
          return { recordset: [{ Status: "Draft" }], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };

  const makeTxRequest = (tx) => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/INSERT INTO dbo\.MaterialRequestItems/i.test(text)) {
          tx.itemInsertCount = (tx.itemInsertCount || 0) + 1;
          if (tx.failOnNthItemInsert && tx.itemInsertCount === tx.failOnNthItemInsert) {
            throw new Error("simulated mid-loop failure (bad ItemId)");
          }
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.MaterialRequests\b/i.test(text)) {
          return { recordset: [{ MRId: 999 }], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.MaterialRequests\b/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/DELETE FROM dbo\.MaterialRequestItems/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };

  return {
    request: plainRequest,
    transaction: () => {
      txSpy = {
        begin: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        request: () => makeTxRequest(txSpy),
      };
      return txSpy;
    },
  };
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
  return jwt.sign(
    { userId: 1, email: "smoke@example.com", name: "Super Admin", role: "super_admin", roleId: 1 },
    process.env.JWT_SECRET,
  );
}

beforeEach(() => {
  mockFakePool = makeFakePool();
});

describe("Material Requests: POST / header+items are atomic", () => {
  test("mid-loop item-insert failure rolls back instead of committing a partial header", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    // Pre-set the transaction to fail on the 2nd item insert, before the
    // pool.transaction() is even created by the route (txSpy is created
    // lazily inside transaction(), so we hook via a pending flag).
    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthItemInsert = 2;
      return tx;
    };

    const res = await request(app)
      .post("/api/material-requests")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3, Reason: "atomicity-test",
        items: [
          { ItemId: "ITEM-1", Quantity: 5 },
          { ItemId: "ITEM-2", Quantity: 3 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid items commit successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-requests")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3, Reason: "atomicity-test-happy-path",
        items: [{ ItemId: "ITEM-1", Quantity: 5 }],
      });

    expect(res.status).toBe(201);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});

describe("Material Requests: PUT /:id header-update + item-replacement are atomic", () => {
  test("mid-loop item-insert failure during item replacement rolls back (no data loss)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthItemInsert = 2;
      return tx;
    };

    const res = await request(app)
      .put("/api/material-requests/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3, Reason: "atomicity-test-update",
        items: [
          { ItemId: "NEW-ITEM-1", Quantity: 2 },
          { ItemId: "NEW-ITEM-2", Quantity: 1 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid item replacement commits successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/material-requests/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3, Reason: "atomicity-test-update-happy-path",
        items: [{ ItemId: "NEW-ITEM-1", Quantity: 2 }],
      });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});
