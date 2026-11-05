process.env.NODE_ENV = "test";

/**
 * GET /api/approval-workflows/trail — a document edited after approval goes
 * back to Pending, but until someone acts on it the audit log still holds the
 * old cycle's sign-offs. The trail must then show it waiting from level 1, not
 * "Final level · Approved" beside a Pending status. The DB pool is faked.
 */

const express = require("express");
const request = require("supertest");

let mock = {};
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/cache", () => ({ cache: () => (_req, _res, next) => next() }));
jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { id: 1, role: "super_admin" };
  next();
});
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (text) => {
          if (/FROM dbo\.ApprovalWorkflows/.test(text)) return { recordset: [mock.workflow] };
          if (/Level > 0/.test(text)) return { recordset: mock.audit };
          if (/Level = 0/.test(text)) return { recordset: mock.level0 };
          if (/AS Status FROM/.test(text)) return { recordset: [{ Status: mock.status }] };
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));

const router = require("../routes/approvalWorkflows");
const app = express();
app.use("/api/approval-workflows", router);

const workflow = {
  Id: 1,
  Name: "PO approval",
  type: "sequential",
  active: 1,
  LevelsJson: JSON.stringify([{ label: "Level 1" }, { label: "Final level" }]),
};
const submitted = { Level: 0, Role: "user", ApproverEmail: "maker@x.com", ActionStatus: "Pending", Note: null, ActionAt: "2026-09-29T10:00:00Z" };
const approved = (level, at) => ({ Level: level, Role: "admin", ApproverEmail: `l${level}@x.com`, ActionStatus: "Approved", Note: null, ActionAt: at });

const levels = (body) => body.steps.filter((s) => s.level > 0);

beforeEach(() => {
  mock = { workflow, audit: [], level0: [submitted], status: "Pending" };
});

test("Pending again after approval: levels read as waiting again, from level 1", async () => {
  mock.audit = [approved(1, "2026-09-30T10:00:00Z"), approved(2, "2026-10-01T10:00:00Z")];
  mock.status = "Pending";
  const res = await request(app).get("/api/approval-workflows/trail").query({ module: "PurchaseOrders", id: 11 });
  expect(res.status).toBe(200);
  expect(levels(res.body).map((s) => s.status)).toEqual(["Pending", "Pending"]);
  expect(levels(res.body).every((s) => s.approverEmail === null)).toBe(true);
  expect(res.body.fullyApproved).toBe(false);
  expect(res.body.currentLevel).toBe(1);
});

test("Approved record keeps every level approved", async () => {
  mock.audit = [approved(1, "2026-09-30T10:00:00Z"), approved(2, "2026-10-01T10:00:00Z")];
  mock.status = "Approved";
  const res = await request(app).get("/api/approval-workflows/trail").query({ module: "PurchaseOrders", id: 11 });
  expect(levels(res.body).map((s) => s.status)).toEqual(["Approved", "Approved"]);
  expect(res.body.fullyApproved).toBe(true);
});

test("A Pending record part-way through approval is left as it is", async () => {
  mock.audit = [approved(1, "2026-09-30T10:00:00Z")];
  mock.status = "Pending";
  const res = await request(app).get("/api/approval-workflows/trail").query({ module: "PurchaseOrders", id: 11 });
  expect(levels(res.body).map((s) => s.status)).toEqual(["Approved", "Pending"]);
  expect(levels(res.body)[0].approverEmail).toBe("l1@x.com");
  expect(res.body.currentLevel).toBe(2);
});

test("JournalVoucher and CRM modules trail lookups succeed", async () => {
  mock.audit = [approved(1, "2026-09-30T10:00:00Z")];
  mock.status = "Approved";

  // JournalVoucher PascalCase table name
  const resJV = await request(app).get("/api/approval-workflows/trail").query({ module: "JournalVoucher", id: 5 });
  expect(resJV.status).toBe(200);
  expect(resJV.body.fullyApproved).toBe(true);

  // crm-bookings slug alias
  const resCRM = await request(app).get("/api/approval-workflows/trail").query({ module: "crm-bookings", id: 101 });
  expect(resCRM.status).toBe(200);
  expect(resCRM.body.fullyApproved).toBe(true);
});

test("Unknown module table returns 400", async () => {
  const res = await request(app).get("/api/approval-workflows/trail").query({ module: "UnknownModuleXYZ", id: 1 });
  expect(res.status).toBe(400);
  expect(res.body.error).toMatch(/Unknown module table/i);
});
