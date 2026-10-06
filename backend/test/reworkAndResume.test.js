process.env.NODE_ENV = "test";

/**
 * 1) Quality Check sends an activity back for rework: the new attempt keeps the passed checkpoints
 *    ticked, un-ticks only the Poor ones, and Work Allocation flags those Poor ones (needsRework).
 * 2) Putting an activity back In Progress after a hold stamps ResumedAt ("Resumed"); going on hold
 *    again clears it; a server without the column (migration 536) is unaffected.
 * The pool is faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockLog = [];
let mockResumedCol = true;
let mockCurrentStatus = "HOLD";

jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 3, email: "qc@x.in", role: "super_admin" }; next(); });
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../services/activityThread", () => ({ invalidateThread: jest.fn() }));

jest.mock("../db", () => {
  const real = require("mssql");
  const run = (text, inputs) => {
    mockLog.push({ text, inputs: { ...inputs } });
    // ── QC decision route lookups ──
    if (/SELECT Id, Status FROM dbo\.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1/.test(text)) {
      return { recordset: [{ Id: 9, Status: "COMPLETED" }] };
    }
    if (/SELECT QcUserId FROM dbo\.DependencyActivityQcAssignee/.test(text)) return { recordset: [] };
    if (/SELECT Id, FieldName FROM dbo\.DependencyActivityCheckpoint WHERE AssignmentId = @aid/.test(text)) {
      return { recordset: [{ Id: 1, FieldName: "ALIGNMENT" }, { Id: 2, FieldName: "LABEL" }] };
    }
    if (/INSERT INTO dbo\.DependencyActivityQc \(/.test(text)) return { recordset: [{ Id: 70 }] };
    if (/SELECT AttemptNo, LabourSource/.test(text)) return { recordset: [{ AttemptNo: 1 }] };
    if (/INSERT INTO dbo\.DependencyActivityAssignment\s+\(DependencyMasterActivityId, Status, AttemptNo/.test(text)) return { recordset: [{ id: 10 }] };
    // ── PATCH status route ──
    if (/SELECT Id, Status, ProgressPercent FROM dbo\.DependencyActivityAssignment/.test(text)) {
      return { recordset: [{ Id: 9, Status: mockCurrentStatus, ProgressPercent: 40 }] };
    }
    if (/UPDATE dbo\.DependencyActivityAssignment\s+SET/.test(text)) return { rowsAffected: [1], recordset: [] };
    if (/COL_LENGTH/.test(text)) return { recordset: [{ len: mockResumedCol ? 8 : null }] };
    // ── GET /:rungId ──
    if (/FROM dbo\.DependencyMasterActivity dma WHERE dma\.Id = @rungId/.test(text)) return { recordset: [{ Id: 55, ActivityId: 12 }] };
    if (/Id AS assignmentId, StartDate AS startDate/.test(text)) {
      return { recordset: [{ assignmentId: 10, labourSource: null, materialSource: null, reworkFromAssignmentId: 9 }] };
    }
    if (/SELECT TOP 1 1 AS found FROM dbo\.DependencyActivityCheckpoint/.test(text)) return { recordset: [{ found: 1 }] };
    if (/FROM dbo\.DependencyActivityCheckpoint c WHERE c\.AssignmentId = @assignmentId/.test(text)) {
      return {
        recordset: [
          { id: 21, checkpointId: 1, fieldName: "ALIGNMENT", sortOrder: 0, isChecked: 1, isDaily: 0, updateCount: 0 },
          { id: 22, checkpointId: 2, fieldName: "LABEL", sortOrder: 1, isChecked: 0, isDaily: 0, updateCount: 0 },
          { id: 23, checkpointId: 3, fieldName: "JOINT", sortOrder: 2, isChecked: 0, isDaily: 0, updateCount: 0 },
        ],
      };
    }
    if (/WHERE ck\.Rating = 'POOR'/.test(text)) return { recordset: [{ fieldName: "LABEL" }] };
    return { recordset: [], rowsAffected: [0] };
  };
  const makeReq = () => {
    const r = {
      inputs: {},
      input(n, _t, v) { r.inputs[n] = v; return r; },
      query: async (text) => run(text, r.inputs),
    };
    return r;
  };
  class Request { constructor() { return makeReq(); } }
  class Transaction { async begin() {} async commit() {} async rollback() {} request() { return makeReq(); } }
  return { sql: { ...real, Request, Transaction }, getPool: () => ({ request: makeReq, transaction: () => new Transaction() }) };
});

const app = () => express().use(express.json()).use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
const base = "/api/dependency-activity-assignment";

// A fresh route module each test — the "does ResumedAt exist" answer is cached per module.
beforeEach(() => { jest.resetModules(); mockLog = []; mockResumedCol = true; mockCurrentStatus = "HOLD"; });

describe("Quality Check sends back for rework", () => {
  const send = () =>
    request(app()).post(`${base}/qc/55/decision`).send({
      decision: "REWORK",
      remarks: "redo the label",
      checks: [{ checkpointId: 1, rating: "EXCELLENT" }, { checkpointId: 2, rating: "POOR", note: "faded" }],
    });

  it("un-ticks only the Poor checkpoint on the old attempt", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    const unticked = mockLog.filter((q) => /UPDATE dbo\.DependencyActivityCheckpoint SET IsChecked = 0 WHERE Id = @cpId/.test(q.text));
    expect(unticked.map((q) => q.inputs.cpId)).toEqual([2]);
  });

  it("copies the checkpoints to the new attempt, ticked if ticked or QC-passed", async () => {
    await send();
    const copy = mockLog.find((q) => /INSERT INTO dbo\.DependencyActivityCheckpoint\s+\(AssignmentId, CheckpointId, FieldName/.test(q.text));
    expect(copy).toBeDefined();
    expect(copy.inputs).toMatchObject({ old: 9, new: 10 });
    expect(copy.text).toMatch(/CASE WHEN c\.IsChecked = 1 OR EXISTS \(/);
    expect(copy.text).toMatch(/ck\.Passed = 1/);
  });
});

describe("GET /:rungId flags the checkpoints to redo", () => {
  it("only the Poor one that isn't ticked again blinks; ticked and never-rated ones don't", async () => {
    const res = await request(app()).get(`${base}/55`);
    expect(res.status).toBe(200);
    const flags = Object.fromEntries(res.body.assignment.checkpoints.map((c) => [c.fieldName, c.needsRework]));
    expect(flags).toEqual({ ALIGNMENT: false, LABEL: true, JOINT: false });
    expect(res.body.assignment.checkpoints.find((c) => c.fieldName === "ALIGNMENT").isChecked).toBe(true);
  });
});

describe("Resumed after a hold", () => {
  const patch = (status) => request(app()).patch(`${base}/55/status`).send({ status });
  const updateSql = () => mockLog.find((q) => /UPDATE dbo\.DependencyActivityAssignment\s+SET/.test(q.text))?.text ?? "";

  it("HOLD → IN_PROGRESS stamps ResumedAt", async () => {
    mockCurrentStatus = "HOLD";
    expect((await patch("IN_PROGRESS")).status).toBe(200);
    expect(updateSql()).toMatch(/ResumedAt = SYSDATETIME\(\)/);
  });

  it("going on hold clears it", async () => {
    mockCurrentStatus = "IN_PROGRESS";
    await patch("HOLD");
    expect(updateSql()).toMatch(/ResumedAt = NULL/);
  });

  it("a plain start (not from a hold) is not 'resumed'", async () => {
    mockCurrentStatus = "ALLOCATED";
    await patch("IN_PROGRESS");
    expect(updateSql()).not.toMatch(/ResumedAt/);
  });

  it("works on a server that hasn't run migration 536", async () => {
    mockResumedCol = false;
    mockCurrentStatus = "HOLD";
    const res = await patch("IN_PROGRESS");
    expect(res.status).toBe(200);
    expect(updateSql()).not.toMatch(/ResumedAt/);
  });
});
