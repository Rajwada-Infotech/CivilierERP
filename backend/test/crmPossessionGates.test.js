process.env.NODE_ENV = "test";

// The possession stages: Pre-Possession following the money, one active notice per booking, and what Handover offers.
const mockQueries = [];
const mockDb = { activeNotice: null, ppStatus: "InProgress", afterRefresh: "Ready" };

jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request() {
      const r = {
        input() { return r; },
        async query(q) {
          mockQueries.push(q);
          if (/UPDATE p SET Status = x\.Live/.test(q)) { mockDb.ppStatus = mockDb.afterRefresh; return { recordset: [], rowsAffected: [1] }; }
          if (/FROM dbo\.CrmPossessionNotice WHERE BookingId = @bid AND Status IN/.test(q)) return { recordset: mockDb.activeNotice ? [mockDb.activeNotice] : [] };
          if (/SELECT TOP 1 Status FROM dbo\.CrmPrePossession/.test(q)) return { recordset: [{ Status: mockDb.ppStatus }] };
          if (/SELECT Status, IsActive/.test(q)) return { recordset: [{ Status: "Approved", IsActive: true, IsFrozen: false }] };
          if (/INSERT INTO dbo\.CrmPossessionNotice/.test(q)) return { recordset: [{ Id: 12 }] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return r;
    },
  }),
}));
jest.mock("../redis", () => new Proxy({}, { get: () => async () => null }));
jest.mock("../socket", () => ({ getIo: () => null }));
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 7, id: 7, role: "admin", email: "a@b.c" }; next(); });
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (_req, _res, next) => next();
  return { requirePageRight: pass, requireAnyPageRight: pass };
});
jest.mock("../services/assertBookingProjectScope", () => ({ assertBookingProjectScope: async () => 16 }));
jest.mock("../services/docNumber", () => ({ getNextDocNumber: async () => "PN-1" }));

const express = require("express");
const request = require("supertest");
const notices = require("../routes/crmPossessionNotice");
const handover = require("../routes/crmHandover");
const { prePossessionStatusSql } = require("../services/crmWorkflowGuards");

const app = express();
app.use(express.json());
app.use("/notice", notices);
app.use("/handover", handover);

beforeEach(() => {
  mockQueries.length = 0;
  Object.assign(mockDb, { activeNotice: null, ppStatus: "InProgress", afterRefresh: "Ready" });
});

describe("creating a possession notice", () => {
  test("dues that cleared after the checklist was last saved no longer leave it stuck", async () => {
    const r = await request(app).post("/notice").send({ BookingId: 5 });
    expect(r.status).toBe(201);
    const order = mockQueries.findIndex((q) => /UPDATE p SET Status = x\.Live/.test(q));
    expect(order).toBeGreaterThan(-1);
    expect(order).toBeLessThan(mockQueries.findIndex((q) => /SELECT TOP 1 Status FROM dbo\.CrmPrePossession/.test(q)));
  });

  test("still refused while the checklist is really not ready", async () => {
    mockDb.afterRefresh = "InProgress";
    expect((await request(app).post("/notice").send({ BookingId: 5 })).status).toBe(400);
  });

  test("a second active notice is refused before a number is used", async () => {
    mockDb.activeNotice = { NoticeNo: "PN-9", Status: "Sent" };
    const r = await request(app).post("/notice").send({ BookingId: 5 });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("PN-9");
    expect(mockQueries.some((q) => /INSERT INTO dbo\.CrmPossessionNotice/.test(q))).toBe(false);
  });
});

describe("handover", () => {
  test("its list only offers bookings it will accept: an unfinished Pre-Possession is left out", async () => {
    await request(app).get("/handover/eligible-bookings");
    const q = mockQueries.find((x) => /AS UnitNo, a\.ApplicantName/.test(x));
    expect(q).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM dbo\.CrmPrePossession pp/);
  });

  test("a made-up snag status can't slip past the open-snags check", async () => {
    const r = await request(app).put("/handover/3/snags/4").send({ Status: "Done" });
    expect(r.status).toBe(400);
  });
});

describe("the Pre-Possession status rule", () => {
  const sql = prePossessionStatusSql({ funded: "F", doc: "D", qc: "Q", util: "U" });
  test("Ready needs the money and all three checks", () => {
    expect(sql).toContain("WHEN F AND D = 1 AND Q = 1 AND U = 1 THEN 'Ready'");
  });
  test("anything done is In Progress, nothing done is Pending", () => {
    expect(sql).toContain("WHEN F OR D = 1 OR Q = 1 OR U = 1 THEN 'InProgress'");
    expect(sql).toContain("ELSE 'Pending'");
  });
});
