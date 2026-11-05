process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "issue-wo-tag-test-secret";

/**
 * Material Issue: tag the work order the materials are issued against, and compare what the work order listed
 * with what is being issued. Work orders offered: approved, same company + project, Material Request raised.
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
  req.id = "issue-wo-tag-test";
  req.log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  next();
});
jest.mock("../routes/dba", () => require("express").Router());
jest.mock("../services/approvalService", () => ({ transition: jest.fn(async () => {}), writeAuditLog: jest.fn(async () => {}) }));
jest.mock("../utils/docNumberLock", () => ({
  lockNextDocNumber: jest.fn(async () => "ISS-2026-00001"),
  backPatchRecordId: jest.fn(async () => {}),
  resolveDocTypeId: jest.fn(async () => 1),
  previewNextDocNumber: jest.fn(async () => "ISS-2026-00001"),
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

let mockColumns = true; // migration 545 + 547 applied
jest.mock("../services/columnProbe", () => ({
  makeColumnProbe: () => {
    const probe = async () => mockColumns;
    probe.reset = () => {};
    return probe;
  },
}));

let mockWo; // work order header row, or null
let mockLiveMr; // an MR raised from the work order?
let mockListed; // rows from the work-orders list
let mockCompareListed;
let mockCompareIssued;
let mockQueries;
let mockTxQueries;

const rs = (rows) => ({ recordset: rows, rowsAffected: [rows.length] });

const answer = (text) => {
  if (/FROM dbo\.WorkOrderHeader wh[\s\S]*EXISTS/i.test(text)) return rs(mockListed);
  if (/FROM dbo\.WorkOrderHeader WHERE Id/i.test(text)) return rs(mockWo ? [mockWo] : []);
  if (/SELECT TOP 1 mr\.MRId/i.test(text)) return rs(mockLiveMr ? [{ MRId: 5 }] : []);
  if (/FROM dbo\.WorkOrderActivityMaterials/i.test(text)) return rs(mockCompareListed);
  if (/FROM dbo\.MaterialIssues mi\s+JOIN dbo\.MaterialIssueItems/i.test(text)) return rs(mockCompareIssued);
  if (/SELECT ISNULL\(SUM\(CASE WHEN Type='IN'/i.test(text)) return rs([{ Available: 1000 }]);
  if (/INSERT INTO dbo\.MaterialIssues\b/i.test(text)) return rs([{ IssueId: 77, DocNo: "ISS-2026-00001" }]);
  if (/SELECT DocNo, Status FROM dbo\.MaterialIssues/i.test(text)) return rs([{ DocNo: "ISS-2026-00001", Status: "Draft" }]);
  return rs([]);
};

const makeRequest = (log) => {
  const inputs = {};
  const req = {
    input: (name, _t, value) => {
      inputs[name] = value;
      return req;
    },
    query: async (text) => {
      log.push({ text, inputs: { ...inputs } });
      return answer(text);
    },
  };
  return req;
};

const mockPool = { request: () => makeRequest(mockQueries) };

jest.mock("../db", () => {
  const mssql = require("mssql");
  class FakeTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
    request() {
      return makeRequest(mockTxQueries);
    }
  }
  return {
    sql: new Proxy(mssql, { get: (t, k) => (k === "Transaction" ? FakeTransaction : t[k]) }),
    getPool: () => mockPool,
    connectDB: jest.fn(async () => {}),
    closeDB: jest.fn(async () => {}),
    isDbReady: jest.fn(async () => true),
    queryWithRetry: async (pool, fn) => fn(pool.request()),
  };
});

const token = () =>
  jwt.sign({ userId: 1, email: "smoke@example.com", name: "Super Admin", role: "super_admin", roleId: 1 }, process.env.JWT_SECRET);
const app = async () => require("../server").createApp();
const get = async (path) => request(await app()).get(`/api/material-issues/${path}`).set("Authorization", `Bearer ${token()}`);
const post = async (extra = {}) =>
  request(await app())
    .post("/api/material-issues")
    .set("Authorization", `Bearer ${token()}`)
    .send({
      CompanyId: 1, ProjectId: 3, Date: "2026-10-08", Reason: "Plastering", DocTypeId: 1, GodownId: 2,
      items: [{ ItemId: "ITEM-1", UOMCode: "BAG", Quantity: 10 }],
      ...extra,
    });

beforeEach(() => {
  mockColumns = true;
  mockWo = { Id: 12, DocumentNumber: "WO-2026-00004", DocNo: "WO-2026-00004", Status: "Approved", CompanyId: 1, ProjectId: 3 };
  mockLiveMr = true;
  mockListed = [{ id: 12, docNo: "WO-2026-00004", docDate: "2026-10-07", contractorName: "Bengal Labour", mrDocNo: "REQ-2026-00029" }];
  mockCompareListed = [];
  mockCompareIssued = [];
  mockQueries = [];
  mockTxQueries = [];
});

describe("GET /work-orders", () => {
  test("lists approved work orders of the chosen company and project that have a Material Request", async () => {
    const res = await get("work-orders?companyId=1&projectId=3");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockListed);
    const q = mockQueries.find((x) => /FROM dbo\.WorkOrderHeader wh/i.test(x.text));
    expect(q.inputs).toMatchObject({ companyId: 1, projectId: 3 });
    expect(q.text).toMatch(/wh\.Status = 'Approved'/);
    expect(q.text).toMatch(/wh\.CompanyId = @companyId AND wh\.ProjectId = @projectId/);
    expect(q.text).toMatch(/EXISTS \(SELECT 1 FROM dbo\.MaterialRequests mr WHERE mr\.SourceWOId = wh\.Id AND mr\.Status NOT IN \('Rejected', 'Cancelled'\)\)/);
  });

  test("without a company and a project there is nothing to offer, and nothing is queried", async () => {
    expect((await get("work-orders?companyId=1")).body).toEqual([]);
    expect((await get("work-orders")).body).toEqual([]);
    expect(mockQueries).toHaveLength(0);
  });

  test("before migration 545 the list is simply empty", async () => {
    mockColumns = false;
    const res = await get("work-orders?companyId=1&projectId=3");
    expect(res.body).toEqual([]);
  });
});

describe("GET /work-order-compare/:woId", () => {
  test("merges what the work order lists with what other tagged issues have issued, per item and unit", async () => {
    mockCompareListed = [
      { itemId: "AAA", itemName: "Cement", uomCode: "BAG", uomName: "Bags", qty: 150 },
      { itemId: "BBB", itemName: "Sand", uomCode: "CFT", uomName: "CFT", qty: 40 },
    ];
    mockCompareIssued = [
      { itemId: "aaa", itemName: "Cement", uomCode: "BAG", uomName: "Bags", qty: 60 }, // same item, GUID case differs
      { itemId: "CCC", itemName: "Gravel", uomCode: "CFT", uomName: "CFT", qty: 5 }, // not on the work order
    ];
    const res = await get("work-order-compare/12");
    expect(res.status).toBe(200);
    expect(res.body.docNo).toBe("WO-2026-00004");
    expect(res.body.items.map((i) => [i.itemName, i.woQty, i.issuedQty])).toEqual([
      ["Cement", 150, 60],
      ["Gravel", 0, 5],
      ["Sand", 40, 0],
    ]);
  });

  test("the issue being edited is left out of 'issued earlier', and cancelled / rejected issues never count", async () => {
    await get("work-order-compare/12?excludeIssueId=77");
    const q = mockQueries.find((x) => /FROM dbo\.MaterialIssues mi/i.test(x.text));
    expect(q.inputs.exclude).toBe(77);
    expect(q.text).toMatch(/mi\.IssueId <> @exclude/);
    expect(q.text).toMatch(/mi\.Status NOT IN \('Rejected', 'Cancelled'\)/);
  });

  test("before migration 547 nothing has been issued against a work order yet", async () => {
    mockColumns = false;
    mockCompareListed = [{ itemId: "AAA", itemName: "Cement", uomCode: "BAG", uomName: "Bags", qty: 150 }];
    const res = await get("work-order-compare/12");
    expect(res.body.items).toEqual([expect.objectContaining({ woQty: 150, issuedQty: 0 })]);
  });

  test("unknown work order is a 404, a bad id a 400", async () => {
    mockWo = null;
    expect((await get("work-order-compare/12")).status).toBe(404);
    expect((await get("work-order-compare/abc")).status).toBe(400);
  });
});

describe("POST / with a work-order tag", () => {
  const tagUpdate = () => mockTxQueries.find((x) => /UPDATE dbo\.MaterialIssues SET SourceWOId/i.test(x.text));

  test("a valid tag is saved with the issue, together with the work order number", async () => {
    const res = await post({ SourceWOId: 12 });
    expect(res.status).toBe(201);
    expect(tagUpdate().inputs).toMatchObject({ woId: 12, woNo: "WO-2026-00004" });
    expect(res.body).toMatchObject({ SourceWOId: 12, SourceWODocNo: "WO-2026-00004" });
  });

  test("an issue without a tag is saved exactly as before", async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(tagUpdate()).toBeUndefined();
  });

  test("a work order of another company or project is refused", async () => {
    mockWo.ProjectId = 9;
    const res = await post({ SourceWOId: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different company or project/i);
    expect(mockTxQueries.some((x) => /INSERT INTO dbo\.MaterialIssues\b/i.test(x.text))).toBe(false);
  });

  test("a work order that is not approved is refused", async () => {
    mockWo.Status = "Pending";
    const res = await post({ SourceWOId: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved/i);
  });

  test("a work order with no Material Request raised yet is refused", async () => {
    mockLiveMr = false;
    const res = await post({ SourceWOId: 12 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No Material Request/i);
  });

  test("before migration 547 it says so instead of failing on a missing column", async () => {
    mockColumns = false;
    const res = await post({ SourceWOId: 12 });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/migration 547/i);
  });

  test("a junk work order id is a 400", async () => {
    expect((await post({ SourceWOId: "abc" })).status).toBe(400);
  });
});
