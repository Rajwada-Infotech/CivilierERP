process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mr-po-prefill-wo-test-secret";

/**
 * Raising a PO from a Material Request that came from a Work Order: the PO prefill carries the work order's
 * rate, GST % and per-line supplier, so the buyer starts from them instead of 0.
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
  req.id = "mr-po-prefill-wo-test";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});
jest.mock("../routes/dba", () => require("express").Router());
jest.mock("../services/approvalService", () => ({ transition: jest.fn(async () => {}), writeAuditLog: jest.fn(async () => {}) }));
jest.mock("../services/materialRequestFulfillment", () => ({
  getMRItemFulfillment: jest.fn(async () => []),
  summarize: jest.fn(() => ({})),
}));
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

let mockMrSource; // { SourceWOId, SourceWODocNo } or {} for an ordinary MR
let mockWoLines;
const rs = (rows) => ({ recordset: rows, rowsAffected: [rows.length] });

const MR_HEADER = { MRId: 55, DocNo: "REQ-2026-00029", Status: "Approved", CompanyId: 1, CompanyName: "Co", ProjectId: 3, ProjectName: "P", FinYearId: 2, FinYearName: "FY", Remarks: "" };
const MR_ITEMS = [
  { MRItemId: 1, ItemId: "AAA", ItemName: "Cement", UOMCode: "BAG", UOMName: "Bags", Quantity: 150, Remarks: null, M_CGST: 0, M_SGST: 0, M_IGST: 28 },
  { MRItemId: 2, ItemId: "BBB", ItemName: "Sand", UOMCode: "CFT", UOMName: "CFT", Quantity: 40, Remarks: null, M_CGST: 0, M_SGST: 0, M_IGST: 5 },
];

const mockPool = {
  request: () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/SELECT MRId FROM dbo\.MaterialRequests mr|SELECT\s+mr\.MRId\s+FROM\s+dbo\.MaterialRequests mr/i.test(text)) return rs([{ MRId: 55 }]);
        if (/FROM dbo\.MaterialRequests mr[\s\S]*WHERE mr\.MRId = @id/i.test(text)) return rs([MR_HEADER]);
        if (/FROM dbo\.MaterialRequestItems mri/i.test(text)) return rs(MR_ITEMS);
        if (/SELECT SourceWOId, SourceWODocNo FROM dbo\.MaterialRequests/i.test(text)) return rs([mockMrSource]);
        if (/FROM dbo\.WorkOrderActivityMaterials m/i.test(text)) return rs(mockWoLines);
        return rs([]);
      },
    };
    return req;
  },
};

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
  return request(await createApp()).get(`/api/material-requests/${path}`).set("Authorization", `Bearer ${token()}`);
};

const line = (over) => ({ ItemId: "aaa", UOMCode: "BAG", Qty: 100, Value: 38000, GstWeighted: 1800, MinSupplier: 9, MaxSupplier: 9, NoSupplier: 0, SupplierName: "Bengal Sanitary", ...over });

beforeEach(() => {
  mockHasColumn = true;
  mockMrSource = { SourceWOId: 12, SourceWODocNo: "WO-2026-00004" };
  mockWoLines = [line(), line({ ItemId: "bbb", UOMCode: "CFT", Qty: 40, Value: 2000, GstWeighted: 200 })];
});

const byItem = (body) => Object.fromEntries(body.items.map((i) => [i.ItemId, i]));

describe("create-po-prefill for a Material Request raised from a work order", () => {
  test("each item carries the work order's rate and GST %", async () => {
    const res = await get("55/create-po-prefill");
    expect(res.status).toBe(200);
    const items = byItem(res.body);
    expect(items.AAA).toMatchObject({ WoRate: 380, WoGstRate: 18 });
    expect(items.BBB).toMatchObject({ WoRate: 50, WoGstRate: 5 });
    expect(res.body).toMatchObject({ WorkOrderId: 12, WorkOrderDocNo: "WO-2026-00004" });
  });

  test("when every line names the same supplier, the PO starts with that supplier", async () => {
    mockWoLines = [line(), line({ ItemId: "bbb", UOMCode: "CFT", Qty: 40, Value: 2000, GstWeighted: 200 })];
    const res = await get("55/create-po-prefill");
    expect(res.body.WorkOrderSupplierId).toBe(9);
    expect(res.body.WorkOrderSupplierName).toBe("Bengal Sanitary");
    expect(byItem(res.body).AAA.WoSupplierId).toBe(9);
  });

  test("lines with different suppliers give no single supplier, but each keeps its own", async () => {
    mockWoLines = [line(), line({ ItemId: "bbb", UOMCode: "CFT", Qty: 40, Value: 2000, GstWeighted: 200, MinSupplier: 4, MaxSupplier: 4, SupplierName: "Sand Co" })];
    const res = await get("55/create-po-prefill");
    expect(res.body.WorkOrderSupplierId).toBeNull();
    expect(byItem(res.body).AAA.WoSupplierId).toBe(9);
    expect(byItem(res.body).BBB.WoSupplierId).toBe(4);
  });

  test("an item the work order lists under two suppliers has no supplier suggested", async () => {
    mockWoLines = [line({ MinSupplier: 9, MaxSupplier: 4 }), line({ ItemId: "bbb", UOMCode: "CFT", Qty: 40, Value: 2000, GstWeighted: 200 })];
    const res = await get("55/create-po-prefill");
    expect(byItem(res.body).AAA.WoSupplierId).toBeNull();
    expect(res.body.WorkOrderSupplierId).toBeNull();
  });

  test("a work-order line with no supplier means no supplier is suggested for it", async () => {
    mockWoLines = [line({ NoSupplier: 1 }), line({ ItemId: "bbb", UOMCode: "CFT", Qty: 40, Value: 2000, GstWeighted: 200 })];
    const res = await get("55/create-po-prefill");
    expect(byItem(res.body).AAA.WoSupplierId).toBeNull();
  });

  test("the rate is quantity-weighted when an item is listed under several activities at different rates", async () => {
    // 100 bags at 380 each (38000) + 50 at 400 each → handled by the SQL; here one row already summed:
    mockWoLines = [line({ Qty: 150, Value: 38000 + 50 * 400, GstWeighted: 150 * 18 })];
    const res = await get("55/create-po-prefill");
    expect(byItem(res.body).AAA.WoRate).toBe(386.67);
  });

  test("an item the work order doesn't list is left exactly as it was", async () => {
    mockWoLines = [line()]; // nothing for Sand
    const res = await get("55/create-po-prefill");
    expect(byItem(res.body).BBB.WoRate).toBeUndefined();
  });

  test("the unit has to match, so Cement in Kg is not given the rate per Bag", async () => {
    mockWoLines = [line({ UOMCode: "KG" })];
    const res = await get("55/create-po-prefill");
    expect(byItem(res.body).AAA.WoRate).toBeUndefined();
  });
});

describe("an ordinary Material Request", () => {
  test("is unchanged: no work order fields at all", async () => {
    mockMrSource = { SourceWOId: null, SourceWODocNo: null };
    const res = await get("55/create-po-prefill");
    expect(res.status).toBe(200);
    expect(res.body.WorkOrderId).toBeUndefined();
    expect(byItem(res.body).AAA.WoRate).toBeUndefined();
  });

  test("before migration 545 it is also unchanged", async () => {
    mockHasColumn = false;
    const res = await get("55/create-po-prefill");
    expect(res.status).toBe(200);
    expect(res.body.WorkOrderId).toBeUndefined();
  });
});

describe("Load from MR (by document number)", () => {
  test("gets the same work-order terms", async () => {
    const res = await get("by-docno/REQ-2026-00029");
    expect(res.status).toBe(200);
    expect(byItem(res.body).AAA.WoRate).toBe(380);
    expect(res.body.WorkOrderSupplierId).toBe(9);
  });
});
