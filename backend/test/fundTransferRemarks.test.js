process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "fund-transfer-remarks-test-secret";

/**
 * Fund Transfer: PUT /:id/remarks.
 *
 * Remarks are editable until the transfer is Approved; once Approved the edit
 * needs the post-approval right and is written to the Amendment trail.
 * The mssql pool and the amendment service are faked — no real DB is touched.
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
  req.id = "ft-remarks-test";
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

const mockAmend = { snapshotRow: jest.fn(), recordAmendment: jest.fn() };
jest.mock("../services/amendmentLog", () => {
  const real = jest.requireActual("../services/amendmentLog");
  return { ...real, snapshotRow: (...a) => mockAmend.snapshotRow(...a), recordAmendment: (...a) => mockAmend.recordAmendment(...a) };
});

let mockAllowPostApproval = true;
jest.mock("../middleware/permissions", () => {
  const real = jest.requireActual("../middleware/permissions");
  return { ...real, resolveAllowPostApproval: jest.fn(async () => mockAllowPostApproval) };
});

let mockUpdateRows = 1;
let mockUpdateSql = null;
let mockFakePool;
function makeFakePool() {
  const makeRequest = () => {
    const req = {
      params: {},
      input(name, _t, value) { this.params[name] = value; return this; },
      query: async (text) => {
        if (/UPDATE dbo\.FundTransfer/i.test(text)) {
          mockUpdateSql = { text, params: { ...req.params } };
          return { recordset: [], rowsAffected: [mockUpdateRows] };
        }
        if (/FROM dbo\.enterprise/i.test(text)) return { recordset: [{ name: "Acme Infra" }], rowsAffected: [1] };
        return { recordset: [], recordsets: [[]], rowsAffected: [0] };
      },
    };
    return req;
  };
  return { request: makeRequest };
}
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => mockFakePool,
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));

const token = () =>
  jwt.sign({ userId: 1, email: "smoke@example.com", name: "Super Admin", role: "super_admin", roleId: 1 }, process.env.JWT_SECRET);

const row = (status, narration = "old") => ({
  FTId: 7, DocNo: "FT-0007", Status: status, Narration: narration, SourceCompanyId: 3,
});

let app;
const put = (body, id = 7) =>
  request(app).put(`/api/fund-transfer/${id}/remarks`).set("Authorization", `Bearer ${token()}`).send(body);

beforeAll(async () => {
  const { createApp } = require("../server");
  app = await createApp();
});
beforeEach(() => {
  mockFakePool = makeFakePool();
  mockAllowPostApproval = true;
  mockUpdateRows = 1;
  mockUpdateSql = null;
  mockAmend.snapshotRow.mockReset();
  mockAmend.recordAmendment.mockReset();
  mockAmend.recordAmendment.mockResolvedValue(55);
});

describe("Fund Transfer: PUT /:id/remarks", () => {
  test.each(["Draft", "Pending", "Rejected"])("%s -> saved, no amendment", async (status) => {
    mockAmend.snapshotRow.mockResolvedValue(row(status));
    const res = await put({ Narration: "  new note  " });
    expect(res.status).toBe(200);
    expect(res.body.amendmentId).toBeNull();
    expect(mockUpdateSql.params.Narration).toBe("new note");
    expect(mockUpdateSql.params.status).toBe(status);
    expect(mockAmend.recordAmendment).not.toHaveBeenCalled();
  });

  test("Approved -> saved and logged as a fund-transfer amendment", async () => {
    mockAmend.snapshotRow
      .mockResolvedValueOnce(row("Approved", "old"))
      .mockResolvedValueOnce(row("Approved", "new"));
    const res = await put({ Narration: "new" });
    expect(res.status).toBe(200);
    expect(res.body.amendmentId).toBe(55);
    expect(res.body.message).toMatch(/Amendment/);
    const arg = mockAmend.recordAmendment.mock.calls[0][0];
    expect(arg).toMatchObject({ refDocType: "fund-transfer", refDocId: 7, refDocNo: "FT-0007", companyName: "Acme Infra" });
    expect(arg.before.Narration).toBe("old");
    expect(arg.after.Narration).toBe("new");
  });

  test("Approved without the post-approval right -> 403, nothing written", async () => {
    mockAllowPostApproval = false;
    mockAmend.snapshotRow.mockResolvedValue(row("Approved"));
    const res = await put({ Narration: "new" });
    expect(res.status).toBe(403);
    expect(mockUpdateSql).toBeNull();
    expect(mockAmend.recordAmendment).not.toHaveBeenCalled();
  });

  test("clearing the remarks stores NULL", async () => {
    mockAmend.snapshotRow.mockResolvedValue(row("Draft"));
    const res = await put({ Narration: "   " });
    expect(res.status).toBe(200);
    expect(mockUpdateSql.params.Narration).toBeNull();
  });

  test("unknown transfer -> 404", async () => {
    mockAmend.snapshotRow.mockResolvedValue(null);
    expect((await put({ Narration: "x" })).status).toBe(404);
  });

  test("Deleted transfer -> 400", async () => {
    mockAmend.snapshotRow.mockResolvedValue(row("Deleted"));
    const res = await put({ Narration: "x" });
    expect(res.status).toBe(400);
    expect(mockUpdateSql).toBeNull();
  });

  test("over 500 characters -> 400", async () => {
    const res = await put({ Narration: "a".repeat(501) });
    expect(res.status).toBe(400);
  });

  test("non-text narration -> 400", async () => {
    expect((await put({ Narration: { a: 1 } })).status).toBe(400);
  });

  test("status changed mid-request -> 409", async () => {
    mockAmend.snapshotRow.mockResolvedValue(row("Pending"));
    mockUpdateRows = 0;
    expect((await put({ Narration: "x" })).status).toBe(409);
  });

  test("an amendment-log failure doesn't fail the save", async () => {
    mockAmend.snapshotRow.mockResolvedValue(row("Approved"));
    mockAmend.recordAmendment.mockRejectedValue(new Error("boom"));
    const res = await put({ Narration: "new" });
    expect(res.status).toBe(200);
  });
});

describe("Amendment doc types", () => {
  test("fund-transfer shows up on the Finance amendment page", () => {
    const { DOC_TYPES } = jest.requireActual("../services/amendmentLog");
    expect(DOC_TYPES["fund-transfer"]).toEqual({ module: "finance", label: "Fund Transfer" });
  });
});
