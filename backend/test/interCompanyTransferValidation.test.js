process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "ict-validation-test-secret";

/**
 * Inter-Company Stock Transfer: orchestration route validation + atomicity.
 *
 * The route (backend/routes/interCompanyTransfer.js) is a two-phase flow:
 *   POST /            validates everything and records a Draft -> Pending
 *                      request — NO documents are generated yet.
 *   PUT /:id/approve   only once a super_admin approves does the full chain
 *                      fire: Sale Order -> Sale Invoice -> Received Payment
 *                      on the sender side, Purchase Order -> GRN -> Expense
 *                      Booking -> Payment on the receiver side, all via the
 *                      internal creation functions extracted from each of
 *                      those routes this session.
 *
 * Every internal function and service dependency is mocked so these tests
 * exercise only the orchestrator's OWN logic: the same-company rejection,
 * ledger-head/godown/dummy-bank lookups, per-item pricing via
 * getLastPurchaseRate, the multi-level approve() loop for child docs, and
 * the header+items transaction.
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
  req.id = req.headers["x-request-id"] || "ict-test-request";
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

// ── Mock every internal creation function this route orchestrates ──────────
const mockCreateSaleOrder = jest.fn(async () => ({ SaleOrderID: 101, SaleOrderNo: "SO-000001" }));
const mockCreateSaleInvoice = jest.fn(async () => ({
  SaleInvoiceID: 201, SaleInvoiceNo: "SI-2026-00001",
}));
const mockCreateReceivedPayment = jest.fn(async () => ({ RPPaymentID: 301 }));
const mockCreatePurchaseOrder = jest.fn(async () => ({
  PurchaseOrderID: 401, PurchaseOrderNo: "PO-2026-00001",
}));
const mockCreateGRN = jest.fn(async () => ({ GRNID: 501, DocNo: "GRN-2026-00001" }));
const mockCreateExpenseBooking = jest.fn(async () => ({ id: 601, docNo: "INV000001" }));

jest.mock("../routes/customerSaleOrders", () => ({
  createSaleOrderInternal: (...args) => mockCreateSaleOrder(...args),
}));
jest.mock("../routes/saleInvoices", () => ({
  createSaleInvoiceInternal: (...args) => mockCreateSaleInvoice(...args),
}));
jest.mock("../routes/receivedPayment", () => ({
  createReceivedPaymentInternal: (...args) => mockCreateReceivedPayment(...args),
}));
jest.mock("../routes/purchaseOrders", () => ({
  createPurchaseOrderInternal: (...args) => mockCreatePurchaseOrder(...args),
}));
jest.mock("../routes/grns", () => ({
  createGRNInternal: (...args) => mockCreateGRN(...args),
}));
jest.mock("../routes/expenseBooking", () => ({
  createExpenseBookingInternal: (...args) => mockCreateExpenseBooking(...args),
}));

const mockTransition = jest.fn(async (module, id, targetStatus) => {
  if (targetStatus === "Approved") return { newStatus: "Approved", level: 1, totalLevels: 1 };
  return { newStatus: "Pending" };
});
jest.mock("../services/approvalService", () => ({
  transition: (...args) => mockTransition(...args),
}));

jest.mock("../services/generalLedger", () => ({
  postReceivedPaymentApproval: jest.fn(async () => ({ posted: true })),
}));

let mockRateInfo = { rate: 600, sourceDocNo: "GRN-2026-00004", sourceDate: "2026-07-01" };
jest.mock("../services/lastPurchaseRate", () => ({
  getLastPurchaseRate: jest.fn(async () => mockRateInfo),
}));

jest.mock("../utils/docNumberLock", () => ({
  resolveDocTypeId: jest.fn(async () => 1),
  lockNextDocNumber: jest.fn(async () => "ICT-2026-00001"),
  backPatchRecordId: jest.fn(async () => {}),
}));

// ── Fake pool for the orchestrator's own direct queries ─────────────────────
const SENDER_PROJECT = { ProjectId: 3, ProjectName: "Sender Project", CompanyId: 1, CompanyName: "Company A", CompanyGST: "29ABCDE1234F1Z5" };
const RECEIVER_PROJECT = { ProjectId: 7, ProjectName: "Receiver Project", CompanyId: 2, CompanyName: "Company B", CompanyGST: "27ABCDE1234F1Z6" };

let projectsById;
let ledgerAvailable;
let godownsAvailable;
let dummyBankAvailable;
let txSpy;
let storedIctRow;
let storedIctItems;
let senderStockAvailable;
let stockLedgerInserts;

function makeFakePool() {
  const plainRequest = () => {
    const req = {
      params: {},
      input(name, _type, value) {
        this.params[name] = value;
        return this;
      },
      query: async (text) => {
        if (/FROM dbo\.enterprise/i.test(text) && /business_type = 'P'/i.test(text)) {
          const row = projectsById[req.params.ProjectId];
          return { recordset: row ? [row] : [] };
        }
        if (/FROM dbo\.AccountHeadMaster/i.test(text) && /LHeadCode = @Code/i.test(text)) {
          return { recordset: ledgerAvailable ? [{ LHeadId: 999, LHeadName: "Test Ledger" }] : [] };
        }
        if (/FROM dbo\.AccountHeadMaster/i.test(text) && /DUMMY-BANK/i.test(text)) {
          return { recordset: dummyBankAvailable ? [{ LHeadId: 888, LHeadName: "Dummy Bank" }] : [] };
        }
        if (/FROM dbo\.Godowns/i.test(text)) {
          return { recordset: godownsAvailable ? [{ GodownID: 55, GodownName: "Main" }] : [] };
        }
        if (/FROM dbo\.TypeOfDoc/i.test(text)) {
          return { recordset: [{ TypeOfDocId: 1 }] };
        }
        if (/INSERT INTO dbo\.NewPayment/i.test(text)) {
          return { recordset: [{ PPaymentID: 701 }], rowsAffected: [1] };
        }
        if (/SELECT \* FROM dbo\.InterCompanyTransfer WHERE ICTId/i.test(text)) {
          return { recordset: storedIctRow ? [storedIctRow] : [] };
        }
        if (/FROM dbo\.InterCompanyTransferItems/i.test(text)) {
          return { recordset: storedIctItems || [] };
        }
        if (/UPDATE dbo\.InterCompanyTransfer/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/SELECT ISNULL\(SUM.*FROM dbo\.StockLedger/is.test(text)) {
          return { recordset: [{ Available: senderStockAvailable }] };
        }
        if (/INSERT INTO dbo\.StockLedger/i.test(text)) {
          stockLedgerInserts.push({ text, params: { ...req.params } });
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [] };
      },
    };
    return req;
  };

  const makeTxRequest = (tx) => {
    const req = {
      params: {},
      input(name, _type, value) {
        this.params[name] = value;
        return this;
      },
      query: async (text) => {
        if (/INSERT INTO dbo\.InterCompanyTransferItems/i.test(text)) {
          tx.itemInsertCount = (tx.itemInsertCount || 0) + 1;
          if (tx.failOnNthItemInsert && tx.itemInsertCount === tx.failOnNthItemInsert) {
            throw new Error("simulated mid-loop failure");
          }
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.InterCompanyTransfer\b/i.test(text)) {
          return { recordset: [{ ICTId: 999 }], rowsAffected: [1] };
        }
        return { recordset: [] };
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
  jest.clearAllMocks();
  mockRateInfo = { rate: 600, sourceDocNo: "GRN-2026-00004", sourceDate: "2026-07-01" };
  projectsById = { 3: SENDER_PROJECT, 7: RECEIVER_PROJECT };
  ledgerAvailable = true;
  godownsAvailable = true;
  dummyBankAvailable = true;
  senderStockAvailable = 1000;
  stockLedgerInserts = [];
  mockFakePool = makeFakePool();
  storedIctRow = {
    ICTId: 999,
    SenderProjectId: 3,
    ReceiverProjectId: 7,
    TotalAmount: 3000,
    Remarks: null,
    Status: "Pending",
  };
  storedIctItems = [
    { ItemId: "ITEM-1", ItemName: "Test Item", UOMCode: "NOS", Quantity: 5, Rate: 600, Amount: 3000, SourceDocNo: "GRN-2026-00004" },
  ];
  mockTransition.mockImplementation(async (module, id, targetStatus) => {
    if (targetStatus === "Approved") return { newStatus: "Approved", level: 1, totalLevels: 1 };
    return { newStatus: "Pending" };
  });
});

const validPayload = () => ({
  SenderProjectId: 3,
  ReceiverProjectId: 7,
  Items: [{ itemId: "ITEM-1", itemName: "Test Item", qty: 5 }],
});

describe("Inter-Company Transfer: validation", () => {
  test("rejects same-project transfer", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({ ...validPayload(), ReceiverProjectId: 3 });
    expect(res.status).toBe(400);
  });

  test("rejects same-company projects (use normal Stock Transfer instead)", async () => {
    projectsById[7] = { ...RECEIVER_PROJECT, CompanyId: 1 }; // same company as sender
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/normal Stock Transfer/i);
  });

  test("rejects when auto-created ledger heads are missing", async () => {
    ledgerAvailable = false;
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ledger head/i);
  });

  test("rejects when project godowns are missing", async () => {
    godownsAvailable = false;
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/godown/i);
  });

  test("rejects when the Dummy Bank account does not exist", async () => {
    dummyBankAvailable = false;
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Dummy Bank/i);
  });

  test("rejects when an item has no last-purchase-rate on file", async () => {
    mockRateInfo = null;
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/last purchase rate/i);
  });
});

describe("Inter-Company Transfer: submission (POST /) only records a Pending request", () => {
  test("validates and records the request WITHOUT generating any documents yet", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body.Status).toBe("Pending");
    expect(res.body.ICTId).toBe(999);
    // The core "no manual work" spec only kicks in AFTER approval — until
    // then, none of the downstream documents should exist yet.
    expect(mockCreateSaleOrder).not.toHaveBeenCalled();
    expect(mockCreateSaleInvoice).not.toHaveBeenCalled();
    expect(mockCreatePurchaseOrder).not.toHaveBeenCalled();
    expect(mockCreateGRN).not.toHaveBeenCalled();
    expect(mockCreateExpenseBooking).not.toHaveBeenCalled();
    // Auto-submits Draft -> Pending, same convention as journal-voucher.js.
    expect(mockTransition).toHaveBeenCalledWith(
      "inter-company-transfer", 999, "Pending", expect.any(String), expect.any(String),
    );
  });
});

describe("Inter-Company Transfer: approval fires the full auto-generated chain", () => {
  test("PUT /:id/approve orchestrates every leg and returns linked document IDs", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(mockCreateSaleOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateSaleInvoice).toHaveBeenCalledTimes(1);
    expect(mockCreateReceivedPayment).toHaveBeenCalledTimes(1);
    expect(mockCreatePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateGRN).toHaveBeenCalledTimes(1);
    expect(mockCreateExpenseBooking).toHaveBeenCalledTimes(1);
    expect(res.body.links).toMatchObject({
      SaleOrderID: 101,
      SaleInvoiceID: 201,
      ReceivedPaymentID: 301,
      PurchaseOrderID: 401,
      GRNID: 501,
    });
  });

  test("deducts the sender's godown stock via a StockLedger OUT entry", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    // Previously nothing ever debited the sender's stock, so it silently
    // duplicated across both projects on every transfer — this is the fix.
    expect(stockLedgerInserts.length).toBe(1);
    expect(stockLedgerInserts[0].text).toMatch(/'OUT','ICT'/);
    expect(stockLedgerInserts[0].params.ItemID).toBe("ITEM-1");
    expect(stockLedgerInserts[0].params.Qty).toBe(5);
    expect(stockLedgerInserts[0].params.GodownID).toBe(55);
  });

  test("rejects approval when the sender's godown does not have enough stock", async () => {
    senderStockAvailable = 0; // requested qty (5) > available (0)
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient stock/i);
    // No documents should have been created — the stock check runs before
    // any of the chain fires.
    expect(mockCreateSaleOrder).not.toHaveBeenCalled();
    expect(mockCreateGRN).not.toHaveBeenCalled();
  });

  test("does not run the chain when a multi-level workflow leaves the header still Pending", async () => {
    mockTransition.mockImplementation(async (module) => {
      if (module === "inter-company-transfer") {
        return { newStatus: "Pending", level: 1, totalLevels: 2, remainingLevels: 1 };
      }
      return { newStatus: "Approved", level: 1, totalLevels: 1 };
    });

    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/approval level recorded/i);
    expect(mockCreateSaleOrder).not.toHaveBeenCalled();
  });

  test("approve() loops until fully approved for multi-level child-document workflows", async () => {
    let poCallCount = 0;
    mockTransition.mockImplementation(async (module, id, targetStatus) => {
      if (module === "purchase-orders" && targetStatus === "Approved") {
        poCallCount++;
        return poCallCount < 3
          ? { newStatus: "Pending", level: poCallCount, totalLevels: 3, remainingLevels: 3 - poCallCount }
          : { newStatus: "Approved", level: 3, totalLevels: 3 };
      }
      return targetStatus === "Approved" ? { newStatus: "Approved", level: 1, totalLevels: 1 } : { newStatus: "Pending" };
    });

    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    expect(poCallCount).toBe(3);
  });
});

describe("Inter-Company Transfer: header+items transaction atomicity", () => {
  test("mid-loop item-insert failure rolls back instead of committing a partial header", async () => {
    const { createApp } = require("../server");
    const app = await createApp();

    const origTransaction = mockFakePool.transaction;
    mockFakePool.transaction = () => {
      const tx = origTransaction();
      tx.failOnNthItemInsert = 1;
      return tx;
    };

    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());

    expect(res.status).toBe(500);
    expect(txSpy.rollback).toHaveBeenCalledTimes(1);
    expect(txSpy.commit).not.toHaveBeenCalled();
  });
});
