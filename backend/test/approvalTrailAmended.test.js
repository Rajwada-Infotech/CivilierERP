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
