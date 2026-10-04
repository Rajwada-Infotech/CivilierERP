process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "veh-upload-test-secret";

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
  req.id = req.headers["x-request-id"] || "veh-upload-test";
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


let mockRights = [];
jest.mock("../middleware/permissions", () => {
  const real = jest.requireActual("../middleware/permissions");
  return {
    ...real,
    checkPermission: () => (_req, _res, next) => next(),
    getEffectivePagePermissions: jest.fn(async () => mockRights),
  };
});
jest.mock("../services/approvalService", () => ({ transition: jest.fn(async () => {}), guardEdit: jest.fn(async () => {}) }));

let mockRows;
let mockLinked = null;
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          if (/INSERT INTO dbo.VehicleInOutAttachments/i.test(text)) return { recordset: [{ AttachmentId: 77 }], rowsAffected: [1] };
          if (/SELECT VehicleInOutID FROM dbo.VehicleInOutAttachments/i.test(text))
            return { recordset: mockLinked === undefined ? [] : [{ VehicleInOutID: mockLinked }] };
          if (/DELETE FROM dbo.VehicleInOutAttachments/i.test(text)) return { recordset: [], rowsAffected: [1] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  }),
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));

const token = (role = "store_keeper") =>
  jwt.sign({ userId: 9, email: "hiren@example.com", name: "Hiren", role, roleId: 1008 }, process.env.JWT_SECRET);
const rights = (...actions) => [{ page: "vehicle-in-out", actions }];

let app;
beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});
beforeEach(() => {
  mockRights = [];
  mockLinked = null;
});

const upload = (t = token(), name = "photo.jpg", type = "image/jpeg") =>
  request(app).post("/api/vehicle-in-out/upload").set("Authorization", "Bearer " + t).attach("file", Buffer.from("x"), { filename: name, contentType: type });

describe("Vehicle In/Out: attachment upload rights", () => {
  test("a create-only user (view + create) can upload", async () => {
    mockRights = rights("view", "create");
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body.ids).toEqual([77]);
  });
  test("an edit user can upload too", async () => {
    mockRights = rights("view", "edit");
    expect((await upload()).status).toBe(200);
  });
  test("a view-only user cannot upload", async () => {
    mockRights = rights("view");
    expect((await upload()).status).toBe(403);
  });
  test("admins always can", async () => {
    expect((await upload(token("admin"))).status).toBe(200);
  });
  test("a disallowed file type comes back as a readable 400, not a crash", async () => {
    mockRights = rights("create");
    const res = await upload(token(), "virus.exe", "application/x-msdownload");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/images.*PDF/i);
  });
  test("PDFs are accepted", async () => {
    mockRights = rights("create");
    expect((await upload(token(), "bill.pdf", "application/pdf")).status).toBe(200);
  });
});

describe("Vehicle In/Out: removing an attachment", () => {
  const del = (t = token()) => request(app).delete("/api/vehicle-in-out/attachment/77").set("Authorization", "Bearer " + t);
  test("a create-only user can drop a file they uploaded on the unsaved form", async () => {
    mockRights = rights("view", "create");
    mockLinked = null;
    expect((await del()).status).toBe(200);
  });
  test("...but not one already attached to a saved record", async () => {
    mockRights = rights("view", "create");
    mockLinked = 12;
    expect((await del()).status).toBe(403);
  });
  test("a user with Delete can remove a saved record's file", async () => {
    mockRights = rights("view", "delete");
    mockLinked = 12;
    expect((await del()).status).toBe(200);
  });
  test("unknown attachment -> 404", async () => {
    mockRights = rights("create");
    mockLinked = undefined;
    expect((await del()).status).toBe(404);
  });
});
