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


const { validateSettlementMode, normalizeSettlementMode, assertChequeLeafFree } = require("../utils/settlementMode");

const validLines = [{ LHeadId: 1, DebitAmount: 100 }, { LHeadId: 2, CreditAmount: 100 }];
const post = async (extra) => {
  const { createApp } = require("../server");
  const app = await createApp();
  return request(app)
    .post("/api/journal-voucher")
    .set("Authorization", `Bearer ${superAdminToken()}`)
    .send({ JVDate: "2026-07-03", CompanyId: 1, lines: validLines, ...extra });
};

describe("Journal Voucher: payment mode validation (POST /)", () => {
  test("unknown mode -> 400", async () => {
    const res = await post({ Mode: "Barter" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid payment Mode/i);
  });
  test("Cheque without a bank -> 400", async () => {
    const res = await post({ Mode: "Cheque", ChequeLotId: 1, ChequeNo: "100001", ChequeDate: "2026-07-03" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bank account/i);
  });
  test("Cheque without a lot/number -> 400", async () => {
    const res = await post({ Mode: "Cheque", BankId: 58 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cheque lot and cheque number/i);
  });
  test("Post-Dated Cheque without a date -> 400", async () => {
    const res = await post({ Mode: "Post-Dated Cheque", BankId: 58, ChequeLotId: 1, ChequeNo: "100001" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cheque date/i);
  });
});

describe("settlementMode helpers", () => {
  test("a plain journal (no mode) is valid and normalises to all-null", () => {
    expect(validateSettlementMode({})).toBeNull();
    expect(normalizeSettlementMode({})).toMatchObject({ Mode: null, BankId: null, ChequeLotId: null, ChequeNo: null, DigitalRefNumber: null, IsPostDated: 0 });
  });
  test("Cash and digital modes need no cheque; cash drops stale detail", () => {
    expect(validateSettlementMode({ Mode: "Cash" })).toBeNull();
    expect(validateSettlementMode({ Mode: "NEFT" })).toBeNull();
    const n = normalizeSettlementMode({ Mode: "Cash", BankId: 5, ChequeLotId: 1, ChequeNo: "9", DigitalRefNumber: "X" });
    expect(n).toMatchObject({ Mode: "Cash", BankId: null, ChequeLotId: null, ChequeNo: null, DigitalRefNumber: null });
  });
  test("digital mode keeps bank + reference, drops cheque detail", () => {
    const n = normalizeSettlementMode({ Mode: "UPI", BankId: "5", DigitalRefNumber: " 123 ", ChequeLotId: 1, ChequeNo: "9" });
    expect(n).toMatchObject({ Mode: "UPI", BankId: 5, DigitalRefNumber: "123", ChequeLotId: null, ChequeNo: null });
  });
  test("PDC is flagged post-dated", () => {
    expect(normalizeSettlementMode({ Mode: "Post-Dated Cheque", BankId: 1, ChequeLotId: 1, ChequeNo: "1", ChequeDate: "2026-09-01" }).IsPostDated).toBe(1);
  });
});

describe("assertChequeLeafFree", () => {
  const lotRow = { ChequeLotNumber: "LOT-1", BankId: 58, ChequeStartNumber: "100001", ChequeEndNumber: "100050" };
  const executor = (lot, used = {}) => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) =>
          /FROM dbo.ChequeMaster/i.test(text)
            ? { recordset: lot ? [lot] : [] }
            : { recordset: [{ pay: 0, ft: 0, ls: 0, jv: 0, cancelled: 0, ...used }] },
      };
      return r;
    },
  });
  const args = { lotId: 1, chequeNo: "100010", bankId: 58 };

  test("free leaf -> returns the lot number", async () => {
    await expect(assertChequeLeafFree(executor(lotRow), args)).resolves.toBe("LOT-1");
  });
  test.each([
    [{ pay: 1 }, /Payment/],
    [{ ft: 1 }, /Fund Transfer/],
    [{ ls: 1 }, /Loan Sanction/],
    [{ jv: 1 }, /Journal Voucher/],
    [{ cancelled: 1 }, /cancelled/],
  ])("claimed elsewhere %j -> 409", async (used, msg) => {
    await expect(assertChequeLeafFree(executor(lotRow, used), args)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(msg) });
  });
  test("missing lot, wrong bank, out of range -> 400", async () => {
    await expect(assertChequeLeafFree(executor(null), args)).rejects.toMatchObject({ status: 400 });
    await expect(assertChequeLeafFree(executor(lotRow), { ...args, bankId: 99 })).rejects.toMatchObject({ status: 400 });
    await expect(assertChequeLeafFree(executor(lotRow), { ...args, chequeNo: "100051" })).rejects.toMatchObject({ status: 400 });
    await expect(assertChequeLeafFree(executor(lotRow), { ...args, chequeNo: "abc" })).rejects.toMatchObject({ status: 400 });
  });
});
