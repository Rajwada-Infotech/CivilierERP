process.env.NODE_ENV = "test";

// The Sale Deed list: the status worked out in SQL (one rule) so the filter, counts, order and paging run on the server; and the same rule for a save.
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
          if (/GROUP BY x\.DerivedStatus/.test(q)) return { recordset: [{ Status: "Draft", n: 6 }, { Status: "Overdue", n: 2 }, { Status: "Registered", n: 4 }] };
          if (/ AS S$/.test(q.trim())) return { recordset: [{ S: "Draft" }] };
          if (/AS MadeThisMonth/.test(q)) return { recordset: [{ Total: 20, Registered: 5, OpenCount: 13, AvgDays: 6.6, S_1: 2, S_6: 4, A_overdue: 3, A_toRegister: 1, MadeThisMonth: 2, DeedDatesThisMonth: 1, RegisteredThisMonth: 1, DueOverdue: 3, DueThisWeek: 2, DueThisMonth: 1, DueLater: 4, DueNotSet: 3, DeedValue: 1000000.1, StampDuty: 60000.2, RegistrationFee: 10000.3, StampDutyCredit: 5000.1 }] };
          if (/GROUP BY ISNULL\(x\.LegalExecutiveName/.test(q)) return { recordset: [{ Name: "", OpenCount: 4, OldestDays: 30 }, { Name: "Riya", OpenCount: 9, OldestDays: 12 }] };
          if (/GROUP BY x\.StepIndex/.test(q)) return { recordset: [{ StepIndex: 1, n: 2 }, { StepIndex: 6, n: 40 }] };
          if (/PARTITION BY x\.StepIndex/.test(q)) return { recordset: [{ Id: 7, StepIndex: 6, DeedNo: "D-7" }, { Id: 8, StepIndex: 1, DeedNo: "D-8" }] };
          return { recordset: [{ Id: 1, DeedNo: "DEED-1", Status: "Draft", DerivedStatus: "Overdue" }] };
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
const router = require("../routes/crmSalesDeed");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("each row's status is the worked-out one, from the one SQL rule", async () => {
  const res = await request(app).get("/?page=1&pageSize=25");
  expect(res.status).toBe(200);
  expect(res.body.rows[0].Status).toBe("Overdue");
  expect(res.body.rows[0]).not.toHaveProperty("DerivedStatus");
  const q = pageQuery().q;
  expect(q).toMatch(/AS DerivedStatus/);
  // cancelled first, then registered, then overdue on today's date
  expect(q).toMatch(/WHEN ISNULL\(d\.Status, ''\) = 'Cancelled' THEN 'Cancelled'[\s\S]*THEN 'Registered'[\s\S]*THEN 'Overdue'[\s\S]*THEN 'Executed'[\s\S]*ELSE 'Draft'/);
  expect(q).toMatch(/CAST\(SYSDATETIME\(\) AS DATE\)/);
});

test("a status tab filters, counts and pages on the server", async () => {
  const res = await request(app).get("/?page=2&pageSize=25&status=Overdue");
  expect(pageQuery().q).toMatch(/WHERE x\.DerivedStatus = @st ORDER BY/);
  expect(pageQuery().inputs).toMatchObject({ st: "Overdue", offset: 25, pageSize: 25 });
  expect(res.body.statusCounts).toEqual({ Draft: 6, Overdue: 2, Registered: 4 });
  expect(res.body.total).toBe(2);
});

test("sort keys work; an unknown one falls back to newest first", async () => {
  await request(app).get("/?page=1&pageSize=25&sortKey=RegistrationDeadline&sortDir=asc");
  expect(pageQuery().q).toMatch(/ORDER BY x\.RegistrationDeadline ASC, x\.Id DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&sortKey=1;DROP");
  expect(pageQuery().q).toMatch(/ORDER BY x\.CreatedAt DESC, x\.Id DESC/);
  expect(mockQueries.some((x) => /DROP/.test(x.q))).toBe(false);
});

test("the deed-date range filters every query; bad dates are ignored", async () => {
  await request(app).get("/?page=1&pageSize=25&dateFrom=2026-04-01&dateTo=2026-11-05");
  for (const x of mockQueries) expect(x.q).toMatch(/d\.DeedDate >= @dateFrom[\s\S]*d\.DeedDate < DATEADD\(day, 1, @dateTo\)/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&dateFrom=soon");
  expect(mockQueries.some((x) => /@dateFrom/.test(x.q))).toBe(false);
});

test("without a page (the export) every matching row comes back sorted, with the worked-out status", async () => {
  const res = await request(app).get("/?status=Overdue&sortKey=DeedDate&sortDir=asc");
  expect(Array.isArray(res.body)).toBe(true);
  expect(res.body[0].Status).toBe("Overdue");
  expect(mockQueries[0].q).toMatch(/WHERE x\.DerivedStatus = @st ORDER BY x\.DeedDate ASC/);
  expect(mockQueries[0].q).not.toMatch(/OFFSET/);
});

test("every deed row carries its steps, the step it is on, the days there and its alerts", async () => {
  await request(app).get("/?page=1&pageSize=25");
  const q = pageQuery().q;
  for (const k of ["setup", "legal", "docs", "senior", "customer", "director", "stampDuty", "execution", "registered"]) expect(q).toContain(`AS D_${k}`);
  for (const k of ["overdue", "recheck", "noLegal", "toSend", "director", "stampDuty", "toRegister"]) expect(q).toContain(`AS A_${k}`);
  expect(q).toMatch(/AS StepIndex/);
  expect(q).toMatch(/AS DaysAtStep/);
  expect(q).toMatch(/OUTER APPLY \(SELECT COUNT\(\*\) AS Required/);
});

test("Needs action narrows the list and its tab counts to that alert, on the server", async () => {
  await request(app).get("/?page=1&pageSize=25&alert=director");
  expect(pageQuery().q).toMatch(/WHERE x\.A_director = 1\) x/);
  expect(mockQueries.find((x) => /GROUP BY x\.DerivedStatus/.test(x.q)).q).toMatch(/WHERE x\.A_director = 1/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&alert=1;DROP");
  expect(mockQueries.some((x) => /DROP|A_1/.test(x.q))).toBe(false);
});

test("insights: steps, alerts, this month, deadlines, money to the paisa and the workload", async () => {
  const res = await request(app).get("/insights?projectId=3");
  expect(res.status).toBe(200);
  expect(res.body.total).toBe(20);
  expect(res.body.avgDaysAtStep).toBe(7);
  expect(res.body.byStep[1]).toBe(2);
  expect(res.body.byStep[6]).toBe(4);
  expect(res.body.alerts.overdue).toBe(3);
  expect(res.body.deadlines).toMatchObject({ overdue: 3, thisWeek: 2, thisMonth: 1, later: 4, notSet: 3 });
  expect(res.body.money).toEqual({ deedValue: 1000000.1, stampDuty: 60000.2, registrationFee: 10000.3, stampDutyCredit: 5000.1, netPayable: 65000.4 });
  expect(res.body.workload[0]).toEqual({ name: null, open: 4, oldestDays: 30 });
  expect(mockQueries.every((x) => x.inputs.projectId === 3)).toBe(true);
});

test("board: each column's count and its first cards, longest waiting first; the limit is capped", async () => {
  const res = await request(app).get("/board?limit=5000");
  expect(res.status).toBe(200);
  expect(mockQueries.find((x) => /PARTITION BY x\.StepIndex ORDER BY x\.DaysAtStep DESC/.test(x.q)).inputs.limit).toBe(200);
  const col6 = res.body.columns.find((c) => c.index === 6);
  expect(col6.count).toBe(40);
  expect(col6.cards.map((c) => c.Id)).toEqual([7]);
  expect(res.body.columns).toHaveLength(9);
});
