process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mr-from-wo-test-secret";

/**
 * POST /api/material-requests/from-work-order/:woId
 * An APPROVED work order raises one Material Request: one line per item (+unit) with quantities summed,
 * tagged with SourceWOId so the document chain starts at the work order. One live MR per work order.
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
  req.id = "mr-from-wo-test";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});
jest.mock("../routes/dba", () => require("express").Router());
jest.mock("../services/approvalService", () => ({ transition: jest.fn(async () => {}) }));
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

let mockWo;
let mockExisting;
let mockMats;
let mockTx;

const makePool = () => {
  const plain = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/FROM dbo\.WorkOrderHeader/i.test(text)) return { recordset: mockWo ? [mockWo] : [] };
        if (/SourceWOId = @id AND Status NOT IN/i.test(text)) return { recordset: mockExisting ? [mockExisting] : [] };
        if (/FROM dbo\.WorkOrderActivityMaterials/i.test(text)) return { recordset: mockMats };
        if (/SELECT DocNo, Status FROM dbo\.MaterialRequests/i.test(text)) return { recordset: [{ DocNo: "MR-2026-00007", Status: "Pending" }] };
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return {
    request: plain,
    transaction: () => {
      mockTx = { inputs: [], items: 0, begin: jest.fn(async () => {}), commit: jest.fn(async () => {}), rollback: jest.fn(async () => {}) };
      mockTx.request = () => {
        const captured = {};
        const req = {
          input: (name, _t, value) => {
            captured[name] = value;
            return req;
          },
          query: async (text) => {
            if (/INSERT INTO dbo\.MaterialRequestItems/i.test(text)) {
              mockTx.items += 1;
              mockTx.inputs.push({ kind: "item", ...captured });
              return { recordset: [], rowsAffected: [1] };
            }
            if (/INSERT INTO dbo\.MaterialRequests\b/i.test(text)) {
              mockTx.inputs.push({ kind: "header", ...captured });
              return { recordset: [{ MRId: 321 }], rowsAffected: [1] };
            }
            return { recordset: [], rowsAffected: [0] };
          },
        };
        return req;
      };
      return mockTx;
    },
  };
};

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

const post = async (woId = 12) => {
  const { createApp } = require("../server");
  const app = await createApp();
  return request(app).post(`/api/material-requests/from-work-order/${woId}`).set("Authorization", `Bearer ${token()}`).send({});
};

beforeEach(() => {
  mockPool = makePool();
  mockHasColumn = true;
  mockWo = { Id: 12, DocumentNumber: "WO-2026-00004", DocNo: "WO-2026-00004", Status: "Approved", CompanyId: 1, ProjectId: 3 };
  mockExisting = null;
  mockMats = [
    { ItemId: 7, ItemName: "Cement", UOMCode: "BAG", Quantity: 150 },
    { ItemId: 9, ItemName: "Sand", UOMCode: "CFT", Quantity: 40 },
  ];
  mockTx = null;
});

describe("POST /material-requests/from-work-order/:woId", () => {
  test("approved work order -> one MR with a line per item, tagged with the work order", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ MRId: 321, DocNo: "MR-2026-00007", Status: "Pending", itemCount: 2 });

    const header = mockTx.inputs.find((i) => i.kind === "header");
    expect(header).toMatchObject({ CompanyId: 1, ProjectId: 3, SourceWOId: 12, SourceWODocNo: "WO-2026-00004" });
    expect(header.Reason).toContain("WO-2026-00004");
    const items = mockTx.inputs.filter((i) => i.kind === "item");
    expect(items.map((i) => [i.ItemId, i.UOMCode, i.Quantity])).toEqual([
      ["7", "BAG", 150],
      ["9", "CFT", 40],
    ]);
    expect(mockTx.commit).toHaveBeenCalledTimes(1);
    expect(mockTx.rollback).not.toHaveBeenCalled();
  });

  test("a work order that is not approved is refused, nothing is written", async () => {
    mockWo.Status = "Pending";
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved work order/i);
    expect(mockTx).toBeNull();
  });

  test("an unknown work order is a 404", async () => {
    mockWo = null;
    expect((await post()).status).toBe(404);
  });

  test("a second request while the first is live is refused with the existing MR (409)", async () => {
    mockExisting = { MRId: 55, DocNo: "MR-2026-00003", Status: "Pending" };
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ mrId: 55, docNo: "MR-2026-00003" });
    expect(mockTx).toBeNull();
  });

  test("a work order with no material lines is refused", async () => {
    mockMats = [];
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no material items/i);
    expect(mockTx).toBeNull();
  });

  test("before migration 545 it says so instead of failing on a missing column", async () => {
    mockHasColumn = false;
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/migration 545/i);
    expect(mockTx).toBeNull();
  });

  test("a bad id is a 400", async () => {
    const { createApp } = require("../server");
    const app = await createApp();
    const res = await request(app).post("/api/material-requests/from-work-order/abc").set("Authorization", `Bearer ${token()}`).send({});
    expect(res.status).toBe(400);
  });
});
