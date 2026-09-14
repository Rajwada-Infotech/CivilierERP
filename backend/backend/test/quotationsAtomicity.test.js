process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "quotations-atomicity-test-secret";

/**
 * Quotations: header + item-loop (+ supplier-loop) writes must be atomic.
 *
 * Same bug class as materialRequestsAtomicity.test.js, found during the same
 * systematic pass over multi-step write routes (2026-07-03): POST / and
 * PUT /:id in quotations.js used to run the header insert/update, item-loop
 * insert(s), and (on create) supplier-tag inserts on the plain pool.request()
 * directly (no transaction). A failure partway through any loop left a
 * permanently-committed partial header, or — on PUT, which deletes all
 * existing items before re-inserting — active data loss. Live-verified
 * against the real DB: row counts unchanged after a forced mid-loop failure
 * on POST. Fixed by wrapping both routes' critical sections in
 * pool.transaction().
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
  req.id = req.headers["x-request-id"] || "quotations-atomicity-test-request";
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

let txSpy;

function makeFakePool() {
  const plainRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.Quotations\s+WHERE QuotationId/i.test(text)) {
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
        if (/INSERT INTO dbo\.QuotationItems/i.test(text)) {
          tx.itemInsertCount = (tx.itemInsertCount || 0) + 1;
          if (tx.failOnNthItemInsert && tx.itemInsertCount === tx.failOnNthItemInsert) {
            throw new Error("simulated mid-loop failure (bad ItemId)");
          }
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.Quotations\b/i.test(text)) {
          return { recordset: [{ QuotationId: 999 }], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.Quotations\b/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/DELETE FROM dbo\.QuotationItems/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.QuotationSuppliers/i.test(text)) {
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

describe("Quotations: POST / header+items are atomic", () => {
  test("mid-loop item-insert failure rolls back instead of committing a partial header", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthItemInsert = 2;
      return tx;
    };

    const res = await request(app)
      .post("/api/quotations")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3,
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
      .post("/api/quotations")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3,
        items: [{ ItemId: "ITEM-1", Quantity: 5 }],
      });

    expect(res.status).toBe(201);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});

describe("Quotations: PUT /:id header-update + item-replacement are atomic", () => {
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
      .put("/api/quotations/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3,
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
      .put("/api/quotations/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 1, ProjectId: 3,
        items: [{ ItemId: "NEW-ITEM-1", Quantity: 2 }],
      });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});
