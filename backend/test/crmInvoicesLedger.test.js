process.env.NODE_ENV = "test";

// The Invoices page: what its routes ask the database and how they shape the answer. The pool is faked; the SQL itself
// was run against the development database.
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
          if (/AS C_everything/.test(q)) return { recordset: [{ C_everything: 14, C_ready: 4, C_final: 1, C_uninvoiced: 4, C_none: 6, C_partial: 0, C_full: 3, C_closed: 5, S_PlanDue: 100, S_PlanInvoiced: 40, S_OtherInvoiced: 5, S_Invoiced: 45, S_Credited: 3, S_NetInvoiced: 42, S_ReadyAmount: 20, S_ReadyCount: 2, S_NotInvoiced: 60, S_ReceivedNotInvoiced: 10 }] };
          if (/AS LiveAmount/.test(q)) return { recordset: [{ LiveCount: 13, LiveAmount: 45, VoidCount: 9, Credited: 3 }] };
          if (/DISTINCT InvoiceType/.test(q)) return { recordset: [{ InvoiceType: "Final" }, { InvoiceType: "Milestone" }] };
          if (/COUNT\(\*\) AS Total/.test(q)) return { recordset: [{ Total: 13 }] };
          if (/SELECT m\.BookingId, m\.Id FROM/.test(q)) return { recordset: [{ BookingId: 5, Id: 71 }, { BookingId: 5, Id: 72 }] };
          return { recordset: [{ BookingId: 5, TotalRows: 2, ReadyCount: 2, Amount: 118, TotalGstAmount: 18, GrandTotal: 118 }, { BookingId: 6, TotalRows: 2, ReadyCount: 0, Amount: 100 }] };
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
const router = require("../routes/crmInvoices");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

describe("the billing of a booking", () => {
  test("a Final invoice bills the whole plan: every milestone counts, and nothing is left ready", async () => {
    await request(app).get("/ledger?page=1&pageSize=25");
    const q = pageQuery().q;
    expect(q).toContain("CASE WHEN z.HasFinal = 1 THEN z.MilestoneTotal ELSE z.MilestoneLinked END AS MilestoneInvoiced");
    expect(q).toContain("WHEN z.HasFinal = 1 OR z.Closed = 1 OR z.NonInvoice = 1 THEN 0 ELSE z.ReadyRaw END AS ReadyAmount");
    expect(q).toMatch(/i\.MilestoneId IS NOT NULL OR i\.InvoiceType = 'Final'/);
  });
  test("a Non-Invoice customer is ready only when nothing is outstanding, and then for the Final invoice", async () => {
    await request(app).get("/ledger?page=1&pageSize=25");
    const q = pageQuery().q;
    expect(q).toContain("CASE WHEN z.NonInvoice = 1 AND z.Closed = 0 AND z.HasFinal = 0 AND z.MilestoneTotal > 0 AND z.OpenCount = 0 THEN 1 ELSE 0 END AS FinalDue");
    expect(q).toContain("CASE WHEN fd.FinalDue = 1 THEN z.PlanDue");
    expect(q).toContain("(z.NonInvoice = 0 OR fd.FinalDue = 1)");
  });
  test("a waived milestone is not billable, and a void invoice counts for nothing", async () => {
    await request(app).get("/ledger?page=1&pageSize=25");
    const q = pageQuery().q;
    expect(q).toContain("SUM(CASE WHEN m.Status = 'Waived' THEN 0 ELSE 1 END) AS MilestoneTotal");
    expect(q).toContain("i.Status <> 'Void'");
  });
  test("money received beyond the plan is not flagged as not invoiced; closed bookings aren't flagged at all", async () => {
    await request(app).get("/ledger?page=1&pageSize=25");
    const q = pageQuery().q;
    expect(q).toMatch(/CASE WHEN z\.Closed = 0 AND \(z\.NonInvoice = 0 OR fd\.FinalDue = 1\) AND \(CASE WHEN z\.Approved < z\.PlanDue THEN z\.Approved ELSE z\.PlanDue END\) - z\.PlanInvoiced > 0\.009/);
    expect(q).toContain("b.IsActive = 1");
  });
});

test("the Final Statement is available only when everything is invoiced and paid, and writes nothing", async () => {
  const res = await request(app).get("/booking/5/statement");
  expect(res.status).toBe(409);
  expect(mockQueries).toHaveLength(1);
  expect(mockQueries[0].q).toContain("z.NonInvoice = 0 AND z.Closed = 0 AND z.HasFinal = 0 AND z.MilestoneTotal > 0 AND z.OpenCount = 0 AND z.MilestoneLinked = z.MilestoneTotal THEN 1 ELSE 0 END AS StatementDue");
  expect(mockQueries.every((x) => !/INSERT|UPDATE |DELETE/.test(x.q))).toBe(true);
});

describe("the bookings list", () => {
  test("one query for the rows and their total; what can be invoiced now comes first", async () => {
    const res = await request(app).get("/ledger?page=2&pageSize=25");
    expect(res.body.total).toBe(2);
    expect(res.body.rows[0].ReadyMilestoneIds).toEqual([71, 72]);
    expect(res.body.rows[1].ReadyMilestoneIds).toEqual([]);
    const { q, inputs } = pageQuery();
    expect(q).toContain("COUNT(*) OVER ()");
    expect(q).toContain("ORDER BY y.Closed ASC, y.ReadyAmount DESC, y.ReceivedNotInvoiced DESC, y.BookingId DESC");
    expect(inputs).toMatchObject({ offset: 25, pageSize: 25 });
  });
  test.each([
    ["ready", "y.ReadyAmount > 0"],
    ["uninvoiced", "y.ReceivedNotInvoiced > 0"],
    ["none", "y.MilestoneInvoiced = 0"],
    ["full", "y.MilestoneInvoiced = y.MilestoneTotal"],
    ["closed", "y.Closed = 1"],
  ])("the %s tab filters on the server", async (focus, test_) => {
    await request(app).get(`/ledger?page=1&pageSize=25&focus=${focus}`);
    expect(pageQuery().q).toContain(test_);
  });
  test("a sort outside the list is ignored; filters bind as inputs", async () => {
    await request(app).get("/ledger?page=1&pageSize=25&sortKey=DROP&search=Rahul&projectId=9&type=Final");
    const { q, inputs } = pageQuery();
    expect(q).not.toContain("DROP");
    expect(inputs).toMatchObject({ s: "%Rahul%", pid: 9, t: "Final" });
  });
  test("without a page: the rows alone, for the export", async () => {
    const res = await request(app).get("/ledger?focus=ready");
    expect(Array.isArray(res.body)).toBe(true);
  });
});

test("the figures are their own call, with the invoice types actually in use", async () => {
  const res = await request(app).get("/ledger/summary");
  expect(res.status).toBe(200);
  expect(res.body.counts).toEqual({ everything: 14, ready: 4, final: 1, uninvoiced: 4, none: 6, partial: 0, full: 3, closed: 5 });
  expect(res.body).toMatchObject({ planDue: 100, planInvoiced: 40, otherInvoiced: 5, credited: 3, netInvoiced: 42, ready: 20, readyCount: 2, receivedNotInvoiced: 10 });
  expect(res.body.types).toEqual(["Final", "Milestone"]);
  expect(res.body.invoices).toMatchObject({ liveCount: 13, voidCount: 9 });
});

describe("every invoice", () => {
  test("live and void are separate, sorted on the server", async () => {
    const res = await request(app).get("/?page=1&pageSize=25&status=void&sortKey=Amount&sortDir=asc");
    expect(res.body.total).toBe(13);
    const q = pageQuery().q;
    expect(q).toContain("inv.Status = 'Void'");
    expect(q).toMatch(/ORDER BY inv\.Amount ASC, inv\.Id DESC/);
    expect(res.body.rows[0]).toMatchObject({ GstAmount: 18, TaxableValue: 100 });
    expect(res.body.rows[0].GrandTotal).toBeUndefined();
  });
  test("without a page: the rows alone, for the export", async () => {
    const res = await request(app).get("/?status=live");
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockQueries[0].q).toContain("inv.Status <> 'Void'");
  });
});
