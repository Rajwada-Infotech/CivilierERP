process.env.NODE_ENV = "test";

// The Cancellations list: the sort whitelist, the paid-till-date total for the totals strip, and the export.
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
          if (/COUNT\(\*\) AS total/.test(q)) return { recordset: [{ total: 12, paidTillDate: 4500000.75 }] };
          if (/GROUP BY c\.Status/.test(q)) return { recordset: [{ Status: "Pending", n: 4 }, { Status: "Approved", n: 8 }] };
          if (/COUNT\(\*\) AS n FROM/.test(q)) return { recordset: [{ n: 3 }] };
          return { recordset: [{ Id: 1, CancellationNo: "CXL-1" }] };
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
const router = require("../routes/crmCancellations");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q)).q;

test("a page brings its rows, the total, the counts by status and the paid-till-date total", async () => {
  const res = await request(app).get("/?page=1&pageSize=25&status=Pending");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(12);
  expect(res.body.statusCounts).toEqual({ Pending: 4, Approved: 8 });
  expect(res.body.summary).toEqual({ paidTillDate: 4500000.75, refundsOverdue: 3 });
  // the total follows the status tab; the counts by status don't (they fill the tabs)
  expect(mockQueries.find((x) => /COUNT\(\*\) AS total/.test(x.q)).q).toMatch(/c\.Status = @st/);
  expect(mockQueries.find((x) => /GROUP BY c\.Status/.test(x.q)).q).not.toMatch(/c\.Status = @st/);
});

test("a listed column sorts both ways; newest first by default", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=AmountPaidTillDate&sortDir=asc");
  expect(pageQuery()).toMatch(/ORDER BY c\.AmountPaidTillDate ASC, c\.Id DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25");
  expect(pageQuery()).toMatch(/ORDER BY c\.CreatedAt DESC, c\.Id DESC/);
});

test("an unknown sort never reaches the SQL", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=1;DROP TABLE x&sortDir=up");
  expect(pageQuery()).toMatch(/ORDER BY c\.CreatedAt DESC/);
  expect(mockQueries.some((x) => /DROP/.test(x.q))).toBe(false);
});

test("without a page (the export) every matching row comes back sorted, as a plain list", async () => {
  const res = await request(app).get("/?sortKey=ApplicantName&sortDir=asc");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toMatch(/ORDER BY a\.ApplicantName ASC, c\.Id DESC/);
  expect(mockQueries[0].q).not.toMatch(/OFFSET/);
});

test("one cancellation by id: the record page's row; a bad id is refused", async () => {
  const res = await request(app).get("/5");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ Id: 1, CancellationNo: "CXL-1" });
  const q = mockQueries.find((x) => /WHERE c\.Id = @id/.test(x.q));
  expect(q.inputs.id).toBe(5);
  expect(q.q).toMatch(/b\.ApplicationId/);
  expect((await request(app).get("/abc")).status).toBe(400);
});

test("requested-date range and overdue refunds filter every count; bad dates are ignored", async () => {
  await request(app).get("/?page=1&pageSize=25&dateFrom=2026-04-01&dateTo=2026-11-05&refundOverdue=1");
  const counted = mockQueries.filter((x) => /COUNT\(\*\)/.test(x.q));
  expect(counted.length).toBe(3);
  for (const x of [...counted, { q: pageQuery(), inputs: mockQueries.find((y) => /OFFSET @offset/.test(y.q)).inputs }]) {
    expect(x.q).toMatch(/c\.RequestedDate >= @dateFrom/);
    expect(x.q).toMatch(/c\.RequestedDate < DATEADD\(day, 1, @dateTo\)/);
    expect(x.q).toMatch(/lro\.RefundDueDate IS NOT NULL/);
    expect(x.inputs.dateFrom).toBe("2026-04-01");
  }
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&dateFrom=yesterday&dateTo=1;DROP");
  expect(mockQueries.some((x) => /@dateFrom|@dateTo|DROP/.test(x.q))).toBe(false);
});
