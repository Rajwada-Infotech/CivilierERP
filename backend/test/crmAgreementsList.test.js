process.env.NODE_ENV = "test";

// The Agreement list: status counts for the tabs, sort, the signing-date filter and the export.
// The pool is faked, so these check what the route asks the database and how it shapes the answer.
const mockQueries = [];

jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request() {
      const r = {
        inputs: {},
        input(n, _t, v) { r.inputs[n] = v; return r; },
        async query(q) {
          mockQueries.push({ q, inputs: r.inputs });
          if (/GROUP BY ag\.Status/.test(q)) return { recordset: [{ Status: "Draft", n: 7 }, { Status: "Registered", n: 3 }] };
          if (/COUNT\(\*\) AS total/.test(q)) return { recordset: [{ total: 7 }] };
          return { recordset: [{ Id: 1, AgreementNo: "AGR-1" }] };
        },
      };
      return r;
    },
  }),
}));
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));
jest.mock("../socket", () => ({ getIo: () => null }));
jest.mock("../middleware/auth", () => (_req, _res, next) => next());
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (_req, _res, next) => next();
  return { requirePageRight: pass, requireAnyPageRight: pass };
});

const express = require("express");
const request = require("supertest");
const router = require("../routes/crmAgreements");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("a page brings rows, the total and the counts by status; the counts ignore the status tab", async () => {
  const res = await request(app).get("/?page=1&pageSize=25&status=Draft");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(7);
  expect(res.body.statusCounts).toEqual({ Draft: 7, Registered: 3 });
  expect(pageQuery().q).toMatch(/ag\.Status = @st/);
  expect(mockQueries.find((x) => /GROUP BY ag\.Status/.test(x.q)).q).not.toMatch(/ag\.Status = @st/);
});

test("a listed column sorts both ways; an unknown one falls back to newest first", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=LegalExecutiveName&sortDir=asc");
  expect(pageQuery().q).toMatch(/ORDER BY le\.name ASC, ag\.Id DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&sortKey=1;DROP&sortDir=x");
  expect(pageQuery().q).toMatch(/ORDER BY ag\.CreatedAt DESC, ag\.Id DESC/);
  expect(mockQueries.some((x) => /DROP/.test(x.q))).toBe(false);
});

test("the signing-date range filters every query; bad dates are ignored", async () => {
  await request(app).get("/?page=1&pageSize=25&dateFrom=2026-04-01&dateTo=2026-11-05");
  for (const x of mockQueries) {
    expect(x.q).toMatch(/ag\.AgreementDate >= @dateFrom/);
    expect(x.q).toMatch(/ag\.AgreementDate < DATEADD\(day, 1, @dateTo\)/);
  }
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&dateTo=tomorrow");
  expect(mockQueries.some((x) => /@dateTo/.test(x.q))).toBe(false);
});

test("without a page (the export) every matching row comes back sorted, as a plain list", async () => {
  const res = await request(app).get("/?sortKey=AgreementDate&sortDir=asc&status=Registered");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toMatch(/ag\.Status = @st/);
  expect(mockQueries[0].q).toMatch(/ORDER BY ag\.AgreementDate ASC, ag\.Id DESC/);
});
