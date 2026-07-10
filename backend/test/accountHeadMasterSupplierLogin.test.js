process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "account-head-supplier-login-test-secret";

/**
 * Supplier Master: auto-generated login email + bcrypt password.
 *
 * Creating a Supplier (LHeadType='S') auto-generates a <name>@civilier.in
 * login email and bcrypt-hashes a password (reusing routes/users.js's own
 * bcrypt/SALT_ROUNDS convention, not a new mechanism). The password is
 * optional at creation time — left blank, it defaults to "123456" so
 * creating a supplier is never blocked on picking a password up front; an
 * admin can always set/change it later via PUT. AccountHeadMaster is the
 * shared, generic ledger-
 * head table (suppliers/customers/banks/GL heads as rows, distinguished by
 * LHeadType) and stores NO login-related columns at all — the credential
 * lives solely in a linked dbo.users row (role='supplier', LinkedLHeadId),
 * exactly the mechanism every other user in the system authenticates
 * through. Without that row the supplier could never actually log in
 * anywhere.
 *
 * The mssql pool/transaction is faked (same pattern as
 * materialRequestsAtomicity.test.js) so these tests exercise only the
 * route's own logic: validation, email generation, hashing, and the
 * atomic AccountHeadMaster + dbo.users insert/update.
 */

const jwt = require("jsonwebtoken");
const request = require("supertest");
const bcrypt = require("bcrypt");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));

jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});

jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = req.headers["x-request-id"] || "ahm-supplier-login-test-request";
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
let insertedUsersRow = null;
let updatedUsersPassword = null;
let failOnUsersInsert = false;

const COLUMN_META_ROWS = [
  "LHeadId", "LHeadName", "LHeadCode", "LHeadType", "LHeadPhone", "LHeadEmail",
  "LHeadAddress", "LHeadContactPerson", "LHeadStatus", "LHeadPaymentTerms",
  "LBranchName", "LGST", "LGSTState", "LCountry", "LBelongsTo", "LDescription",
  "Status", "isEdited", "LGSTType", "LHeadPan", "LHeadCategory", "IsTdsApplicable",
  "CreatedBy", "CreatedAt", "UpdatedBy", "UpdatedAt", "ApprovedBy", "ApprovedAt",
].map((name) => ({ COLUMN_NAME: name, DATA_TYPE: "nvarchar", IS_NULLABLE: "YES" }));

function makeFakePool() {
  const plainRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/INFORMATION_SCHEMA\.COLUMNS/i.test(text)) {
          return { recordset: COLUMN_META_ROWS };
        }
        // Email-collision check inside generateSupplierLoginEmail — no
        // existing dbo.users row with this email yet, so the first
        // candidate (no numeric suffix) is free.
        if (/FROM dbo\.users WHERE email/i.test(text)) {
          return { recordset: [] };
        }
        if (/SELECT Status FROM dbo\.AccountHeadMaster WHERE LHeadId/i.test(text)) {
          return { recordset: [{ Status: "Draft" }] };
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
        if (/SELECT TOP 1 RId FROM dbo\.Role WHERE LOWER\(RName\) = 'supplier'/i.test(text)) {
          return { recordset: [{ RId: 42 }] };
        }
        if (/INSERT INTO dbo\.AccountHeadMaster/i.test(text)) {
          return { recordset: [{ LHeadId: 501 }], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.AccountHeadMaster/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.users/i.test(text)) {
          if (failOnUsersInsert) throw new Error("simulated dbo.users insert failure");
          insertedUsersRow = { ...req._lastInputs };
          return { recordset: [], rowsAffected: [1] };
        }
        if (/UPDATE dbo\.users SET password/i.test(text)) {
          updatedUsersPassword = req._lastInputs?.password;
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    // Capture .input() calls so assertions can inspect what was written.
    const originalInput = req.input;
    req._lastInputs = {};
    req.input = (name, _type, value) => {
      req._lastInputs[name] = value;
      return originalInput();
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
  insertedUsersRow = null;
  updatedUsersPassword = null;
  failOnUsersInsert = false;
  txSpy = undefined;
});

describe("Supplier Master: default password + auto-generated login", () => {
  test("POST / with no password succeeds and defaults the login to \"123456\"", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/account-head")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ LHeadName: "Acme Steel Co", LHeadType: "S", LHeadPan: "ABCDE1234F" });

    expect(res.status).toBe(200);
    expect(res.body.SupplierPasswordDefaulted).toBe(true);
    expect(res.body.SupplierDefaultPassword).toBe("123456");
    expect(txSpy.commit).toHaveBeenCalledTimes(1);

    expect(insertedUsersRow).not.toBeNull();
    await expect(bcrypt.compare("123456", insertedUsersRow.password)).resolves.toBe(true);
  }, 15000);

  test("POST / rejects a supplier password shorter than 6 characters when one is given", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/account-head")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        LHeadName: "Acme Steel Co", LHeadType: "S", LHeadPan: "ABCDE1234F",
        SupplierPassword: "abc",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SUPPLIER_PASSWORD");
    expect(txSpy).toBeUndefined(); // never even opened a transaction
  });

  test("POST / creates the ledger head AND a linked dbo.users login, email auto-generated", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/account-head")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        LHeadName: "Acme Steel Co", LHeadType: "S", LHeadPan: "ABCDE1234F",
        SupplierPassword: "correct-horse",
      });

    expect(res.status).toBe(200);
    expect(res.body.SupplierLoginEmail).toBe("acmesteelco@civilier.in");
    expect(res.body.LHeadId).toBe(501);

    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(txSpy.rollback).not.toHaveBeenCalled();

    // The linked login row must exist, point back at the new ledger head,
    // carry the 'supplier' role, and store a REAL bcrypt hash (not the
    // plaintext password) matching what was entered.
    expect(insertedUsersRow).not.toBeNull();
    expect(insertedUsersRow.email).toBe("acmesteelco@civilier.in");
    expect(insertedUsersRow.LinkedLHeadId).toBe(501);
    expect(insertedUsersRow.RoleId).toBe(42);
    expect(insertedUsersRow.password).not.toBe("correct-horse");
    await expect(bcrypt.compare("correct-horse", insertedUsersRow.password)).resolves.toBe(true);
  });

  test("POST / rolls back the whole transaction if creating the linked login fails", async () => {
    failOnUsersInsert = true;
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/account-head")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        LHeadName: "Broken Supplier Co", LHeadType: "S", LHeadPan: "ABCDE1234F",
        SupplierPassword: "correct-horse",
      });

    expect(res.status).toBe(500);
    expect(txSpy.commit).not.toHaveBeenCalled();
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
  });

  test("PUT /:id with a new password re-hashes and syncs both AccountHeadMaster and dbo.users", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/account-head/501")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        LHeadName: "Acme Steel Co", LHeadType: "S", LHeadPan: "ABCDE1234F",
        SupplierPassword: "new-password-123",
      });

    expect(res.status).toBe(200);
    expect(txSpy.commit).toHaveBeenCalledTimes(1);
    expect(updatedUsersPassword).not.toBe("new-password-123");
    await expect(bcrypt.compare("new-password-123", updatedUsersPassword)).resolves.toBe(true);
  });

  test("PUT /:id without a password leaves existing credentials untouched", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/account-head/501")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ LHeadName: "Acme Steel Co", LHeadType: "S", LHeadPan: "ABCDE1234F" });

    expect(res.status).toBe(200);
    expect(updatedUsersPassword).toBeNull();
  });
});
