process.env.NODE_ENV = "test";

// The collections desk: what the route asks the database, and how it shapes the answer. The pool is faked; the SQL
// itself was compared with the booking rule on the development database.
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
          if (/AS LiveCount/.test(q)) {
            return { recordset: [{ LiveCount: 7, ClosedCount: 1, C_attention: 4, C_overdue: 2, C_soon: 3, C_finance: 1, C_recorded: 2, C_collected: 1,
              S_TotalDue: 100, S_Settled: 10, S_Held: 20, S_WithFinance: 5, S_ToCollect: 65, S_OverdueAmount: 40, Amt_d60: 40, Cnt_d60: 2 }] };
          }
          if (/SELECT Id, BookingId, MilestoneNo/.test(q)) {
            return { recordset: [
              { Id: 1, BookingId: 5, MilestoneNo: 1, MilestoneName: "Booking", AmountDue: 10, AmountPaid: 0, Status: "Pending" },
              { Id: 2, BookingId: 5, MilestoneNo: 2, MilestoneName: "Balance", AmountDue: 30, AmountPaid: 0, Status: "Pending" },
            ] };
          }
          return { recordset: [{ BookingId: 5, Held: 20, WithFinance: 5, Closed: 0, TotalRows: 2 }, { BookingId: 6, Held: 0, WithFinance: 0, Closed: 0, TotalRows: 2 }] };
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
const router = require("../routes/crmPayments");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("a page is one query for the rows and their total, plus one for the plans, through the money-stage rule", async () => {
  const res = await request(app).get("/ledger?page=1&pageSize=25");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(2);
  expect(res.body.rows[0].plan.map((m) => [m.HeldOnAccount, m.WithFinanceCover, m.MoneyStage])).toEqual([[10, 0, "Verified"], [10, 5, null]]);
  expect(res.body.rows[1].plan).toEqual([]);
  expect(mockQueries).toHaveLength(2);
  expect(pageQuery().q).toContain("COUNT(*) OVER ()");
  expect(mockQueries.some((x) => /AS LiveCount/.test(x.q))).toBe(false);
});

test("the figures are their own call: the tab counts, the money and the late rungs", async () => {
  const res = await request(app).get("/ledger/summary?projectId=9");
  expect(res.status).toBe(200);
  expect(res.body.counts).toEqual({ everything: 8, all: 7, closed: 1, attention: 4, overdue: 2, soon: 3, finance: 1, recorded: 2, collected: 1 });
  expect(res.body).toMatchObject({ totalDue: 100, held: 20, toCollect: 65, overdue: 40 });
  expect(res.body.ages.map((a) => a.key)).toEqual(["d30", "d60", "d90", "d90p"]);
  expect(res.body.ages[1]).toMatchObject({ amount: 40, count: 2 });
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].inputs.projectId).toBe(9);
});

test("the default queue is what needs action, the most money late the longest first; only live bookings", async () => {
  await request(app).get("/ledger?page=1&pageSize=25");
  const q = pageQuery().q;
  expect(q).toContain("ISNULL(oa.Held, 0) + ISNULL(rp.WithFinance, 0) + ISNULL(rec.Recorded, 0)");
  expect(q).toContain("dbo.CrmMoneyReceipt x");
  expect(q).toMatch(/ORDER BY m\.MilestoneNo, m\.Id ROWS UNBOUNDED PRECEDING/);
  expect(q).toContain("y.Closed = 0 AND (y.OverdueAmount > 0 OR y.A_soon > 0)");
  expect(q).toMatch(/ORDER BY y\.Closed ASC, y\.OverdueAmount \* y\.DaysLate DESC, y\.A_soon DESC, y\.BookingId DESC/);
  expect(q).toContain("b.IsActive = 1");
});

test.each([
  ["overdue", "y.OverdueAmount > 0"],
  ["soon", "y.A_soon > 0"],
  ["finance", "y.WithFinance > 0"],
  ["collected", "y.Collected + 0.009 >= y.TotalDue"],
  ["closed", "y.Closed = 1"],
])("the %s tab filters on the server", async (focus, test_) => {
  await request(app).get(`/ledger?page=1&pageSize=25&focus=${focus}`);
  expect(pageQuery().q).toContain(test_);
});

test("an ageing rung narrows the tab; the search and scope filters bind as inputs; a sort outside the list is ignored", async () => {
  await request(app).get("/ledger?page=2&pageSize=50&age=d60&search=Rohit&projectId=9&sortKey=DROP&sortDir=asc");
  const { q, inputs } = pageQuery();
  expect(q).toContain("y.A_d60 > 0");
  expect(q).not.toContain("DROP");
  expect(q).toMatch(/ORDER BY y\.OverdueAmount \* y\.DaysLate ASC/);
  expect(inputs).toMatchObject({ search: "%Rohit%", projectId: 9, offset: 50, pageSize: 50 });
});

test("without a page: the rows alone, for the export", async () => {
  const res = await request(app).get("/ledger?focus=overdue&sortKey=ToCollect");
  expect(Array.isArray(res.body)).toBe(true);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toMatch(/ORDER BY y\.ToCollect DESC/);
});
