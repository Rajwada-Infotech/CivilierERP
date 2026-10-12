process.env.NODE_ENV = "test";

/**
 * Payments list: the cheque-number filter (GET /api/new-payment?chequeNo=...). It matches any part of the cheque number
 * on np.PChequeNo, applies to both the page of rows and the total, trims the input, and is bound as a parameter -
 * never written into the SQL. The pool is faked; the real SQL was run against the dev database separately.
 */
const express = require("express");
const request = require("supertest");

let mockQueries = [];
let mockInputs = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));
jest.mock("../middleware/permissions", () => ({
  checkPermission: () => (_req, _res, next) => next(),
  userPermissionCache: { invalidate: () => {} },
  permissionCache: { invalidateAll: () => {}, invalidateRole: () => {} },
  resolveAllowPostApproval: async () => true,
}));
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn().mockResolvedValue(),
  getCacheVersion: jest.fn().mockResolvedValue(1),
  getRedis: () => null,
  redisGet: jest.fn(),
  redisSet: jest.fn(),
  redisDel: jest.fn(),
  invalidateUserSession: jest.fn(),
}));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const inputs = {};
      const r = {
        input: (name, _type, value) => {
          inputs[name] = value;
          return r;
        },
        query: async (text) => {
          mockQueries.push(text);
          mockInputs.push({ ...inputs });
          if (/COUNT\(\*\) AS total/.test(text)) return { recordset: [{ total: 1 }] };
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));

const router = require("../routes/newPayment");

const app = express();
app.use((req, _res, next) => {
  req.user = { userId: 1, roleId: 1, role: "admin", email: "a@x.in" };
  req.projectScope = null;
  next();
});
app.use("/api/new-payment", router);

const list = (qs = "") => request(app).get(`/api/new-payment?page=1&limit=20${qs}`);
const countSql = () => mockQueries.find((q) => /COUNT\(\*\) AS total/.test(q));
const dataSql = () => mockQueries.find((q) => /np\.\*/.test(q));
const inputsFor = (sqlText) => mockInputs[mockQueries.indexOf(sqlText)];

beforeEach(() => {
  mockQueries = [];
  mockInputs = [];
});

describe("GET /api/new-payment - cheque number filter", () => {
  it("matches any part of the cheque number, in both the row page and the total", async () => {
    const res = await list("&chequeNo=004512");
    expect(res.status).toBe(200);
    expect(countSql()).toMatch(/np\.PChequeNo LIKE @chequeNo/);
    expect(dataSql()).toMatch(/np\.PChequeNo LIKE @chequeNo/);
    expect(inputsFor(countSql()).chequeNo).toBe("%004512%");
    expect(inputsFor(dataSql()).chequeNo).toBe("%004512%");
  });

  it("trims spaces, and leaves the filter out entirely when it is empty", async () => {
    await list("&chequeNo=%20%20123%20");
    expect(inputsFor(countSql()).chequeNo).toBe("%123%");
    mockQueries = [];
    mockInputs = [];
    await list("&chequeNo=%20%20");
    expect(countSql()).not.toMatch(/PChequeNo LIKE/);
    expect(inputsFor(countSql()).chequeNo).toBeUndefined();
    await list("");
    expect(dataSql()).not.toMatch(/PChequeNo LIKE/);
  });

  it("is bound as a parameter - what is typed never reaches the SQL text", async () => {
    await list(`&chequeNo=${encodeURIComponent("1' OR '1'='1; DROP TABLE dbo.NewPayment")}`);
    expect(mockQueries.join("\n")).not.toMatch(/DROP TABLE/);
    expect(inputsFor(countSql()).chequeNo).toContain("DROP TABLE");
  });

  it("is capped at 50 characters, and a repeated parameter cannot break it", async () => {
    await list(`&chequeNo=${"9".repeat(200)}`);
    expect(inputsFor(countSql()).chequeNo).toBe(`%${"9".repeat(50)}%`);
    mockQueries = [];
    mockInputs = [];
    const res = await list("&chequeNo=111&chequeNo=222"); // Express turns this into an array
    expect(res.status).toBe(200);
  });

  it("combines with the other filters instead of replacing them", async () => {
    await list("&chequeNo=4512&docNumber=PAY&supplier=Sharma");
    const where = countSql();
    expect(where).toMatch(/np\.PChequeNo LIKE @chequeNo/);
    expect(where).toMatch(/np\.DocNo LIKE @docNumber/);
    expect(where).toMatch(/@search/);
  });
});
