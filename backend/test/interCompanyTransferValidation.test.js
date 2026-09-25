process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "ict-validation-test-secret";

/**
 * Inter-Company Stock Transfer: orchestration route validation + atomicity.
 *
 * The route (backend/routes/interCompanyTransfer.js) is a two-phase flow:
 *   POST /            validates everything and records a Draft -> Pending
 *                      request — NO stock/GL happens yet.
 *   PUT /:id/approve   only once a super_admin approves does stock actually
 *                      move (StockLedger OUT at the sender's godown, IN at
 *                      the receiver's) and the two-sided GL voucher post
 *                      (services/interCompanyStockTransferGL.js) — no more
 *                      commercial-paper chain (SO/SI/RP/PO/GRN/ExB/Payment)
 *                      and no Dummy Bank involved.
 *
 * Every service dependency is mocked so these tests exercise only the
 * orchestrator's OWN logic: the same-company rejection, godown lookups,
 * per-item pricing via getLastPurchaseRateByCompany, the header+items
 * transaction, and the direct stock move + GL post on approval.
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

const mockTransition = jest.fn(async (module, id, targetStatus) => {
  if (targetStatus === "Approved") return { newStatus: "Approved", level: 1, totalLevels: 1 };
  return { newStatus: "Pending" };
});
jest.mock("../services/approvalService", () => ({
  transition: (...args) => mockTransition(...args),
}));

let mockRateInfo = { rate: 600, sourceDocNo: "GRN-2026-00004", sourceDate: "2026-07-01" };
const mockGetLastPurchaseRateByCompany = jest.fn(async () => mockRateInfo);
jest.mock("../services/lastPurchaseRate", () => ({
  getLastPurchaseRateByCompany: (...args) => mockGetLastPurchaseRateByCompany(...args),
}));

const mockPostToGL = jest.fn(async () => ({ posted: true }));
jest.mock("../services/interCompanyStockTransferGL", () => ({
  postInterCompanyStockTransferToGL: (...args) => mockPostToGL(...args),
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
let godownsAvailable;
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
        if (/FROM dbo\.Godowns/i.test(text)) {
          return { recordset: godownsAvailable ? [{ GodownID: 55, GodownName: "Main" }] : [] };
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
  godownsAvailable = true;
  senderStockAvailable = 1000;
  stockLedgerInserts = [];
  mockFakePool = makeFakePool();
  storedIctRow = {
    ICTId: 999,
    DocNo: "ICT-2026-00001",
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

  test("rejects when an item has no last-purchase-rate on file for the sending company", async () => {
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

  test("prices items via the COMPANY-scoped rate lookup, not project-scoped", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());
    expect(mockGetLastPurchaseRateByCompany).toHaveBeenCalledWith(
      expect.anything(), SENDER_PROJECT.CompanyId, "ITEM-1",
    );
  });
});

describe("Inter-Company Transfer: submission (POST /) only records a Pending request", () => {
  test("validates and records the request WITHOUT moving stock or posting GL yet", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .post("/api/inter-company-transfer")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send(validPayload());

    expect(res.status).toBe(201);
    expect(res.body.Status).toBe("Pending");
    expect(res.body.ICTId).toBe(999);
    expect(stockLedgerInserts.length).toBe(0);
    expect(mockPostToGL).not.toHaveBeenCalled();
    // Auto-submits Draft -> Pending, same convention as journal-voucher.js.
    expect(mockTransition).toHaveBeenCalledWith(
      "inter-company-transfer", 999, "Pending", expect.any(String), expect.any(String),
    );
  });
});

describe("Inter-Company Transfer: approval moves stock directly and posts the GL voucher", () => {
  test("PUT /:id/approve writes StockLedger OUT+IN and posts the two-sided voucher", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app)
      .put("/api/inter-company-transfer/999/approve")
      .set("Authorization", `Bearer ${superAdminToken()}`)
      .send({});

    expect(res.status).toBe(200);
    // One OUT at the sender's godown, one IN at the receiver's — no more
    // GRN/SO/PO/Invoice/Payment chain.
    expect(stockLedgerInserts.length).toBe(2);
    expect(stockLedgerInserts[0].text).toMatch(/'OUT','ICT'/);
    expect(stockLedgerInserts[0].params.GodownID).toBe(55);
    expect(stockLedgerInserts[1].text).toMatch(/'IN','ICT'/);
    expect(stockLedgerInserts[1].params.GodownID).toBe(55);

    expect(mockPostToGL).toHaveBeenCalledTimes(1);
    expect(mockPostToGL).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transferId: 999,
        docNo: "ICT-2026-00001",
        senderCompanyId: SENDER_PROJECT.CompanyId,
        receiverCompanyId: RECEIVER_PROJECT.CompanyId,
        totalAmount: 3000,
      }),
    );
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
    // No stock should have moved and no GL posted — the stock check runs
    // before anything else.
    expect(stockLedgerInserts.length).toBe(0);
    expect(mockPostToGL).not.toHaveBeenCalled();
  });

  test("does not move stock or post GL when a multi-level workflow leaves the header still Pending", async () => {
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
    expect(stockLedgerInserts.length).toBe(0);
    expect(mockPostToGL).not.toHaveBeenCalled();
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
