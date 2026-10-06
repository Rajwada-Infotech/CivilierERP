process.env.NODE_ENV = "test";

/**
 * Work Reporting remarks: a second (third…) remark the same day is another entry, not an edit of the
 * first. With `append: true` the day's logbook row keeps every remark of the day; without it the
 * old overwrite behaviour is unchanged. The pool is faked; the SQL itself runs on the live server.
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
          if (/FROM dbo\.DependencyActivityAssignment WHERE DependencyMasterActivityId = @rungId AND IsCurrent = 1/.test(text)) {
            return { recordset: [{ Id: 9, Status: "IN_PROGRESS", ProgressPercent: 40, Remarks: "first" }] };
          }
          if (/UPDATE dbo\.DependencyActivityAssignment/.test(text)) return { rowsAffected: [1], recordset: [] };
          return { recordset: [], rowsAffected: [1] };
        },
      };
      return r;
    },
  }),
}));

const app = () => express().use(express.json()).use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
const dailyLogMerge = () => mockQueries.find((q) => /MERGE dbo\.DependencyActivityDailyLog/.test(q.text));

beforeEach(() => { mockQueries = []; });

describe("PATCH /:rungId/status — remarks", () => {
  it("append: the day's logbook row keeps the earlier remark and adds the new one", async () => {
    const res = await request(app()).patch("/api/dependency-activity-assignment/55/status").send({ remarks: "second note", append: true });
    expect(res.status).toBe(200);
    const m = dailyLogMerge();
    expect(m.inputs.append).toBe(1);
    expect(m.text).toMatch(/WHEN @append = 1 AND ISNULL\(target\.Remarks, N''\) <> N''\s+THEN RIGHT\(target\.Remarks \+ NCHAR\(10\) \+ @remarks, 1000\)/);
  });

  it("each remark is logged as its own audit entry", async () => {
    await request(app()).patch("/api/dependency-activity-assignment/55/status").send({ remarks: "second note", append: true });
    const log = mockQueries.find((q) => /INSERT INTO dbo\.DependencyActivityProgressLog/.test(q.text));
    expect(log.inputs.remarks).toBe("second note");
  });

  it("without append the old overwrite behaviour is unchanged", async () => {
    await request(app()).patch("/api/dependency-activity-assignment/55/status").send({ remarks: "edited" });
    expect(dailyLogMerge().inputs.append).toBe(0);
  });

  it("an empty remark is never appended", async () => {
    await request(app()).patch("/api/dependency-activity-assignment/55/status").send({ remarks: "   ", append: true });
    expect(dailyLogMerge().inputs.append).toBe(0);
  });
});
