process.env.NODE_ENV = "test";

// Demands: figures limited to the user's projects and overdue by the one on-account rule. Receipts: the status shown.
const mockQueries = [];

jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request() {
      const r = {
        input() { return r; },
        async query(q) {
          mockQueries.push(q);
          if (/AS OverdueShort/.test(q) && !/OFFSET @offset/.test(q)) {
            return { recordset: [
              { AmountDue: 100, AmountPaid: 0, DemandStatus: "Demanded", IsOverdue: 1, OverdueShort: 30 },
              { AmountDue: 200, AmountPaid: 0, DemandStatus: "Pending", IsOverdue: 0, OverdueShort: 0 },
            ] };
          }
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));
jest.mock("../socket", () => ({ getIo: () => null }));
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 7, id: 7, role: "sales", email: "a@b.c" }; next(); });
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (req, _res, next) => { req.projectScope = [16]; next(); };
  return { requirePageRight: pass, requireAnyPageRight: pass };
});

const express = require("express");
const request = require("supertest");
const router = require("../routes/crmPayments");
const { deriveStatus } = require("../services/moneyReceiptPdf");

const app = express();
app.use("/", router);

beforeEach(() => { mockQueries.length = 0; });

describe("the Demands page", () => {
  const load = () => request(app).get("/demands?page=1&pageSize=25");
  const summaryQuery = () => mockQueries.find((q) => /AS OverdueShort/.test(q) && !/OFFSET @offset/.test(q));

  test("the counts and amounts stay inside the user's projects, like the list", async () => {
    await load();
    expect(mockQueries.find((q) => /OFFSET @offset/.test(q))).toContain("b.ProjectId IN (16)");
    expect(summaryQuery()).toContain("b.ProjectId IN (16)");
  });

  test("overdue counts only the money still missing, not the milestone's whole amount", async () => {
    const r = await load();
    expect(r.body.summary).toMatchObject({ overdueCount: 1, overdueAmount: 30, demandedAmount: 100, pendingAmount: 200 });
    expect(r.body.total).toBe(2);
  });

  test("money held on account is part of the overdue test", async () => {
    await load();
    expect(summaryQuery()).toMatch(/CROSS APPLY \(SELECT[\s\S]*AS Upto[\s\S]*AS MoneyIn\) cov/);
    expect(summaryQuery()).toContain("cov.Upto > cov.MoneyIn + 0.009");
  });
});

describe("the status a money receipt shows", () => {
  test.each([
    ["Pending", null, "Pending"],
    ["Pending", "Pending", "Pending"],
    ["Pending", "Approved", "Approved"],
    ["Pending", "Rejected", "Bounced"],
    ["Approved", "Approved", "Approved"],
    ["Approved", null, "Approved"],
    ["Approved", "Rejected", "Bounced"], // Finance rejected it: that money never came in
    ["Bounced", "Approved", "Bounced"], // Finance approved it, then the cheque failed
  ])("receipt %s, Finance %s: %s", (mr, rp, shown) => {
    expect(deriveStatus(mr, rp)).toBe(shown);
  });
});
