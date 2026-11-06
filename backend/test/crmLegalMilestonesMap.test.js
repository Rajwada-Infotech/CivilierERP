process.env.NODE_ENV = "test";

// The Legal Milestones journey map: the step rules worked out on the server, the where-they-are filter, the orders, the paging and the summary.
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
          if (/AS Complete/.test(q)) return { recordset: [{ Total: 120, Complete: 9, AvgProgress: 0.4567, ManualDue: 4, G_agreement: 80, O_agreement: 40, G_noc: 30, O_noc: 12 }] };
          return { recordset: [{ Id: 1, BookingId: 5, D_noc: 1 }] };
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
const router = require("../routes/crmLegalMilestones");
const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });
const pageQuery = () => mockQueries.find((x) => /OFFSET @offset/.test(x.q));

test("a page carries every step's done / locked flags, each phase's state and the progress", async () => {
  const res = await request(app).get("/?page=1&pageSize=25");
  expect(res.status).toBe(200);
  const q = pageQuery().q;
  for (const k of ["DocCollection", "DirectorMeeting", "FinalExecution", "afsQP", "afsReg", "noc", "ocCc", "prePossession", "possessionNotice", "handover", "salesDeed", "queryPayment", "registry", "mutation"]) {
    expect(q).toContain(`AS D_${k}`);
    expect(q).toContain(`AS L_${k}`);
  }
  for (const p of ["agreement", "afsVisit1", "noc", "possession", "saleDeed", "afsVisit2", "mutation"]) expect(q).toContain(`AS P_${p}`);
  expect(q).toMatch(/AS DoneCount, 19 AS StepCount/);
  // nulls never count as a match: every status is read through ISNULL
  expect(q).toMatch(/ISNULL\(x\.HandoverStatus, ''\) = 'Completed'/);
});

test("the summary gives the gates, the tab counts, the average and the director meetings due", async () => {
  const res = await request(app).get("/?page=1&pageSize=25");
  expect(res.body.summary).toMatchObject({ total: 120, complete: 9, manualDue: 4, avgProgress: 46 });
  expect(res.body.summary.gates.agreement).toBe(80);
  expect(res.body.summary.atPhase.noc).toBe(12);
  expect(res.body.total).toBe(120);
});

test("where they are filters on the server; the total is that phase's count", async () => {
  const res = await request(app).get("/?page=1&pageSize=25&focus=noc");
  expect(pageQuery().q).toMatch(/WHERE y\.P_noc = 1 ORDER BY/);
  expect(res.body.total).toBe(12);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&focus=complete");
  expect(pageQuery().q).toMatch(/WHERE y\.DoneCount = y\.StepCount/);
});

test("the orders run on the server; an unknown focus or order falls back, never into the SQL", async () => {
  await request(app).get("/?page=1&pageSize=25&order=most");
  expect(pageQuery().q).toMatch(/ORDER BY CAST\(y\.DoneCount AS FLOAT\) \/ y\.StepCount DESC/);
  mockQueries.length = 0;
  await request(app).get("/?page=1&pageSize=25&focus=1;DROP&order=x;--");
  expect(pageQuery().q).toMatch(/WHERE 1 = 1 ORDER BY CAST\(y\.DoneCount AS FLOAT\) \/ y\.StepCount ASC/);
  expect(mockQueries.some((x) => /DROP|x;--/.test(x.q))).toBe(false);
});

test("one booking's journey carries the same flags", async () => {
  const res = await request(app).get("/booking/5");
  expect(res.status).toBe(200);
  expect(mockQueries[0].q).toMatch(/AS D_mutation/);
  expect(mockQueries[0].q).toMatch(/m\.BookingId = @bid/);
});
