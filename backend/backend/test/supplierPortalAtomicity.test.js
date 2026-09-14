process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "supplier-portal-atomicity-test-secret";

/**
 * Supplier Portal: multi-item price/catalog upserts must be atomic.
 *
 * Same bug class as materialRequestsAtomicity.test.js / quotationsAtomicity
 * .test.js, found during the same systematic pass (2026-07-03):
 * POST /quotations/:id/prices and PUT /catalog ran their item-loop MERGE
 * upserts on the plain pool.request() directly (no transaction). A failure
 * partway through the loop left some rows upserted and others not — lower
 * severity than the delete-then-reinsert routes since each MERGE is
 * independently idempotent and retry-safe, but still a real atomicity gap.
 * Fixed by wrapping both routes' loops in pool.transaction().
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
  req.id = req.headers["x-request-id"] || "supplier-portal-atomicity-test-request";
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
        // resolveSupplier() middleware's lookup.
        if (/FROM dbo\.users\s+WHERE id/i.test(text)) {
          return { recordset: [{ LinkedLHeadId: 42 }], rowsAffected: [1] };
        }
        // Tag check — supplier is tagged on this quotation.
        if (/FROM dbo\.QuotationSuppliers WHERE QuotationId=@id AND SupplierLHeadId/i.test(text)) {
          return { recordset: [{}], rowsAffected: [1] };
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
        // Item-belongs-to-quotation check inside the price-submit loop.
        if (/FROM dbo\.QuotationItems WHERE QuotationItemId=@qid/i.test(text)) {
          return { recordset: [{}], rowsAffected: [1] };
        }
        if (/MERGE dbo\.QuotationSupplierPrices/i.test(text)) {
          tx.mergeCount = (tx.mergeCount || 0) + 1;
          if (tx.failOnNthMerge && tx.mergeCount === tx.failOnNthMerge) {
            throw new Error("simulated mid-loop failure");
          }
          return { recordset: [], rowsAffected: [1] };
        }
        if (/MERGE dbo\.SupplierItemRates/i.test(text)) {
          tx.mergeCount = (tx.mergeCount || 0) + 1;
          if (tx.failOnNthMerge && tx.mergeCount === tx.failOnNthMerge) {
            throw new Error("simulated mid-loop failure");
          }
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

function supplierToken() {
  return jwt.sign(
    { userId: 1, id: 1, email: "supplier@example.com", name: "Test Supplier", role: "supplier" },
    process.env.JWT_SECRET,
  );
}

beforeEach(() => {
  mockFakePool = makeFakePool();
});

describe("Supplier Portal: POST /quotations/:id/prices item upserts are atomic", () => {
  test("mid-loop MERGE failure rolls back instead of partially submitting prices", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthMerge = 2;
      return tx;
    };

    const res = await request(app)
      .post("/api/supplier-portal/quotations/7/prices")
      .set("Authorization", `Bearer ${supplierToken()}`)
      .send({
        items: [
          { QuotationItemId: 1, Rate: 100 },
          { QuotationItemId: 2, Rate: 200 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid prices commit successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/supplier-portal/quotations/7/prices")
      .set("Authorization", `Bearer ${supplierToken()}`)
      .send({ items: [{ QuotationItemId: 1, Rate: 100 }] });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});

describe("Supplier Portal: PUT /catalog item upserts are atomic", () => {
  test("mid-loop MERGE failure rolls back instead of partially updating the catalog", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthMerge = 2;
      return tx;
    };

    const res = await request(app)
      .put("/api/supplier-portal/catalog")
      .set("Authorization", `Bearer ${supplierToken()}`)
      .send({
        items: [
          { ItemId: "ITEM-1", Rate: 10 },
          { ItemId: "ITEM-2", Rate: 20 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid catalog update commits successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/supplier-portal/catalog")
      .set("Authorization", `Bearer ${supplierToken()}`)
      .send({ items: [{ ItemId: "ITEM-1", Rate: 10 }] });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});
