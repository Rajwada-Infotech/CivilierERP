process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "item-master-short-code-test-secret";

/** Item Master: the short code (M_code) is unique across items. */

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = "item-master-code-test";
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

let mockClash; // the other item that already uses the code, or null
let mockStoredCode; // the code the item being edited has today
let mockQueries;
const makePool = () => ({
  request: () => {
    const inputs = {};
    const req = {
      input: (name, _t, value) => {
        inputs[name] = value;
        return req;
      },
      query: async (text) => {
        mockQueries.push({ text, inputs: { ...inputs } });
        if (/SELECT TOP 1 M_Id, M_Name/i.test(text)) return { recordset: mockClash ? [mockClash] : [] };
        if (/SELECT M_code FROM dbo\.Item_Master_Group WHERE M_Id/i.test(text)) return { recordset: [{ M_code: mockStoredCode }] };
        if (/FROM sys\.columns/i.test(text)) return { recordset: [] };
        if (/INSERT INTO dbo\.Item_Master_Group/i.test(text)) return { recordset: [{ M_Id: "11111111-1111-1111-1111-111111111111" }], rowsAffected: [1] };
        if (/UPDATE dbo\.Item_Master_Group/i.test(text)) return { recordset: [], rowsAffected: [1] };
        return { recordset: [], rowsAffected: [0] };
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

const GROUP = "22222222-2222-2222-2222-222222222222";
const ITEM = "33333333-3333-3333-3333-333333333333";
const body = (code) => ({ M_Name: "White Cement", M_Type: "Material", M_BelongsTo: GROUP, Parent_Id: GROUP, M_code: code });

const app = async () => require("../server").createApp();
const create = async (code) =>
  request(await app()).post("/api/item-master").set("Authorization", `Bearer ${token()}`).send(body(code));
const update = async (code) =>
  request(await app()).put(`/api/item-master/${ITEM}`).set("Authorization", `Bearer ${token()}`).send(body(code));

beforeEach(() => {
  mockPool = makePool();
  mockClash = null;
  mockStoredCode = "OLD";
  mockQueries = [];
});

describe("creating an item", () => {
  test("a free short code is saved, trimmed", async () => {
    const res = await create("  WC1  ");
    expect(res.status).toBe(201);
    const insert = mockQueries.find((q) => /INSERT INTO dbo\.Item_Master_Group/i.test(q.text));
    expect(insert.inputs.M_code).toBe("WC1");
  });

  test("a code another item already uses is refused with that item's name, and nothing is written", async () => {
    mockClash = { M_Id: "x", M_Name: "Grey Cement" };
    const res = await create("gc1");
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/"gc1".*"Grey Cement"/);
    expect(mockQueries.some((q) => /INSERT INTO/i.test(q.text))).toBe(false);
  });

  test("the check ignores case and surrounding spaces, and only looks at items (not groups)", async () => {
    await create(" wc1 ");
    const check = mockQueries.find((q) => /SELECT TOP 1 M_Id, M_Name/i.test(q.text));
    expect(check.text).toMatch(/Parent_Id IS NOT NULL/);
    expect(check.text).toMatch(/UPPER\(LTRIM\(RTRIM\(M_code\)\)\) = UPPER\(@code\)/);
    expect(check.inputs.code).toBe("wc1");
  });

  test("an item without a short code skips the check", async () => {
    const res = await create("   ");
    expect(res.status).toBe(201);
    expect(mockQueries.some((q) => /SELECT TOP 1 M_Id, M_Name/i.test(q.text))).toBe(false);
  });

  test("a code longer than 20 characters is a 400, not a database error", async () => {
    const res = await create("X".repeat(21));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 20/);
  });
});

describe("editing an item", () => {
  test("changing to a code another item uses is refused", async () => {
    mockClash = { M_Id: "x", M_Name: "Grey Cement" };
    const res = await update("GC1");
    expect(res.status).toBe(409);
    expect(mockQueries.some((q) => /UPDATE dbo\.Item_Master_Group/i.test(q.text))).toBe(false);
  });

  test("the item itself is left out of the check", async () => {
    await update("NEW1");
    const check = mockQueries.find((q) => /SELECT TOP 1 M_Id, M_Name/i.test(q.text));
    expect(check.inputs.excludeId).toBe(ITEM);
    expect(check.text).toMatch(/M_Id <> @excludeId/);
  });

  test("keeping the code it already has is always allowed, even if an older duplicate exists", async () => {
    mockStoredCode = "dup";
    mockClash = { M_Id: "x", M_Name: "Other Item" };
    const res = await update("DUP");
    expect(res.status).toBe(200);
    expect(mockQueries.some((q) => /SELECT TOP 1 M_Id, M_Name/i.test(q.text))).toBe(false);
  });
});
