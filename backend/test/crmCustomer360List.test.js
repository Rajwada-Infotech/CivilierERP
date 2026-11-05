process.env.NODE_ENV = "test";

// Customer 360's list: saved views, the sort whitelist, the per-view counts and totals, and each row's units.
// The pool is faked, so these check what the route asks the database and how it shapes the answer.
const mockQueries = [];
let mockPageRows = [];
let mockSummaryRow = {};
let mockUnitRows = [];

jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request() {
      const r = {
        inputs: {},
        input(n, _t, v) { r.inputs[n] = v; return r; },
        async query(q) {
          mockQueries.push({ q, inputs: r.inputs });
          if (/AS View_all/.test(q)) return { recordset: [mockSummaryRow] };
          if (/vw_CrmBookingDisplay/.test(q) && /IN \(@c0/.test(q)) return { recordset: mockUnitRows };
          return { recordset: mockPageRows };
        },
      };
      return r;
    },
  }),
}));
jest.mock("../middleware/auth", () => (_req, _res, next) => next());
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => ({ requirePageRight: () => (_req, _res, next) => next() }));

const express = require("express");
const request = require("supertest");
const router = require("../routes/crmCustomer360");
const app = express();
app.use("/", router);

beforeEach(() => {
  mockQueries.length = 0;
  mockPageRows = [{ Id: 7, CustomerName: "A" }, { Id: 9, CustomerName: "B" }];
  mockSummaryRow = { View_all: 120, View_due: 30, View_clear: 50, View_nobooking: 40, totalPaid: 1000.5, totalOutstanding: 250.25, activeBookings: 33 };
  mockUnitRows = [{ CustomerId: 7, ProjectName: "Gloria", UnitNo: "A-101" }, { CustomerId: 7, ProjectName: "Gloria", UnitNo: "A-102" }];
});

const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q)).q;

test("a view keeps only its rows, and the total is that view's count", async () => {
  const res = await request(app).get("/?page=1&pageSize=25&status=due");
  expect(res.status).toBe(200);
  expect(pageQuery()).toMatch(/\) x WHERE x\.TotalOutstanding > 0/);
  expect(res.body.total).toBe(30);
  expect(res.body.views).toEqual({ all: 120, due: 30, clear: 50, nobooking: 40 });
  expect(res.body.summary).toEqual({ totalPaid: 1000.5, totalOutstanding: 250.25, activeBookings: 33 });
});

test("an unknown view or sort falls back to all customers, newest first; never into the SQL", async () => {
  await request(app).get("/?page=1&pageSize=25&status=1;DROP&sortKey=Id;--&sortDir=sideways");
  const q = pageQuery();
  expect(q).toMatch(/\) x WHERE 1 = 1/);
  expect(q).toMatch(/ORDER BY x\.CreatedAt DESC, x\.Id DESC/);
  expect(mockQueries.some((x) => /DROP|Id;--/.test(x.q))).toBe(false);
});

test("a listed column sorts both ways", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=TotalOutstanding&sortDir=asc");
  expect(pageQuery()).toMatch(/ORDER BY x\.TotalOutstanding ASC, x\.Id DESC/);
});

test("the search goes in as a parameter to every query that filters", async () => {
  await request(app).get("/?page=1&pageSize=25&search=rah");
  const filtered = mockQueries.filter((x) => /CustomerName LIKE @srch/.test(x.q));
  expect(filtered).toHaveLength(2);
  expect(filtered.every((x) => x.inputs.srch === "%rah%")).toBe(true);
});

test("each row carries its live units; a customer without one gets an empty list", async () => {
  const res = await request(app).get("/?page=1&pageSize=25");
  expect(res.body.rows.find((r) => r.Id === 7).Units).toEqual([
    { ProjectName: "Gloria", UnitNo: "A-101" }, { ProjectName: "Gloria", UnitNo: "A-102" },
  ]);
  expect(res.body.rows.find((r) => r.Id === 9).Units).toEqual([]);
});

test("without a page (the export) every matching row of the view comes back, sorted, as a plain list", async () => {
  const res = await request(app).get("/?status=nobooking&sortKey=CustomerName&sortDir=asc");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries[0].q).toMatch(/\) x WHERE x\.ActiveBookingCount = 0 ORDER BY x\.CustomerName ASC/);
  expect(mockQueries[0].q).not.toMatch(/OFFSET/);
  // the export carries each customer's units too
  expect(res.body.find((r) => r.Id === 7).Units).toHaveLength(2);
});
