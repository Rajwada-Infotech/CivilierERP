process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "new-payment-dummy-bank-test-secret";

/**
 * New Payment (Payment Made): Inter-Company Stock Transfer payments must
 * always deposit to the Dummy Bank ledger head, mirroring the identical
 * SourceSaleInvoiceId handling already in receivedPayment.js for the
 * mirror-image (customer/receiving) side of that feature. A client-supplied
 * bank that doesn't match the Dummy Bank is rejected rather than silently
 * overridden; an absent one is force-set.
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
  req.id = req.headers["x-request-id"] || "new-payment-dummy-bank-test-request";
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
}));

const DUMMY_BANK_ID = 999;

function makeFakePool() {
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/LHeadCode = 'DUMMY-BANK'/i.test(text)) {
          return { recordset: [{ LHeadId: DUMMY_BANK_ID, LHeadName: "Dummy Bank" }] };
        }
        if (/SELECT TOP 1 TypeOfDocId/i.test(text)) {
          return { recordset: [{ TypeOfDocId: 1 }] };
        }
        if (/SELECT Prefix, FullPrefix, StartingDocNo/i.test(text)) {
          return {
            recordset: [{ Prefix: "PAY", FullPrefix: "PAY", StartingDocNo: 1, DocNoPrefix: "PAY", DocNoPadding: 5 }],
          };
        }
        if (/INSERT INTO dbo\.NewPayment/i.test(text)) {
          return { recordset: [{ PPaymentID: 1 }], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return { request: makeRequest };
}

let mockFakePool;
let capturedInputs;
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
  // Wrap request() to capture the PBankID/PBankName actually bound on the
  // INSERT INTO dbo.NewPayment call, so we can assert what was persisted.
  capturedInputs = {};
  const origRequest = mockFakePool.request;
  mockFakePool.request = () => {
    const req = origRequest();
    const origInput = req.input.bind(req);
    req.input = (name, type, value) => {
      capturedInputs[name] = value;
      return origInput(name, type, value);
    };
    return req;
  };
});

describe("New Payment: Inter-Company Stock Transfer forces the Dummy Bank", () => {
  test("no bank supplied -> Dummy Bank is force-set", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/new-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        PMode: "Cash",
        PAmount: 500,
        PDate: "2026-07-03",
        IsInterCompanyTransfer: true,
      });

    expect(res.status).toBe(201);
    expect(capturedInputs.PBankID).toBe(DUMMY_BANK_ID);
    expect(capturedInputs.PBankName).toBe("Dummy Bank");
  });

  test("client-supplied bank matching the Dummy Bank is accepted", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/new-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        PMode: "Cash",
        PAmount: 500,
        PDate: "2026-07-03",
        PBankID: DUMMY_BANK_ID,
        IsInterCompanyTransfer: true,
      });

    expect(res.status).toBe(201);
    expect(capturedInputs.PBankID).toBe(DUMMY_BANK_ID);
  });

  test("client-supplied bank NOT matching the Dummy Bank is rejected with 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/new-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        PMode: "Cash",
        PAmount: 500,
        PDate: "2026-07-03",
        PBankID: 42,
        IsInterCompanyTransfer: true,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Dummy Bank/i);
  });

  test("a normal (non inter-company) payment is unaffected", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/new-payment")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        PMode: "Cash",
        PAmount: 500,
        PDate: "2026-07-03",
        PBankID: 42,
      });

    expect(res.status).toBe(201);
    expect(capturedInputs.PBankID).toBe(42);
  });
});
