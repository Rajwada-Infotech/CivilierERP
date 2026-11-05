process.env.NODE_ENV = "test";

/**
 * Work Reporting: day 1's After photos become day 2's Before (server-side, one INSERT…SELECT),
 * and the activity list names the company behind Labour / Material Source. The pool is faked;
 * the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockQueries = [];
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 3, email: "eng@x.in" }; next(); });
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
  requireAnyPageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../services/activityThread", () => ({ invalidateThread: jest.fn() }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        inputs: {},
        input(name, _t, v) { r.inputs[name] = v; return r; },
        query: async (text) => {
          mockQueries.push({ text, inputs: { ...r.inputs } });
          if (/SELECT @n AS carried/.test(text)) return { recordset: [{ carried: 2 }] };
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return r;
    },
  }),
}));

const app = () => express().use(express.json()).use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
const base = "/api/dependency-activity-assignment";

beforeEach(() => { mockQueries = []; });

describe("POST /:rungId/photos/carry-forward", () => {
  it("reports how many After photos were carried", async () => {
    const res = await request(app()).post(`${base}/55/photos/carry-forward`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ carried: 2 });
  });

  it("copies only EARLIER days' After photos, once, as Before photos dated today", async () => {
    await request(app()).post(`${base}/55/photos/carry-forward`);
    const q = mockQueries.find((x) => /INSERT INTO dbo\.ActivityPhoto/.test(x.text));
    expect(q.text).toMatch(/Phase = 'after'\s+AND COALESCE\(LogDate, CAST\(CapturedAt AS DATE\)\) < @today/);
    expect(q.text).toMatch(/SELECT DependencyMasterActivityId, 'before', FileName, MimeType, FileData, @note, @by, SYSDATETIME\(\), @today/);
    // idempotent: nothing is added once a Before newer than that last After exists
    expect(q.text).toMatch(/IF NOT EXISTS \(SELECT 1 FROM dbo\.ActivityPhoto\s+WHERE DependencyMasterActivityId = @rungId AND Phase = 'before' AND CapturedAt >= @lastAt\)/);
    expect(q.inputs.note).toBe("Carried forward from previous After");
  });

  it("rejects a non-numeric rung id", async () => {
    const res = await request(app()).post(`${base}/abc/photos/carry-forward`);
    expect(res.status).toBe(400);
  });
});

describe("GET / names the company behind Labour / Material Source", () => {
  it("selects the developer company or the contractor's name", async () => {
    await request(app()).get(`${base}/`);
    const q = mockQueries.find((x) => /labourSourceName/.test(x.text));
    expect(q).toBeDefined();
    expect(q.text).toMatch(/CASE daa\.LabourSource WHEN 'CONTRACTOR' THEN lc\.LHeadName WHEN 'DEVELOPER' THEN dev\.name END AS labourSourceName/);
    expect(q.text).toMatch(/CASE daa\.MaterialSource WHEN 'CONTRACTOR' THEN mc\.LHeadName WHEN 'DEVELOPER' THEN dev\.name END AS materialSourceName/);
    expect(q.text).toMatch(/LEFT JOIN dbo\.enterprise\s+dev ON dev\.id = ep\.company_id/);
    expect(q.text).toMatch(/LEFT JOIN dbo\.AccountHeadMaster lc ON lc\.LHeadId = daa\.LabourContractorId/);
  });
});
