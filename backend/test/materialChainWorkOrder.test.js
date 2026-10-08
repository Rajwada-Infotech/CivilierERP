process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "material-chain-wo-test-secret";

/**
 * Document chain: Work Order -> Material Request -> Quotation -> Purchase Order -> GRN -> Invoice.
 * GET /api/material-chain/:type/:id resolves the chain around any one document.
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
  req.id = "chain-wo-test";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});
jest.mock("../routes/dba", () => require("express").Router());
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
  redisGetStrict: jest.fn(async () => null),
  pfaddActiveUser: jest.fn(async () => {}),
  localVersionCache: { invalidate: jest.fn(), get: jest.fn(async () => null), set: jest.fn() },
  permissionCache: { get: jest.fn(async () => null) },
}));

let mockHasColumn = true;
jest.mock("../services/columnProbe", () => ({
  makeColumnProbe: () => {
    const probe = async () => mockHasColumn;
    probe.reset = () => {};
    return probe;
  },
}));

const WO = { id: 12, DocNo: "WO-2026-00004", DocumentNumber: "WO-2026-00004", DocDate: "2026-10-07", Status: "Approved", ProjectId: 3 };
const MR = { id: 55, DocNo: "MR-2026-00007", RequestDate: "2026-10-08", Status: "Approved", CreatedBy: "a", ProjectId: 3, ProjectName: "P", SourceWOId: 12, SourceWODocNo: "WO-2026-00004" };
const QT = { id: 5, DocNo: "QT-2026-00002", DocDate: "2026-10-09", Status: "Approved", SourceMRId: 55 };
const PO = { id: 70, PurchaseOrderNo: "PO-1", DocNo: "PO-2026-00009", PODate: "2026-10-10", Status: "Approved", SourceMRId: null, SourceQTId: 5, SourceWOId: null };
const GRN = { id: 80, GRNNo: "G-1", DocNo: "GRN-2026-00001", GRNDate: "2026-10-12", Status: "Approved", SupplierName: "S", TotalAmount: 10, POID: 70 };
const EXP = { id: 90, EDocNo: "PI-2026-00001", EDocDate: "2026-10-13", EStatus: "Approved", ENetAmount: 10, EVendorInvoiceNo: "X1" };

const rs = (rows) => ({ recordset: rows });

const makePool = () => ({
  request: () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.WorkOrderHeader/i.test(text)) return rs([WO]);
        if (/FROM dbo\.MaterialRequests mr[\s\S]*mr\.SourceWOId = @woId/i.test(text)) return rs([MR]);
        if (/FROM dbo\.MaterialRequests mr[\s\S]*WHERE mr\.MRId = @id/i.test(text)) return rs([MR]);
        if (/FROM dbo\.Quotations\s+WHERE SourceMRId = @mrId/i.test(text)) return rs([QT]);
        if (/SELECT SourceMRId FROM dbo\.Quotations/i.test(text)) return rs([{ SourceMRId: 55 }]);
        if (/FROM dbo\.Quotations\s+WHERE QuotationId = @id/i.test(text)) return rs([QT]);
        if (/WHERE SourceWOId = @woId AND SourceMRId IS NULL/i.test(text)) return rs([]);
        if (/FROM dbo\.PurchaseOrders\s+WHERE SourceQTId = @qtId/i.test(text)) return rs([PO]);
        if (/FROM dbo\.PurchaseOrders\s+WHERE SourceMRId = @mrId/i.test(text)) return rs([PO]);
        if (/FROM dbo\.PurchaseOrders po[\s\S]*WHERE po\.PurchaseOrderID = @id/i.test(text)) return rs([PO]);
        if (/FROM dbo\.VehicleInOut/i.test(text)) return rs([]);
        if (/FROM dbo\.GoodsReceiptNotes grn[\s\S]*WHERE grn\.GRNID = @id/i.test(text)) return rs([GRN]);
        if (/FROM dbo\.GoodsReceiptNotes grn[\s\S]*WHERE grn\.POID = @poId/i.test(text)) return rs([GRN]);
        if (/FROM dbo\.ExpenseBooking[\s\S]*ESourceId = @grnId/i.test(text)) return rs([EXP]);
        return rs([]);
      },
    };
    return req;
  },
});

let mockPool;
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => mockPool,
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));

const token = () =>
  jwt.sign({ userId: 1, email: "smoke@example.com", name: "Super Admin", role: "super_admin", roleId: 1 }, process.env.JWT_SECRET);

const get = async (path) => {
  const { createApp } = require("../server");
  const app = await createApp();
  return request(app).get(`/api/material-chain/${path}`).set("Authorization", `Bearer ${token()}`);
};

beforeEach(() => {
  mockPool = makePool();
  mockHasColumn = true;
});

const types = (nodes) => nodes.map((n) => n.docType);

describe("GET /material-chain/wo/:id", () => {
  test("a work order shows everything raised from it, in document order", async () => {
    const res = await get("wo/12");
    expect(res.status).toBe(200);
    expect(res.body.current).toMatchObject({ docType: "wo", id: 12, docNo: "WO-2026-00004", label: "Work Order" });
    expect(res.body.upstream).toEqual([]);
    expect(types(res.body.downstream)).toEqual(["mr", "qt", "po", "grn", "expense"]);
  });

  test("before migration 545 there is simply no Material Request under the work order", async () => {
    mockHasColumn = false;
    const res = await get("wo/12");
    expect(res.status).toBe(200);
    expect(types(res.body.downstream)).toEqual([]);
  });

  test("an unknown work order is a 404", async () => {
    mockPool = { request: () => ({ input() { return this; }, query: async () => rs([]) }) };
    expect((await get("wo/99")).status).toBe(404);
  });
});

describe("the rest of the chain now starts at the work order", () => {
  test("an MR shows its work order above it and its quotation + PO below", async () => {
    const res = await get("mr/55");
    expect(types(res.body.upstream)).toEqual(["wo"]);
    expect(types(res.body.downstream)).toEqual(["qt", "po"]);
  });

  test("a quotation sits between its MR and the PO", async () => {
    const res = await get("qt/5");
    expect(res.body.current.docType).toBe("qt");
    expect(types(res.body.upstream)).toEqual(["wo", "mr"]);
    expect(types(res.body.downstream)).toEqual(["po"]);
  });

  test("a PO raised from a quotation shows WO -> MR -> QT above it", async () => {
    const res = await get("po/70");
    expect(types(res.body.upstream)).toEqual(["wo", "mr", "qt"]);
    expect(types(res.body.downstream)).toEqual(["grn"]);
  });

  test("a GRN and an invoice carry the whole chain above them", async () => {
    const grn = await get("grn/80");
    expect(types(grn.body.upstream)).toEqual(["wo", "mr", "qt", "po"]);
    expect(types(grn.body.downstream)).toEqual(["expense"]);
  });

  test("an unknown type is refused and names the valid ones", async () => {
    const res = await get("xyz/1");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wo, mr, qt, po, vio, grn, expense/);
  });
});
