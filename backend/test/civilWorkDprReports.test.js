process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "cwd-reports-test-secret";

/** Reports → Civil Work DPR: paged { data, total, page, totalPages } answers, filters bound as parameters. */

const jwt = require("jsonwebtoken");
const request = require("supertest");

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock("../requestLogger", () => (req, _res, next) => {
  req.id = "cwd-reports-test";
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

let mockQueries;
let mockFail;
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
        if (mockFail) throw new Error("boom: secret sql detail");
        if (/COUNT\(\*\) AS total/i.test(text)) return { recordset: [{ total: 1200 }] };
        return { recordset: [{ assignmentId: 1 }] };
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
  return request(app).get(`/api/civilworkdpr-reports/${path}`).set("Authorization", `Bearer ${token()}`);
};
const rowsQuery = () => mockQueries.find((q) => /OFFSET/i.test(q.text));
const countQuery = () => mockQueries.find((q) => /COUNT\(\*\) AS total/i.test(q.text) && !/OFFSET/i.test(q.text));

beforeEach(() => {
  mockPool = makePool();
  mockQueries = [];
  mockFail = false;
});

describe("every report answers a page the Reports screen can walk through", () => {
  test.each(["activity-status", "overdue", "engineer-workload", "quality-checks", "daily-updates"])("%s", async (name) => {
    const res = await get(`${name}?page=2&limit=500`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 1200, page: 2, totalPages: 3 });
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(rowsQuery().inputs).toMatchObject({ offset: 500, limit: 500 });
  });

  test("the page size is clamped and a bad page falls back to the first", async () => {
    const res = await get("activity-status?page=-4&limit=999999");
    expect(res.body.page).toBe(1);
    expect(rowsQuery().inputs).toMatchObject({ offset: 0, limit: 1000 });
  });

  test("a failing query gives a plain message, not the SQL error", async () => {
    mockFail = true;
    const res = await get("overdue");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Could not load the report.");
    expect(JSON.stringify(res.body)).not.toMatch(/secret sql/);
  });
});

describe("filters", () => {
  test("project and end-date range are bound as parameters, on the current attempt only", async () => {
    await get("activity-status?projectId=5&dateFrom=2026-10-01&dateTo=2026-10-31&status=in_progress");
    const q = rowsQuery();
    expect(q.inputs).toMatchObject({ dateFrom: "2026-10-01", dateTo: "2026-10-31", status: "IN_PROGRESS" });
    expect(q.text).toMatch(/daa\.IsCurrent = 1/);
    expect(q.text).toMatch(/dm\.ProjectId IN \(5\)/);
    expect(q.text).toMatch(/daa\.EndDate >= @dateFrom/);
    expect(q.text).toMatch(/daa\.EndDate <= @dateTo/);
    expect(q.text).toMatch(/daa\.Status = @status/);
    expect(countQuery().text).not.toMatch(/STRING_AGG/); // the count skips the per-row engineer names
  });

  test("an unknown status or a junk date is ignored, never put into the SQL", async () => {
    await get("activity-status?status=DROP%20TABLE&dateFrom=not-a-date");
    const q = rowsQuery();
    expect(q.text).not.toMatch(/@status|@dateFrom/);
    expect(q.text).not.toMatch(/DROP TABLE/);
  });

  test("overdue: scope narrows to late, or to due soon; default is both", async () => {
    await get("overdue?scope=overdue");
    expect(rowsQuery().text).toMatch(/daa\.EndDate < CAST\(GETDATE\(\) AS DATE\)/);
    mockQueries = [];
    await get("overdue?scope=due-soon");
    expect(rowsQuery().text).toMatch(/daa\.EndDate >= CAST\(GETDATE\(\) AS DATE\)/);
    mockQueries = [];
    await get("overdue");
    expect(rowsQuery().text).toMatch(/daa\.EndDate <= DATEADD\(DAY, 2/);
    expect(rowsQuery().text).toMatch(/daa\.Status IN \('ALLOCATED','IN_PROGRESS','HOLD','REWORK'\)/);
  });

  test("quality checks filter on the inspection date, inclusive of the last day", async () => {
    await get("quality-checks?dateFrom=2026-10-01&dateTo=2026-10-07");
    const q = rowsQuery();
    expect(q.text).toMatch(/qc\.QcAt >= @dateFrom/);
    expect(q.text).toMatch(/qc\.QcAt < DATEADD\(DAY, 1, @dateTo\)/);
  });

  test("daily updates filter on the update date and show the logged time in IST", async () => {
    await get("daily-updates?dateFrom=2026-10-07&dateTo=2026-10-07");
    const q = rowsQuery();
    expect(q.text).toMatch(/cu\.UpdateDate >= @dateFrom/);
    expect(q.text).toMatch(/DATEADD\(MINUTE, 330 - DATEDIFF\(MINUTE, SYSUTCDATETIME\(\), SYSDATETIME\(\)\)/);
    expect(q.text).not.toMatch(/cu\.Photo AS/); // the photo itself is never pulled into a report
  });

  test("engineer workload groups per engineer and leaves cancelled work out", async () => {
    await get("engineer-workload?projectId=3");
    const q = rowsQuery();
    expect(q.text).toMatch(/GROUP BY u\.id, u\.name/);
    expect(q.text).toMatch(/daa\.Status <> 'CANCELLED'/);
    expect(q.text).toMatch(/dm\.ProjectId IN \(3\)/);
  });
});

describe("several projects at once", () => {
  test("a comma-separated list becomes one IN list on every report", async () => {
    for (const name of ["activity-status", "overdue", "engineer-workload", "quality-checks", "daily-updates"]) {
      mockQueries = [];
      await get(`${name}?projectId=4,7,9`);
      expect(rowsQuery().text).toMatch(/dm\.ProjectId IN \(4,7,9\)/);
      expect(countQuery().text).toMatch(/dm\.ProjectId IN \(4,7,9\)/);
    }
  });

  test("anything that is not a whole number is dropped, so it can never reach the SQL", async () => {
    await get("activity-status?projectId=4,x;DROP%20TABLE%20a,,7.5,-2");
    const text = rowsQuery().text;
    expect(text).toMatch(/dm\.ProjectId IN \(4,7,-2\)/);
    expect(text).not.toMatch(/DROP/);
  });
});

describe("parseCommon", () => {
  const { parseCommon, validDate } = require("../routes/civilWorkDprReports")._test;
  test("defaults", () => {
    expect(parseCommon({ query: {} })).toMatchObject({ projectIds: [], dateFrom: null, dateTo: null, limit: 500, page: 1, offset: 0 });
  });
  test("validDate keeps only the date part of a real date", () => {
    expect(validDate("2026-10-07T10:00:00Z")).toBe("2026-10-07");
    expect(validDate("nope")).toBeNull();
    expect(validDate("")).toBeNull();
  });
});
