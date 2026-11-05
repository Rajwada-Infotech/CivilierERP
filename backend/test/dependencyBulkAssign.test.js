process.env.NODE_ENV = "test";

// A small stand-in for the database: it answers the kinds of query the route makes
// and records every statement run inside the transaction.
const mockDb = {
  knownUsers: new Set([1, 2, 3, 7]),
  preview: null, // the aggregate row
  inScope: 0, // what the cheap size check returns
  previewCalls: [],
  txQueries: [],
  tx: { begun: 0, committed: 0, rolledBack: 0 },
  applyResult: null,
  failApply: false,
};

jest.mock("../db", () => {
  const mssql = require("mssql");
  const makeRequest = (record) => {
    const inputs = {};
    const req = {
      input: (k, _t, v) => ((inputs[k] = v), req),
      query: async (text) => {
        if (record) {
          mockDb.txQueries.push({ text, inputs: { ...inputs } });
          if (mockDb.failApply) throw new Error("boom");
          return { recordset: mockDb.applyResult[0], recordsets: mockDb.applyResult };
        }
        if (/FROM dbo\.users WHERE id IN/.test(text)) {
          const ids = text.match(/IN \(([\d,]+)\)/)[1].split(",").map(Number);
          return { recordset: ids.filter((i) => mockDb.knownUsers.has(i)).map((id) => ({ id })) };
        }
        if (/COUNT\(\*\) AS n/.test(text)) return { recordset: [{ n: mockDb.inScope }] };
        mockDb.previewCalls.push({ text, inputs: { ...inputs } });
        return { recordset: [mockDb.preview] };
      },
    };
    return req;
  };
  class FakeTx {
    async begin() { mockDb.tx.begun += 1; }
    async commit() { mockDb.tx.committed += 1; }
    async rollback() { mockDb.tx.rolledBack += 1; }
    request() { return makeRequest(true); }
  }
  return { getPool: () => ({ request: () => makeRequest(false) }), sql: { ...mssql, Transaction: FakeTx } };
});
jest.mock("../middleware/requirePageRight", () => ({ requireAnyPageRight: () => (_req, _res, next) => next() }));
jest.mock("../services/activityThread", () => ({ invalidateAllThreads: jest.fn() }));

const express = require("express");
const request = require("supertest");
const { invalidateAllThreads } = require("../services/activityThread");
const router = require("../routes/dependencyBulkAssign");
const { buildApplyBatch, buildPreviewSql, MAX_ACTIVITIES } = router._test;

let scope = null; // null = unrestricted
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { email: "a@x.com", role: "admin" };
  req.projectScope = scope;
  next();
});
app.use("/api/dependency-bulk-assign", router);

const levels = [{ label: "Site head", userIds: [7], mode: "all" }];
const body = { projectId: 5, engineerIds: [1, 2], qcUserIds: [3], approvalLevels: levels };

const aggregate = (over = {}) => ({
  total: 12, skipped: 2, eligible: 10, willChange: 7,
  engFill: 7, engSet: 3, qcFill: 7, qcSet: 3, apprFill: 7, apprSet: 3, ...over,
});
const counts = (over = {}) => ({ created: 1, approval: 7, engineers: 7, qc: 7, activities: 7, ...over });
const setApply = (c = counts()) => {
  mockDb.applyResult = [[c]];
};

beforeEach(() => {
  jest.clearAllMocks();
  scope = null;
  Object.assign(mockDb, { knownUsers: new Set([1, 2, 3, 7]), preview: aggregate(), inScope: 12, previewCalls: [], txQueries: [], failApply: false });
  mockDb.tx = { begun: 0, committed: 0, rolledBack: 0 };
  setApply();
});

describe("validation", () => {
  it("needs a project", async () => {
    expect((await request(app).post("/api/dependency-bulk-assign/preview").send({ engineerIds: [1] })).status).toBe(400);
  });

  it("needs at least one of engineers / QC / approval", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
    expect(mockDb.tx.begun).toBe(0);
  });

  it("ignores approval levels that name nobody", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send({ projectId: 5, approvalLevels: [{ label: "x", userIds: [] }] });
    expect(res.status).toBe(400);
  });

  it("refuses a project outside the caller's Project Access", async () => {
    scope = [9];
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(403);
    expect(mockDb.previewCalls).toHaveLength(0);
    expect(mockDb.tx.begun).toBe(0);
  });

  it("refuses user ids that don't exist, before touching anything", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send({ ...body, engineerIds: [1, 999] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown user id/);
    expect(res.body.error).toMatch(/999/);
    expect(mockDb.tx.begun).toBe(0);
  });
});

describe("preview", () => {
  it("returns the counts from ONE aggregate query and writes nothing", async () => {
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.summary).toEqual({
      totalActivities: 12,
      skippedCancelledOrApproved: 2,
      eligible: 10,
      willChange: 7,
      overwrite: false,
      engineers: { requested: true, willFill: 7, alreadySet: 3, willReplace: 0 },
      qc: { requested: true, willFill: 7, alreadySet: 3, willReplace: 0 },
      approval: { requested: true, willFill: 7, alreadySet: 3, willReplace: 0 },
    });
    expect(mockDb.previewCalls).toHaveLength(1);
    expect(mockDb.tx.begun).toBe(0);
  });

  it("only counts the fields that were asked for", async () => {
    mockDb.preview = aggregate({ qcFill: 0, qcSet: 0, apprFill: 0, apprSet: 0 });
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send({ projectId: 5, engineerIds: [1] });
    expect(res.body.summary.engineers.requested).toBe(true);
    expect(res.body.summary.qc.requested).toBe(false);
    expect(res.body.summary.approval.requested).toBe(false);
    expect(mockDb.previewCalls[0].text).toMatch(/1 = 1 AND f\.NoEng = 1/);
    expect(mockDb.previewCalls[0].text).toMatch(/0 = 1 AND f\.NoQc = 1/);
  });

  it("treats the empty aggregate of an empty project as zeros", async () => {
    mockDb.preview = { total: 0, skipped: null, eligible: null, willChange: null, engFill: null, engSet: null, qcFill: null, qcSet: null, apprFill: null, apprSet: null };
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(res.body.summary.eligible).toBe(0);
    expect(res.body.summary.willChange).toBe(0);
  });

  it("scopes to the project, and to one block when given", async () => {
    await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(mockDb.previewCalls[0].inputs).toEqual({ projectId: 5 });
    expect(mockDb.previewCalls[0].text).not.toMatch(/dm\.TowerId/);
    await request(app).post("/api/dependency-bulk-assign/preview").send({ ...body, towerId: 11 });
    expect(mockDb.previewCalls[1].inputs).toEqual({ projectId: 5, towerId: 11 });
    expect(mockDb.previewCalls[1].text).toMatch(/dm\.TowerId = @towerId/);
  });
});

describe("apply", () => {
  it("runs ONE batch in ONE transaction, however many activities there are", async () => {
    for (const inScope of [10, 5000, 120000]) {
      mockDb.txQueries = [];
      mockDb.tx = { begun: 0, committed: 0, rolledBack: 0 };
      mockDb.inScope = inScope;
      const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
      expect(res.status).toBe(200);
      expect(mockDb.txQueries).toHaveLength(1); // the first version ran several statements per activity
      expect(mockDb.tx).toEqual({ begun: 1, committed: 1, rolledBack: 0 });
    }
  });

  it("skips the expensive per-field count: apply only does the cheap size check", async () => {
    await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(mockDb.previewCalls).toHaveLength(0); // the aggregate is for preview only
  });

  it("reports what the batch did and refreshes the thread cache once", async () => {
    setApply(counts({ created: 2, approval: 9, engineers: 8, qc: 7, activities: 4 }));
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.body).toEqual({ applied: true, changed: { activities: 4, engineers: 8, qc: 7, approval: 9, created: 2 } });
    expect(invalidateAllThreads).toHaveBeenCalledTimes(1);
  });

  it("binds the actor and the approval levels as parameters, not into the SQL text", async () => {
    await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    const q = mockDb.txQueries[0];
    expect(q.inputs.by).toBe("a@x.com");
    expect(JSON.parse(q.inputs.levels)).toEqual([expect.objectContaining({ label: "Site head", userIds: [7], mode: "all" })]);
    expect(q.text).not.toMatch(/Site head/);
    expect(q.text).not.toMatch(/a@x\.com/);
  });

  it("a run where everything is already set changes nothing and does not touch threads", async () => {
    setApply(counts({ created: 0, approval: 0, engineers: 0, qc: 0, activities: 0 }));
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(200);
    expect(res.body.changed.activities).toBe(0);
    expect(invalidateAllThreads).not.toHaveBeenCalled();
  });

  it("rolls back and changes nothing if the batch fails", async () => {
    mockDb.failApply = true;
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/nothing was changed/i);
    expect(mockDb.tx).toEqual({ begun: 1, committed: 0, rolledBack: 1 });
    expect(invalidateAllThreads).not.toHaveBeenCalled();
  });
});

describe("overwrite mode", () => {
  const ow = { projectId: 5, towerId: null, engineerIds: [1, 2], qcUserIds: [3], approvalLevels: levels, overwrite: true };

  it("only an explicit true turns it on", () => {
    expect(router._test.parseRequest({ projectId: 5, engineerIds: [1], overwrite: "true" }).overwrite).toBe(false);
    expect(router._test.parseRequest({ projectId: 5, engineerIds: [1], overwrite: true }).overwrite).toBe(true);
    expect(router._test.parseRequest({ projectId: 5, engineerIds: [1] }).overwrite).toBe(false);
  });

  it("replaces engineers and QC (delete then insert) and the approval levels, for chosen fields only", () => {
    const sqlText = buildApplyBatch(ow);
    expect(sqlText).toMatch(/DELETE e FROM dbo\.DependencyActivityEngineer e\s+JOIN #t t[\s\S]*WHERE t\.NeedEng = 1 AND t\.IsNew = 0/);
    expect(sqlText).toMatch(/DELETE q FROM dbo\.DependencyActivityQcAssignee q\s+JOIN #t t[\s\S]*WHERE t\.NeedQc = 1 AND t\.IsNew = 0/);
    expect(sqlText).toContain("CASE WHEN t.NeedAppr = 1 THEN @levels ELSE d.ApprovalLevelsJson END");
    const qcOnly = buildApplyBatch({ ...ow, engineerIds: [], approvalLevels: [] });
    expect(qcOnly).not.toContain("DELETE e FROM");
    expect(qcOnly).toContain("DELETE q FROM");
  });

  it("default mode never deletes", () => {
    expect(buildApplyBatch({ ...ow, overwrite: false })).not.toMatch(/DELETE /);
  });

  it("still skips cancelled / approved activities", () => {
    expect(buildApplyBatch(ow)).toContain("NOT IN ('CANCELLED', 'APPROVED')");
  });

  it("preview counts every eligible activity as changing", () => {
    const sqlText = buildPreviewSql(ow);
    expect(sqlText).toMatch(/\(1 = 1 AND 1 = 1\)/);
  });
});

describe("the SQL itself", () => {
  const full = { projectId: 5, towerId: null, engineerIds: [1, 2], qcUserIds: [3], approvalLevels: levels };
  const NO_LEVELS = "LTRIM(RTRIM(ISNULL(d.ApprovalLevelsJson, ''))) IN ('', '[]')";

  it("every write is guarded so it only fills what is empty", () => {
    const sqlText = buildApplyBatch(full);
    expect(sqlText).toMatch(/INSERT INTO dbo\.DependencyActivityEngineer[\s\S]*WHERE t\.NeedEng = 1\s+AND NOT EXISTS \(SELECT 1 FROM dbo\.DependencyActivityEngineer e WHERE e\.AssignmentId = t\.AssignmentId\)/);
    expect(sqlText).toMatch(/INSERT INTO dbo\.DependencyActivityQcAssignee[\s\S]*WHERE t\.NeedQc = 1\s+AND NOT EXISTS \(SELECT 1 FROM dbo\.DependencyActivityQcAssignee q WHERE q\.AssignmentId = t\.AssignmentId\)/);
    expect(sqlText).toContain(`CASE WHEN t.NeedAppr = 1 AND ${NO_LEVELS} THEN @levels ELSE d.ApprovalLevelsJson END`);
    expect(sqlText).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM dbo\.DependencyActivityAssignment x/); // only creates a missing assignment
  });

  it("never touches cancelled or approved activities, or non-current attempts", () => {
    const sqlText = buildApplyBatch(full);
    expect(sqlText.match(/d\.IsCurrent = 1 AND ISNULL\(d\.Status, ''\) NOT IN \('CANCELLED', 'APPROVED'\)/g)).toHaveLength(1);
    // and every later write goes through #t, which only holds those live rows
    expect(sqlText).toMatch(/FROM #t t/);
  });

  it("is one pass per concern: approval and the status move share ONE update", () => {
    const sqlText = buildApplyBatch(full);
    expect(sqlText.match(/UPDATE d SET/g)).toHaveLength(1);
    expect(sqlText).toMatch(/d\.Status = CASE WHEN t\.NeedEng = 1 AND d\.Status = 'PENDING' THEN 'ALLOCATED' ELSE d\.Status END/);
  });

  it("no per-row tracking tables and no id list sent back to Node", () => {
    const sqlText = buildApplyBatch(full);
    expect(sqlText).not.toMatch(/#touched/);
    expect(sqlText).not.toMatch(/SELECT DISTINCT d\.DependencyMasterActivityId/);
    expect(sqlText.match(/OUTPUT INSERTED/g)).toHaveLength(1); // only the assignment creation feeds #t
  });

  it("includes only the parts that were asked for", () => {
    const engOnly = buildApplyBatch({ ...full, qcUserIds: [], approvalLevels: [] });
    expect(engOnly).toMatch(/INSERT INTO dbo\.DependencyActivityEngineer/);
    expect(engOnly).not.toMatch(/INSERT INTO dbo\.DependencyActivityQcAssignee/);
    expect(engOnly).not.toMatch(/ApprovalLevelsJson = CASE/);
    expect(engOnly).toMatch(/'\[\]'/); // a brand-new assignment starts with an empty approval list

    const qcOnly = buildApplyBatch({ ...full, engineerIds: [], approvalLevels: [] });
    expect(qcOnly).not.toMatch(/INSERT INTO dbo\.DependencyActivityEngineer/);
    expect(qcOnly).not.toMatch(/ALLOCATED/); // status only moves when engineers are added
    expect(qcOnly).not.toMatch(/UPDATE d SET/);

    const apprOnly = buildApplyBatch({ ...full, engineerIds: [], qcUserIds: [] });
    expect(apprOnly).not.toMatch(/INSERT INTO dbo\.DependencyActivityEngineer/);
    expect(apprOnly).not.toMatch(/INSERT INTO dbo\.DependencyActivityQcAssignee/);
    expect(apprOnly).toMatch(/ApprovalLevelsJson = CASE/);
  });

  it("new assignments start ALLOCATED only when engineers are being added", () => {
    expect(buildApplyBatch(full)).toMatch(/\(DependencyMasterActivityId, ApprovalLevelsJson, CreatedBy, Status\)/);
    expect(buildApplyBatch(full)).toMatch(/@by, 'ALLOCATED'/);
    const noEng = buildApplyBatch({ ...full, engineerIds: [] });
    expect(noEng).toMatch(/\(DependencyMasterActivityId, ApprovalLevelsJson, CreatedBy\)/);
    expect(noEng).not.toMatch(/'ALLOCATED'/);
  });

  it("inlines only validated integers in the VALUES lists, and divides rows by the number of people", () => {
    const sqlText = buildApplyBatch({ ...full, engineerIds: [1, 2], qcUserIds: [3] });
    expect(sqlText).toMatch(/VALUES \(1\),\(2\)\) v\(id\)/);
    expect(sqlText).toMatch(/VALUES \(3\)\) v\(id\)/);
    expect(sqlText).toContain("SET @eng = @@ROWCOUNT / 2;");
    expect(sqlText).toContain("SET @qc = @@ROWCOUNT / 1;");
  });

  it("preview and apply agree on what 'empty approval' means", () => {
    expect(buildPreviewSql(full)).toContain(NO_LEVELS);
    expect(buildApplyBatch(full)).toContain(NO_LEVELS);
  });

  it("returns one row of counts", () => {
    const sqlText = buildApplyBatch(full);
    expect(sqlText).toMatch(/@created\s+AS created/);
    expect(sqlText).toMatch(/AS engineers/);
    expect(sqlText).toMatch(/AS qc/);
    expect(sqlText).toMatch(/AS activities/);
  });
});

describe("size limit", () => {
  it("is 150000", () => {
    expect(MAX_ACTIVITIES).toBe(150000);
  });

  it("preview allows exactly 150000 activities", async () => {
    mockDb.preview = aggregate({ eligible: 150000, willChange: 100 });
    const res = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(res.status).toBe(200);
    expect(res.body.summary.eligible).toBe(150000);
  });

  it("apply allows exactly 150000 in scope", async () => {
    mockDb.inScope = 150000;
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(200);
  });

  it("refuses more than 150000, telling the user to pick a block, and writes nothing", async () => {
    mockDb.inScope = 150001;
    const res = await request(app).post("/api/dependency-bulk-assign/apply").send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/150001 activities/);
    expect(res.body.error).toMatch(/under 150000/);
    expect(mockDb.tx.begun).toBe(0);

    mockDb.preview = aggregate({ eligible: 150001 });
    const prev = await request(app).post("/api/dependency-bulk-assign/preview").send(body);
    expect(prev.status).toBe(400);
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
