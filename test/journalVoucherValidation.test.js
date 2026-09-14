process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "journal-voucher-validation-test-secret";

/**
 * Journal Voucher: required-field and balance validation.
 *
 * A JV is a manual multi-line debit/credit entry used to forcefully correct
 * an account-head mismatch. Since it posts straight to the GL once approved
 * (postJournalVoucherApproval maps lines 1:1 onto postVoucher()'s legs), an
 * unbalanced or malformed JV must be rejected with a clean 400 before it
 * ever reaches the database — mirroring the balance check already enforced
 * inside generalLedger.js's postVoucher().
 *
 * The mssql pool is faked — no real DB is touched.
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
  req.id = req.headers["x-request-id"] || "jv-validation-test-request";
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

jest.mock("../services/approvalService", () => ({
  transition: jest.fn(async () => {}),
  guardEdit: jest.fn(async () => {}),
}));

jest.mock("mssql", () => {
  const real = jest.requireActual("mssql");
  function MockTransaction() {
    this.begin = jest.fn(async () => {});
    this.commit = jest.fn(async () => {});
    this.rollback = jest.fn(async () => {});
    this.request = () => ({
      input() { return this; },
      query: async () => ({ recordset: [{ JVID: 1 }], rowsAffected: [1] }),
    });
  }
  return { ...real, Transaction: MockTransaction };
});

function makeFakePool() {
  const makeRequest = () => {
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
        if (/INSERT INTO dbo\.JournalVoucher\b/i.test(text)) {
          return { recordset: [{ JVID: 1 }], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  const makeTransaction = () => ({
    begin: async () => {},
    commit: async () => {},
    rollback: async () => {},
    request: makeRequest,
  });
  return { request: makeRequest, transaction: makeTransaction };
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

describe("Journal Voucher: validation", () => {
  test("POST / without JVDate -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ lines: [{ LHeadId: 1, DebitAmount: 100 }, { LHeadId: 2, CreditAmount: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JVDate is required/i);
  });

  test("POST / with fewer than 2 lines -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ JVDate: "2026-07-03", lines: [{ LHeadId: 1, DebitAmount: 100 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2 lines/i);
  });

  test("POST / with a line missing LHeadId -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [{ DebitAmount: 100 }, { LHeadId: 2, CreditAmount: 100 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/LHeadId/i);
  });

  test("POST / with a line that has both debit and credit -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 100, CreditAmount: 50 },
          { LHeadId: 2, CreditAmount: 100 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive DebitAmount or a positive CreditAmount/i);
  });

  test("POST / with unbalanced debit/credit totals -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/journal-voucher")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        JVDate: "2026-07-03",
        lines: [
          { LHeadId: 1, DebitAmount: 100 },
          { LHeadId: 2, CreditAmount: 90 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not balance/i);
  });

  test("POST / with balanced lines succeeds", async () => {
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
  });
});
