process.env.NODE_ENV = "test";

// A tiny in-memory model of the tables the route reads and writes.
const mockDb = { rungs: [], writes: [], tx: { begun: 0, committed: 0, rolledBack: 0 }, failOn: null };

jest.mock("../db", () => {
  const mssql = require("mssql");
  const makeRequest = () => {
    const inputs = {};
    const req = {
      input: (k, _t, v) => ((inputs[k] = v), req),
      query: async (text) => {
        if (/FROM dbo\.DependencyMasterActivity dma/.test(text)) {
          // The plan query; honours the optional block filter.
          return {
            recordset: mockDb.rungs
              .filter((r) => (inputs.towerId == null ? true : r.towerId === inputs.towerId))
              .map((r) => ({ rungId: r.rungId, assignmentId: r.assignmentId, status: r.status, levelsJson: r.levelsJson, engCount: r.engCount, qcCount: r.qcCount })),
            rowsAffected: [0],
          };
        }
        if (mockDb.failOn && mockDb.failOn.test(text)) throw new Error("boom");
        mockDb.writes.push({ text, inputs: { ...inputs } });
        if (/INSERT INTO dbo\.DependencyActivityAssignment/.test(text)) return { recordset: [{ id: 900 + inputs.rungId }], rowsAffected: [1] };
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return req;
  };
  class FakeTx {
    async begin() { mockDb.tx.begun += 1; }
    async commit() { mockDb.tx.committed += 1; }
    async rollback() { mockDb.tx.rolledBack += 1; }
    request() { return makeRequest(); }
  }
  return { getPool: () => ({ request: makeRequest }), sql: { ...mssql, Transaction: FakeTx } };
});
jest.mock("../middleware/requirePageRight", () => ({ requireAnyPageRight: () => (_req, _res, next) => next() }));
jest.mock("../services/activityThread", () => ({ invalidateThread: jest.fn() }));

const express = require("express");
const request = require("supertest");
const { invalidateThread } = require("../services/activityThread");
const router = require("../routes/dependencyBulkAssign");

let scope = null; // null = unrestricted
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { email: "a@x.com", role: "admin" };
  req.projectScope = scope;
  next();
});
app.use("/api/dependency-bulk-assign", router);

const rung = (over) => ({ rungId: 1, towerId: 10, assignmentId: 100, status: "PENDING", levelsJson: "[]", engCount: 0, qcCount: 0, ...over });
const levels = [{ label: "Site head", userIds: [7], mode: "all" }];
const body = { projectId: 5, engineerIds: [1, 2], qcUserIds: [3], approvalLevels: levels };
const sqlOf = () => mockDb.writes.map((w) => w.text).join("\n");

beforeEach(() => {
  jest.clearAllMocks();
  scope = null;
  mockDb.rungs = [];
  mockDb.writes = [];
  mockDb.failOn = null;
  mockDb.tx = { begun: 0, committed: 0, rolledBack: 0 };
});

describe("validation", () => {
  it("needs a project", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send({ engineerIds: [1] });
    expect(res.status).toBe(400);
  });

  it("needs at least one of engineers / QC / approval", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
    expect(mockDb.writes).toHaveLength(0);
  });

  it("ignores approval levels that name nobody", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5, approvalLevels: [{ label: "x", userIds: [] }] });
    expect(res.status).toBe(400);
  });

  it("refuses a project outside the caller's Project Access", async () => {
    scope = [9];
    mockDb.rungs = [rung()];
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(403);
    expect(mockDb.writes).toHaveLength(0);
    expect(mockDb.tx.begun).toBe(0);
  });
});

describe("preview", () => {
  it("counts what would change and writes nothing", async () => {
    mockDb.rungs = [
      rung({ rungId: 1 }),
      rung({ rungId: 2, assignmentId: null, status: null }), // never allocated
      rung({ rungId: 3, engCount: 2 }), // already has engineers
      rung({ rungId: 4, status: "CANCELLED" }),
      rung({ rungId: 5, status: "APPROVED" }),
    ];
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.summary).toMatchObject({
      totalActivities: 5,
      skippedCancelledOrApproved: 2,
      eligible: 3,
      willChange: 3,
      engineers: { requested: true, willFill: 2, alreadySet: 1 },
      qc: { willFill: 3, alreadySet: 0 },
      approval: { willFill: 3, alreadySet: 0 },
    });
    expect(mockDb.writes).toHaveLength(0);
    expect(mockDb.tx.begun).toBe(0);
  });

  it("an activity that already has everything is left out", async () => {
    mockDb.rungs = [rung({ engCount: 1, qcCount: 1, levelsJson: JSON.stringify(levels) })];
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(res.body.summary.willChange).toBe(0);
    expect(res.body.summary.engineers.alreadySet).toBe(1);
  });

  it("limits to one block when towerId is given", async () => {
    mockDb.rungs = [rung({ rungId: 1, towerId: 10 }), rung({ rungId: 2, towerId: 11 })];
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send({ ...body, towerId: 11 });
    expect(res.body.summary.totalActivities).toBe(1);
  });
});

describe("apply", () => {
  it("fills only what is empty, in one transaction, and touches nothing else", async () => {
    mockDb.rungs = [
      rung({ rungId: 1, assignmentId: 100 }),
      rung({ rungId: 3, assignmentId: 103, engCount: 2, qcCount: 1, levelsJson: JSON.stringify(levels) }), // complete already
      rung({ rungId: 4, assignmentId: 104, status: "CANCELLED" }),
    ];
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(200);
    expect(res.body.changed).toMatchObject({ activities: 1, engineers: 1, qc: 1, approval: 1, created: 0 });
    expect(mockDb.tx).toEqual({ begun: 1, committed: 1, rolledBack: 0 });
    // every write is for rung 1's assignment (100) — never the complete or cancelled ones
    const assignmentIds = mockDb.writes.map((w) => w.inputs.a ?? w.inputs.id).filter((v) => v != null);
    expect(new Set(assignmentIds)).toEqual(new Set([100]));
    expect(invalidateThread).toHaveBeenCalledTimes(1);
    expect(invalidateThread).toHaveBeenCalledWith(1);
  });

  it("each write re-checks emptiness itself (safe against a concurrent edit)", async () => {
    mockDb.rungs = [rung()];
    await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    const all = sqlOf();
    expect(all).toMatch(/INSERT INTO dbo\.DependencyActivityEngineer[\s\S]*WHERE NOT EXISTS \(SELECT 1 FROM dbo\.DependencyActivityEngineer WHERE AssignmentId = @a\)/);
    expect(all).toMatch(/INSERT INTO dbo\.DependencyActivityQcAssignee[\s\S]*WHERE NOT EXISTS/);
    expect(all).toMatch(/ApprovalLevelsJson IS NULL OR LTRIM\(RTRIM\(ApprovalLevelsJson\)\) IN \(''?, '\[\]'\)/);
  });

  it("moves PENDING to ALLOCATED when engineers are added, like a normal save", async () => {
    mockDb.rungs = [rung()];
    await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5, engineerIds: [1] });
    expect(sqlOf()).toMatch(/SET Status = 'ALLOCATED' WHERE Id = @a AND Status = 'PENDING'/);
  });

  it("does not touch status when only QC or approval is applied", async () => {
    mockDb.rungs = [rung()];
    await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5, qcUserIds: [3], approvalLevels: levels });
    expect(sqlOf()).not.toMatch(/ALLOCATED/);
  });

  it("creates the assignment for an activity that never had one", async () => {
    mockDb.rungs = [rung({ rungId: 2, assignmentId: null, status: null })];
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.body.changed).toMatchObject({ activities: 1, created: 1, engineers: 1, qc: 1, approval: 1 });
    const create = mockDb.writes.find((w) => /INSERT INTO dbo\.DependencyActivityAssignment/.test(w.text));
    expect(JSON.parse(create.inputs.levels)).toEqual([expect.objectContaining({ userIds: [7], label: "Site head" })]);
    // engineers were written against the new assignment id
    expect(mockDb.writes.find((w) => /DependencyActivityEngineer/.test(w.text)).inputs.a).toBe(902);
  });

  it("an activity with no assignment gets an empty approval list when approval isn't being applied", async () => {
    mockDb.rungs = [rung({ rungId: 2, assignmentId: null, status: null })];
    await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5, engineerIds: [1] });
    const create = mockDb.writes.find((w) => /INSERT INTO dbo\.DependencyActivityAssignment/.test(w.text));
    expect(create.inputs.levels).toBe("[]");
  });

  it("is idempotent: a second run changes nothing", async () => {
    mockDb.rungs = [rung({ engCount: 2, qcCount: 1, levelsJson: JSON.stringify(levels) })];
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.body.changed.activities).toBe(0);
    expect(mockDb.writes).toHaveLength(0);
    expect(invalidateThread).not.toHaveBeenCalled();
  });

  it("rolls everything back and changes nothing if any write fails", async () => {
    mockDb.rungs = [rung({ rungId: 1 }), rung({ rungId: 2, assignmentId: 101 })];
    mockDb.failOn = /DependencyActivityQcAssignee/;
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/nothing was changed/i);
    expect(mockDb.tx).toEqual({ begun: 1, committed: 0, rolledBack: 1 });
    expect(invalidateThread).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  const { toIntList, normalizeLevels } = router._test;
  it("normalises id lists", () => {
    expect(toIntList([1, "2", "x", 2, null])).toEqual([1, 2]);
    expect(toIntList("nope")).toEqual([]);
  });
  it("normalises levels like the single save does", () => {
    expect(normalizeLevels([{ userIds: ["4", 4, "z"] }, { label: "empty", userIds: [] }, { label: "Last", userIds: [9], mode: "any" }])).toEqual([
      { id: "level-1", label: "Level 1", userIds: [4], mode: "all" },
      { id: "level-3", label: "Last", userIds: [9], mode: "any" },
    ]);
  });
});
