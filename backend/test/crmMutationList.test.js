process.env.NODE_ENV = "test";

// The Mutation list: sort, the applied-date filter, the fee total and the export.
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
          if (/GROUP BY m\.Status/.test(q)) return { recordset: [{ Status: "Applied", C: 3, Fee: 1500.1 }, { Status: "Approved", C: 2, Fee: 2000.2 }] };
          return { recordset: [{ Id: 1, MutationNo: "MUT-1" }] };
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
const router = require("../routes/crmMutation");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("the fee total is to the paisa, across every status or for the tab", async () => {
  let res = await request(app).get("/?page=1&pageSize=25");
  expect(res.status).toBe(200);
  expect(res.body.summary).toEqual({ feeTotal: 3500.3 });
  expect(res.body.total).toBe(5);
  res = await request(app).get("/?page=1&pageSize=25&status=Applied");
  expect(res.body.summary).toEqual({ feeTotal: 1500.1 });
  expect(res.body.total).toBe(3);
});

test("rows carry the project, the application and the document progress", async () => {
  await request(app).get("/?page=1&pageSize=25");
  const q = pageQuery().q;
  expect(q).toMatch(/AS ProjectName/);
  expect(q).toMatch(/b\.ApplicationId/);
  expect(q).toMatch(/AS DocsRequired/);
  expect(q).toMatch(/AS DocsVerified/);
});

test("a page of 200 is allowed; more is capped", async () => {
  await request(app).get("/?page=1&pageSize=200");
  expect(pageQuery().inputs.pageSize).toBe(200);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=5000");
  expect(pageQuery().inputs.pageSize).toBe(200);
});

test("the applied-date range filters the counts and the page; bad dates are ignored", async () => {
  await request(app).get("/?page=1&pageSize=25&dateFrom=2026-04-01&dateTo=2026-11-05");
  for (const x of mockQueries) {
    expect(x.q).toMatch(/m\.ApplicationDate >= @dateFrom/);
    expect(x.q).toMatch(/m\.ApplicationDate < DATEADD\(day, 1, @dateTo\)/);
  }
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&dateFrom=soon&dateTo=1;DROP");
  expect(mockQueries.some((x) => /@dateFrom|@dateTo|DROP/.test(x.q))).toBe(false);
});

test("the new sort keys work; an unknown one falls back to newest first", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=MutationFee&sortDir=asc");
  expect(pageQuery().q).toMatch(/ORDER BY m\.MutationFee ASC, m\.Id DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&sortKey=1;DROP&sortDir=asc");
  expect(pageQuery().q).toMatch(/ORDER BY m\.CreatedAt ASC, m\.Id DESC/);
});

test("without a page (the export) every matching row comes back sorted, as a plain list", async () => {
  const res = await request(app).get("/?sortKey=ApplicantName&sortDir=asc&status=Approved");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toMatch(/m\.Status = @status/);
  expect(mockQueries[0].q).toMatch(/ORDER BY a\.ApplicantName ASC, m\.Id DESC/);
});
