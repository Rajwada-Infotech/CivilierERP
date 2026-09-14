process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "journal-voucher-atomicity-test-secret";

/**
 * Journal Voucher: header + lines writes must be atomic.
 *
 * Same bug class as materialRequestsAtomicity.test.js/quotationsAtomicity
 * .test.js: POST / and PUT /:id run the header insert/update and the
 * lines-insert loop inside one pool.transaction() so a failure partway
 * through the loop rolls back instead of leaving a permanently-committed,
 * unbalanced JV header.
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
  req.id = req.headers["x-request-id"] || "jv-atomicity-test-request";
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

// Auto-submit (Draft -> Pending) is a separate concern from the atomicity
// fix under test here.
jest.mock("../services/approvalService", () => ({
  transition: jest.fn(async () => {}),
  guardEdit: jest.fn(async () => {}),
}));

let txSpy;

function makeFakePool() {
  const plainRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/SELECT TOP 1 TypeOfDocId/i.test(text)) {
          return { recordset: [{ TypeOfDocId: 1 }], rowsAffected: [1] };
        }
        if (/SELECT Prefix, FullPrefix, StartingDocNo/i.test(text)) {
          return {
            recordset: [{ Prefix: "JV", FullPrefix: "JV", StartingDocNo: 1, DocNoPrefix: "JV", DocNoPadding: 5 }],
            rowsAffected: [1],
          };
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
        if (/INSERT INTO dbo\.JournalVoucherLines/i.test(text)) {
          tx.lineInsertCount = (tx.lineInsertCount || 0) + 1;
          if (tx.failOnNthLineInsert && tx.lineInsertCount === tx.failOnNthLineInsert) {
            throw new Error("simulated mid-loop failure (bad LHeadId)");
          }
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.JournalVoucher\b/i.test(text)) {
          return { recordset: [{ JVID: 999 }], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.JournalVoucher\b/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/DELETE FROM dbo\.JournalVoucherLines/i.test(text)) {
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

describe("Journal Voucher: POST / header+lines are atomic", () => {
  test("mid-loop line-insert failure rolls back instead of committing a partial header", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthLineInsert = 2;
      return tx;
    };

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 100 },
          { LHeadId: 2, CreditAmount: 100 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid lines commit successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 100 },
          { LHeadId: 2, CreditAmount: 100 },
        ],
      });

    expect(res.status).toBe(201);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});

describe("Journal Voucher: PUT /:id header-update + line-replacement are atomic", () => {
  test("mid-loop line-insert failure during line replacement rolls back", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthLineInsert = 2;
      return tx;
    };

    const res = await request(app)
      .put("/api/journal-voucher/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 200 },
          { LHeadId: 2, CreditAmount: 200 },
        ],
      });

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });

  test("all-valid line replacement commits successfully, no rollback", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/journal-voucher/7")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 200 },
          { LHeadId: 2, CreditAmount: 200 },
        ],
      });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();
  });
});
