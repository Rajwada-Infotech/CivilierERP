process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "procurement-test-secret";

/**
 * Purchase Orders + Expense Booking + Work Orders + Material Issues:
 * required-field validation.
 *
 * Regression tests for the same bug class found repeatedly during a live-DB
 * workflow test (2026-07-02): several NOT NULL columns had no fallback
 * default in their INSERT/UPDATE statements (PODate/SupplierID in
 * PurchaseOrders; EProjectName/EDocumentType/EDocDate/ECompanyId in
 * ExpenseBooking; CompanyId/ProjectId/DocumentDate/ContractorId/
 * DocumentNumber in WorkOrderHeader; CompanyId/ProjectId/Date/Reason in
 * MaterialIssues). Omitting any of them used to reach the database and
 * crash with an unhandled SQL "Cannot insert the value NULL into column
 * 'X'" error — either a raw 500 leaking internal table/column names, or (in
 * materialIssues.js) an opaque generic 500 — instead of a clean 400
 * validation error. Fixed with explicit early checks in each route.
 *
 * The mssql pool is faked — no real DB is touched. These tests only need
 * to prove the route returns 400 with a clear message *before* ever
 * reaching the database, so the fake pool's queries are never exercised
 * for the failing cases.
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
  req.id = req.headers["x-request-id"] || "procurement-test-request";
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

jest.mock("mssql", () => {
  const real = jest.requireActual("mssql");
  function MockTransaction(pool) {
    this.begin = jest.fn(async () => {});
    this.commit = jest.fn(async () => {});
    this.rollback = jest.fn(async () => {});
    this.request = () => pool.request();
  }
  return { ...real, Transaction: MockTransaction };
});

function makeFakePool() {
  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/COUNT\(/i.test(text)) return { recordset: [{ total: 0, cnt: 0 }], rowsAffected: [0] };
        // guardEdit()'s status lookup — return a "Draft" row so the PUT
        // handlers get past their own guardEdit() call and reach the
        // required-field validation actually under test here.
        if (/FROM dbo\.ExpenseBooking/i.test(text) && /EStatus/i.test(text)) {
          return { recordset: [{ status: "Draft" }], rowsAffected: [0] };
        }
        if (/FROM dbo\.PurchaseOrders/i.test(text) && /Status/i.test(text)) {
          return { recordset: [{ status: "Draft" }], rowsAffected: [0] };
        }
        if (/FROM dbo\.WorkOrderHeader/i.test(text) && /Status/i.test(text)) {
          return { recordset: [{ status: "Draft" }], rowsAffected: [0] };
        }
        if (/FROM dbo\.MaterialIssues/i.test(text) && /Status/i.test(text)) {
          return { recordset: [{ status: "Draft" }], rowsAffected: [0] };
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

describe("Purchase Orders: PODate and SupplierID are required (not silently nulled)", () => {
  // This is the first `require("../server")` in this Jest worker, so it pays
  // the one-time cost of loading and JIT-warming the entire route tree
  // (every route file server.js registers) before the first request can even
  // be dispatched — every later test reuses the cached module and a warm
  // app, which is why they all come in well under a second. That one-time
  // cost has grown with the route tree and, under parallel worker load, can
  // exceed Jest's default 5s test timeout even though nothing is actually
  // hung — see the package.json `jest.testTimeout` override.
  test("POST /api/purchase-orders without PODate -> 400 'PODate is required.'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        SupplierID: 17, CompanyId: 2, ProjectId: 3,
        Quantity: 1, Rate: 10, TotalAmount: 10, DocTypeId: 12,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PODate is required/i);
  });

  test("POST /api/purchase-orders without SupplierID -> 400 'SupplierID is required.'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/purchase-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({
        CompanyId: 2, ProjectId: 3, PODate: "2026-07-02",
        Quantity: 1, Rate: 10, TotalAmount: 10, DocTypeId: 12,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SupplierID is required/i);
  });

  test("PUT /api/purchase-orders/:id without PODate -> 400, not a 500 (update overwrites unconditionally)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/purchase-orders/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ SupplierID: 17, CompanyId: 2, ProjectId: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PODate is required/i);
  });

  test("PUT /api/purchase-orders/:id without SupplierID -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/purchase-orders/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ PODate: "2026-07-02", CompanyId: 2, ProjectId: 3 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SupplierID is required/i);
  });
});

describe("Expense Booking: EProjectName, EDocumentType, EDocDate, ECompanyId are required", () => {
  const validBase = {
    EName: "test", EAmount: 100, ENetAmount: 118,
    EProjectName: "3", EDocumentType: "Invoice",
    EDocDate: "2026-07-02", ECompanyId: 1,
  };

  test.each([
    ["EProjectName", "EProjectName"],
    ["EDocumentType", "EDocumentType"],
    ["EDocDate", "EDocDate"],
    ["ECompanyId", "ECompanyId"],
  ])("POST /api/expense-booking without %s -> 400 '%s is required.'", async (field) => {
    const { createApp } = require("../server");
    const app = await createApp();
    const body = { ...validBase };
    delete body[field];

    const res = await request(app)
      .post("/api/expense-booking")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(`${field} is required`, "i"));
  });

  test.each([
    ["EProjectName", "EProjectName"],
    ["EDocumentType", "EDocumentType"],
    ["EDocDate", "EDocDate"],
    ["ECompanyId", "ECompanyId"],
  ])("PUT /api/expense-booking/:id without %s -> 400, not a 500 (update overwrites unconditionally)", async (field) => {
    const { createApp } = require("../server");
    const app = await createApp();
    const body = { ...validBase };
    delete body[field];

    const res = await request(app)
      .put("/api/expense-booking/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(new RegExp(`${field} is required`, "i"));
  });
});

describe("Work Orders: CompanyId, ProjectId, DocumentDate, ContractorId, DocumentNumber are required", () => {
  test("POST /api/work-orders without CompanyId -> 400 'CompanyId is required.'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, DocumentDate: "2026-07-02", ContractorId: 1, DocTypeId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CompanyId is required/i);
  });

  test("POST /api/work-orders without ProjectId -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 2, DocumentDate: "2026-07-02", ContractorId: 1, DocTypeId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ProjectId is required/i);
  });

  test("POST /api/work-orders without DocumentDate -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 2, ProjectId: 3, ContractorId: 1, DocTypeId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DocumentDate is required/i);
  });

  test("POST /api/work-orders without ContractorId -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 2, ProjectId: 3, DocumentDate: "2026-07-02", DocTypeId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ContractorId is required/i);
  });

  test("POST /api/work-orders without DocumentNumber/DocTypeId -> 400 (doc number cannot be resolved)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/work-orders")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 2, ProjectId: 3, DocumentDate: "2026-07-02", ContractorId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DocumentNumber is required/i);
  });

  test("PUT /api/work-orders/:id without DocumentNumber -> 400 (no DocNo fallback on update, unlike create)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/work-orders/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 2, ProjectId: 3, DocumentDate: "2026-07-02", ContractorId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DocumentNumber is required/i);
  });
});

describe("Material Issues: CompanyId, ProjectId, Date, Reason are required", () => {
  const validItems = [{ ItemId: "some-item-id", Quantity: 1 }];

  test("POST /api/material-issues without CompanyId -> 400 'CompanyId is required.'", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, Date: "2026-07-02", Reason: "test", items: validItems });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CompanyId is required/i);
  });

  test("POST /api/material-issues without ProjectId -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 1, Date: "2026-07-02", Reason: "test", items: validItems });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ProjectId is required/i);
  });

  test("POST /api/material-issues without Date -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 1, ProjectId: 3, Reason: "test", items: validItems });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Date is required/i);
  });

  test("POST /api/material-issues without Reason -> 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/material-issues")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ CompanyId: 1, ProjectId: 3, Date: "2026-07-02", items: validItems });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Reason is required/i);
  });

  test("PUT /api/material-issues/:id without CompanyId -> 400, not a 500 (update overwrites unconditionally)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/material-issues/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, Date: "2026-07-02", Reason: "test", items: validItems });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CompanyId is required/i);
  });
});

describe("Cheque Master: IFSCCode is required (Zod schema mismatched the DB constraint)", () => {
  const validBase = {
    CompanyId: 1, BankId: 63, AccountNumber: "916010012345678",
    IFSCCode: "UTIB0000066", ChequeLotNumber: "LOT-TEST-001",
    ChequeStartNumber: 1, ChequeEndNumber: 10,
  };

  test("POST /api/cheque-master without IFSCCode -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const body = { ...validBase };
    delete body.IFSCCode;

    const res = await request(app)
      .post("/api/cheque-master")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/IFSC/i);
  });

  test("POST /api/cheque-master with all required fields -> passes validation (reaches the DB layer)", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/cheque-master")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validBase);

    // With a fully valid body, validateBody() must not reject it — any
    // further failure would come from the (faked) DB layer, not validation.
    expect(res.status).not.toBe(400);
  });
});

describe("Debit Note: bill_id is required (same class as company_id/project_id/supplier_id)", () => {
  const validBase = {
    company_id: 1, project_id: 3, supplier_id: 17, bill_id: 4,
    DocNo: "DN-TEST-001", DebitDate: "2026-07-02", Reason: "test",
    items: [{ Description: "test item", Amount: 100 }],
  };

  test("POST /api/debit-note without bill_id -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const body = { ...validBase };
    delete body.bill_id;

    const res = await request(app)
      .post("/api/debit-note")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bill_id/i);
  });

  test("PUT /api/debit-note/:id without bill_id -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const body = { ...validBase };
    delete body.bill_id;

    const res = await request(app)
      .put("/api/debit-note/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bill_id/i);
  });
});

describe("Card Master: company_name, bank_name, card_type, card_holder_name are required", () => {
  const validBase = {
    company_name: "Test Co", bank_name: "Axis Bank",
    card_type: "Credit", card_holder_name: "Test Holder",
    card_number: "4111111111111111", cvv: "123",
    expiry_month: 12, expiry_year: 2030,
  };

  test.each(["company_name", "bank_name", "card_type", "card_holder_name"])(
    "POST /api/card-master without %s -> 400, not a 500",
    async (field) => {
      const { createApp } = require("../server");
      const app = await createApp();
      const body = { ...validBase };
      delete body[field];

      const res = await request(app)
        .post("/api/card-master")
        .set("Authorization", `Bearer ${superAdminToken()}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(new RegExp(field, "i"));
    },
  );
});

describe("Room Master: ProjectId, UnitId, RoomName are required", () => {
  test("POST /api/room-master without ProjectId -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/room-master")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ UnitId: 1, RoomName: "Room 101" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ProjectId is required/i);
  });

  test("POST /api/room-master without UnitId -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/room-master")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, RoomName: "Room 101" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/UnitId is required/i);
  });

  test("POST /api/room-master without RoomName -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/room-master")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, UnitId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/RoomName is required/i);
  });

  test("PUT /api/room-master/:id without RoomName -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/room-master/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ProjectId: 3, UnitId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/RoomName is required/i);
  });
});

describe("Account Head Master: LHeadName is required", () => {
  test("POST /api/account-head without LHeadName -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .post("/api/account-head")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ LHeadType: "S", LHeadPan: "ABCDE1234F" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/LHeadName is required/i);
  });

  test("PUT /api/account-head/:id without LHeadName -> 400, not a 500", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const res = await request(app)
      .put("/api/account-head/1")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ LHeadType: "S" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/LHeadName is required/i);
  });
});
