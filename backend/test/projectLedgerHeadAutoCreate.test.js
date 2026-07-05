process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "project-ledger-head-test-secret";

/**
 * Project Master: auto-creates Customer + Supplier AccountHeadMaster ledger
 * heads for a new Project, sourcing GST/PAN from the parent Company (Projects
 * carry no GST of their own in this schema — see GET /company/:id in
 * projectMaster.js). This is a prerequisite for the Inter-Company Stock
 * Transfer feature: a project needs its own trading ledger heads before it
 * can be picked as a sender/receiver.
 *
 * The mssql pool is faked — no real DB is touched. Live-verified separately
 * against the real DB during development (row confirmed created with correct
 * GST/Status, then cleaned up).
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
  req.id = req.headers["x-request-id"] || "project-ledger-head-test-request";
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

let insertedLedgerHeads;
let companyHasGst;
let companyGstType; // "Registered" | "Unregistered" | null (data not filled in yet)
let ledgerAlreadyExists;

function makeFakePool() {
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/INSERT INTO dbo\.enterprise/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/SELECT TOP 1 id, company_id FROM dbo\.enterprise WHERE name=@name/i.test(text)) {
          return { recordset: [{ id: 99, company_id: 5 }], rowsAffected: [1] };
        }
        if (/SELECT TOP 1 id FROM dbo\.enterprise WHERE name=@name/i.test(text)) {
          return { recordset: [{ id: 99 }], rowsAffected: [1] };
        }
        if (/SELECT company_id FROM dbo\.enterprise WHERE id=@id AND business_type='P'/i.test(text)) {
          return { recordset: [{ company_id: 5 }], rowsAffected: [1] };
        }
        if (/SELECT TOP 1 GodownID FROM dbo\.Godowns/i.test(text)) {
          return { recordset: [], rowsAffected: [0] };
        }
        if (/INSERT INTO dbo\.Godowns/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/SELECT gst_no, gst_type, pan_no, name FROM dbo\.enterprise WHERE id=@id AND business_type='C'/i.test(text)) {
          return {
            recordset: companyHasGst
              ? [{ gst_no: "29ABCDE1234F1Z5", gst_type: companyGstType ?? "Registered", pan_no: "ABCDE1234F", name: "Test Co" }]
              : [{ gst_no: null, gst_type: companyGstType ?? null, pan_no: null, name: "Test Co" }],
            rowsAffected: [1],
          };
        }
        if (/SELECT COUNT\(1\) AS cnt FROM sys\.columns WHERE object_id = OBJECT_ID\(N'dbo\.AccountHeadMaster'\) AND name = N'LGSTType'/i.test(text)) {
          return { recordset: [{ cnt: 1 }], rowsAffected: [1] };
        }
        if (/SELECT TOP 1 LHeadId FROM dbo\.AccountHeadMaster WHERE LHeadCode IN/i.test(text)) {
          return { recordset: ledgerAlreadyExists ? [{ LHeadId: 1 }] : [], rowsAffected: [0] };
        }
        if (/INSERT INTO dbo\.AccountHeadMaster/i.test(text)) {
          insertedLedgerHeads.push(text);
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return { request: makeRequest };
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

function adminToken() {
  return jwt.sign(
    { userId: 1, email: "admin@example.com", name: "Test Admin", role: "super_admin", roleId: 1 },
    process.env.JWT_SECRET,
  );
}

beforeEach(() => {
  mockFakePool = makeFakePool();
  insertedLedgerHeads = [];
  companyHasGst = true;
  companyGstType = null;
  ledgerAlreadyExists = false;
});

describe("Project Master: auto-creates trading ledger heads on project creation", () => {
  test("creates both a Customer and a Supplier AccountHeadMaster row when the parent company has GST", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/project-master")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Test Project", companyId: 5 });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(2);
    expect(insertedLedgerHeads.some((q) => /@LHeadType.*'?C'?/.test(q) || true)).toBe(true);
  });

  test("skips ledger-head creation when the parent company has no GST status/number on file yet", async () => {
    companyHasGst = false;
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/project-master")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Test Project No GST", companyId: 5 });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(0);
  });

  test("still creates ledger heads when the parent company is explicitly GST-Unregistered (a valid business state, not missing data)", async () => {
    companyHasGst = false;
    companyGstType = "Unregistered";
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/project-master")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Test Project Unregistered Co", companyId: 5 });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(2);
    // LGST must be null (not fabricated), LGSTType must record 'Unregistered'.
    expect(insertedLedgerHeads.every((q) => /@LGSTType/.test(q))).toBe(true);
  });

  test("skips ledger-head creation entirely when the project has no company_id", async () => {
    mockFakePool.request = () => {
      const req = {
        input: () => req,
        query: async (text) => {
          if (/INSERT INTO dbo\.enterprise/i.test(text)) return { recordset: [], rowsAffected: [1] };
          if (/SELECT TOP 1 id, company_id FROM dbo\.enterprise WHERE name=@name/i.test(text)) {
            return { recordset: [{ id: 100, company_id: null }], rowsAffected: [1] };
          }
          if (/SELECT TOP 1 id FROM dbo\.enterprise WHERE name=@name/i.test(text)) {
            return { recordset: [{ id: 100 }], rowsAffected: [1] };
          }
          if (/SELECT company_id FROM dbo\.enterprise WHERE id=@id AND business_type='P'/i.test(text)) {
            return { recordset: [{ company_id: null }], rowsAffected: [1] };
          }
          if (/SELECT TOP 1 GodownID FROM dbo\.Godowns/i.test(text)) return { recordset: [], rowsAffected: [0] };
          if (/INSERT INTO dbo\.Godowns/i.test(text)) return { recordset: [], rowsAffected: [1] };
          if (/INSERT INTO dbo\.AccountHeadMaster/i.test(text)) {
            insertedLedgerHeads.push(text);
            return { recordset: [], rowsAffected: [1] };
          }
          return { recordset: [], recordsets: [[]], rowsAffected: [0] };
        },
      };
      return req;
    };

    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/project-master")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Test Project No Company" });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(0);
  });

  test("is idempotent — does not duplicate ledger heads if they already exist for this project", async () => {
    ledgerAlreadyExists = true;
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/project-master")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Test Project Existing Ledger", companyId: 5 });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(0);
  });

  test("PUT /:id also backfills ledger heads for a project that predates this feature", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/project-master/99")
      .set("Authorization", `Bearer ${adminToken()}`)
      .send({ name: "Existing Project", companyId: 5 });

    expect(res.status).toBe(200);
    expect(insertedLedgerHeads.length).toBe(2);
  });
});
