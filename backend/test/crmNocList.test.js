process.env.NODE_ENV = "test";

// The NOC list and record: sort, the requested-date filter, the export and GET /:id.
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
          if (/GROUP BY n\.Status/.test(q)) return { recordset: [{ Status: "Pending", C: 2 }, { Status: "Issued", C: 4 }] };
          if (/GROUP BY n\.NocType/.test(q)) return { recordset: [{ NocType: "Bank", C: 1 }, { NocType: "Organisation", C: 5 }] };
          return { recordset: [{ Id: 1, NocNo: "NOC-1", ProjectId: 1 }] };
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
const router = require("../routes/crmNoc");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("a page brings rows, status and type counts; rows carry project, application and agreement", async () => {
  const res = await request(app).get("/?page=1&pageSize=25");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(6);
  expect(res.body.typeCounts).toEqual({ Bank: 1, Organisation: 5 });
  const q = pageQuery().q;
  expect(q).toMatch(/AS ProjectName/);
  expect(q).toMatch(/b\.ApplicationId/);
  expect(q).toMatch(/ag\.AgreementNo/);
});

test("200 a page is allowed, more is capped; new sort keys work, an unknown one falls back", async () => {
  await request(app).get("/?page=1&pageSize=900&sortKey=LoanAmount&sortDir=asc");
  expect(pageQuery().inputs.pageSize).toBe(200);
  expect(pageQuery().q).toMatch(/ORDER BY n\.LoanAmount ASC, n\.Id DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&sortKey=x;DROP");
  expect(pageQuery().q).toMatch(/ORDER BY n\.CreatedAt DESC, n\.Id DESC/);
});

test("the requested-date range filters every query; bad dates are ignored", async () => {
  await request(app).get("/?page=1&pageSize=25&dateFrom=2026-04-01&dateTo=2026-11-05&type=Bank");
  for (const x of mockQueries) {
    expect(x.q).toMatch(/n\.NocDate >= @dateFrom/);
    expect(x.q).toMatch(/n\.NocDate < DATEADD\(day, 1, @dateTo\)/);
  }
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&dateFrom=later");
  expect(mockQueries.some((x) => /@dateFrom/.test(x.q))).toBe(false);
});

test("without a page (the export) every matching row comes back sorted", async () => {
  const res = await request(app).get("/?sortKey=NocDate&sortDir=asc&status=Issued");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toMatch(/ORDER BY n\.NocDate ASC, n\.Id DESC/);
});

test("one NOC by id for the record page; the fixed paths are not taken for an id", async () => {
  const res = await request(app).get("/7");
  expect(res.status).toBe(200);
  expect(res.body.NocNo).toBe("NOC-1");
  expect(mockQueries.some((x) => /WHERE n\.Id = @id/.test(x.q) && x.inputs.id === 7)).toBe(true);
  mockQueries.length = 0;
  await request(app).get("/eligible-bookings");
  expect(mockQueries.some((x) => /WHERE n\.Id = @id/.test(x.q))).toBe(false);
});
