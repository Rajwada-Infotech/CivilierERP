process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mr-from-wo-test-secret";

/**
 * An APPROVED work order opens the Material Request form pre-filled (GET .../from-work-order/:woId/prefill,
 * one line per item + unit, quantities summed, nothing created). The form is then saved through the normal
 * POST /api/material-requests with SourceWOId, which tags the MR so the document chain starts at the work
 * order. One live MR per work order.
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

const appFor = async () => {
  const { createApp } = require("../server");
  return createApp();
};
const getPrefill = async (woId = 12) => {
  const app = await appFor();
  return request(app).get(`/api/material-requests/from-work-order/${woId}/prefill`).set("Authorization", `Bearer ${token()}`);
};
const postMR = async (extra = {}) => {
  const app = await appFor();
  return request(app)
    .post("/api/material-requests")
    .set("Authorization", `Bearer ${token()}`)
    .send({ CompanyId: 1, ProjectId: 3, Reason: "Materials", items: [{ ItemId: "7", UOMCode: "BAG", Quantity: 20 }], ...extra });
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

describe("GET /material-requests/from-work-order/:woId/prefill", () => {
  test("approved work order -> the form data, items summed per item, nothing created", async () => {
    const res = await getPrefill();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ WOId: 12, WODocNo: "WO-2026-00004", CompanyId: 1, ProjectId: 3 });
    expect(res.body.Reason).toContain("WO-2026-00004");
    expect(res.body.items).toEqual([
      { ItemId: "7", ItemName: "Cement", UOMCode: "BAG", Quantity: 150 },
      { ItemId: "9", ItemName: "Sand", UOMCode: "CFT", Quantity: 40 },
    ]);
    expect(mockTx).toBeNull(); // no transaction, so no MR was written
  });

  test("a work order that is not approved is refused", async () => {
    mockWo.Status = "Pending";
    const res = await getPrefill();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved work order/i);
  });

  test("an unknown work order is a 404", async () => {
    mockWo = null;
    expect((await getPrefill()).status).toBe(404);
  });

  test("while a live MR exists for the work order it answers 409 with that MR", async () => {
    mockExisting = { MRId: 55, DocNo: "MR-2026-00003", Status: "Pending" };
    const res = await getPrefill();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ mrId: 55, docNo: "MR-2026-00003" });
  });

  test("a work order with no material lines is refused", async () => {
    mockMats = [];
    const res = await getPrefill();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no material items/i);
  });

  test("before migration 545 it says so instead of failing on a missing column", async () => {
    mockHasColumn = false;
    const res = await getPrefill();
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/migration 545/i);
  });

  test("a bad id is a 400", async () => {
    expect((await getPrefill("abc")).status).toBe(400);
  });
});

describe("POST /material-requests with SourceWOId (saved from the pre-filled form)", () => {
  test("the edited form is saved as sent and tagged with the work order", async () => {
    const res = await postMR({ SourceWOId: 12, items: [{ ItemId: "7", UOMCode: "BAG", Quantity: 20 }] });
    expect(res.status).toBe(201);
    const header = mockTx.inputs.find((i) => i.kind === "header");
    expect(header).toMatchObject({ SourceWOId: 12, SourceWODocNo: "WO-2026-00004" });
    const items = mockTx.inputs.filter((i) => i.kind === "item");
    expect(items.map((i) => [i.ItemId, i.Quantity])).toEqual([["7", 20]]); // the user's edit, not the work order's 150
    expect(mockTx.commit).toHaveBeenCalledTimes(1);
  });

  test("a work order that is not approved cannot be the source", async () => {
    mockWo.Status = "Draft";
    const res = await postMR({ SourceWOId: 12 });
    expect(res.status).toBe(400);
    expect(mockTx).toBeNull();
  });

  test("a second MR for the same work order is refused while the first is live", async () => {
    mockExisting = { MRId: 55, DocNo: "MR-2026-00003", Status: "Pending" };
    const res = await postMR({ SourceWOId: 12 });
    expect(res.status).toBe(409);
    expect(mockTx).toBeNull();
  });

  test("a normal MR without SourceWOId is unchanged", async () => {
    const res = await postMR();
    expect(res.status).toBe(201);
    expect(mockTx.inputs.find((i) => i.kind === "header").SourceWOId).toBeNull();
  });
});
