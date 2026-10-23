process.env.NODE_ENV = "test";

/**
 * POST /api/dependency-activity-assignment/:rungId/restore — a Cancelled activity that was never
 * approved starts over: the cancelled attempt is frozen as history (source RESTORE) and a fresh one
 * is forked at Allocated with the bar at 0 (nothing ticked, same people, same dates). One that was
 * Approved before the cancel goes straight back to Approved. The DB is faked; each test reads
 * back the SQL it ran.
 */

const express = require("express");
const request = require("supertest");

const mockState = { cur: null, newStatus: "ALLOCATED", queries: [], committed: false, rolledBack: false };
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { id: 1, email: "sa@x.com", role: req.headers["x-role"] || "super_admin" };
  next();
});
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));
jest.mock("../db", () => {
  const real = require("mssql");
  const run = async (text) => {
    mockState.queries.push(text);
    if (/SELECT Id, Status, PreCancelStatus/.test(text)) return { recordset: mockState.cur ? [mockState.cur] : [] };
    if (/SELECT AttemptNo/.test(text)) return { recordset: [{ AttemptNo: 1, ApprovalLevelsJson: "[]" }] };
    if (/OUTPUT INSERTED\.Id/.test(text)) return { recordset: [{ id: 99 }] };
    if (/SELECT Status FROM dbo\.DependencyActivityAssignment WHERE Id = @id/.test(text)) return { recordset: [{ Status: mockState.newStatus }] };
    return { recordset: [], rowsAffected: [1] };
  };
  class Request {
    input() { return this; }
    query(text) { return run(text); }
  }
  class Transaction {
    async begin() {}
    async commit() { mockState.committed = true; }
    async rollback() { mockState.rolledBack = true; }
  }
  const sql = Object.assign(Object.create(real), { Request, Transaction });
  const pool = { request: () => new Request() };
  return { sql, getPool: () => pool };
});

const router = require("../routes/dependencyActivityAssignment");
const app = express();
app.use(express.json());
app.use("/api/dependency-activity-assignment", router);

const restore = (role) => {
  const r = request(app).post("/api/dependency-activity-assignment/7/restore");
  return role ? r.set("x-role", role) : r;
};

beforeEach(() => {
  Object.assign(mockState, { cur: null, newStatus: "ALLOCATED", queries: [], committed: false, rolledBack: false });
});

test("never approved: forks a fresh attempt at Allocated, the cancelled one kept as RESTORE history", async () => {
  mockState.cur = { Id: 5, Status: "CANCELLED", PreCancelStatus: "IN_PROGRESS" };
  const res = await restore();
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, status: "ALLOCATED", assignmentId: 99 });
  expect(mockState.committed).toBe(true);

  const sqlText = mockState.queries.join("\n");
  expect(sqlText).toMatch(/SET IsCurrent = 0, ReworkReason = @reason, ReworkSource = @source/);
  // The new attempt starts with no progress: the insert names no ProgressPercent / FirstReportedAt.
  const insert = mockState.queries.find((q) => /OUTPUT INSERTED\.Id/.test(q));
  expect(insert).not.toMatch(/ProgressPercent|FirstReportedAt/);
  // Checklist copied with nothing ticked; dates kept; Allocated when someone is on it.
  expect(sqlText).toMatch(/c\.IsDaily, 0\s+FROM dbo\.DependencyActivityCheckpoint/);
  expect(sqlText).toMatch(/StartDate = o\.StartDate, EndDate = o\.EndDate/);
  expect(sqlText).toMatch(/THEN 'ALLOCATED' ELSE 'PENDING' END/);
});

test("nobody on it: comes back Pending", async () => {
  mockState.cur = { Id: 5, Status: "CANCELLED", PreCancelStatus: "COMPLETED" };
  mockState.newStatus = "PENDING";
  const res = await restore();
  expect(res.body.status).toBe("PENDING");
});

test("approved before the cancel: back to Approved in place, no new attempt", async () => {
  mockState.cur = { Id: 5, Status: "CANCELLED", PreCancelStatus: "APPROVED" };
  const res = await restore();
  expect(res.body).toEqual({ success: true, status: "APPROVED" });
  expect(mockState.queries.some((q) => /OUTPUT INSERTED\.Id/.test(q))).toBe(false);
});

test("only a Cancelled activity, and only a super admin", async () => {
  mockState.cur = { Id: 5, Status: "IN_PROGRESS", PreCancelStatus: null };
  expect((await restore()).status).toBe(400);
  mockState.cur = { Id: 5, Status: "CANCELLED", PreCancelStatus: null };
  expect((await restore("admin")).status).toBe(403);
});
