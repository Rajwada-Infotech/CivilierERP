process.env.NODE_ENV = "test";

/**
 * The Civil Work DPR dashboard's live picture (used by the mobile app): counts only each activity's CURRENT
 * attempt, and "overdue" ignores junk end dates. The pool is faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockQueries = [];
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => ({
      query: async (text) => {
        mockQueries.push(text);
        if (/GROUP BY Status/.test(text) && /IsCurrent = 1/.test(text)) return { recordset: [{ Status: "IN_PROGRESS", Cnt: 6 }, { Status: "COMPLETED", Cnt: 3 }, { Status: "APPROVED", Cnt: 1 }, { Status: "CANCELLED", Cnt: 10 }] };
        if (/AS Overdue,/.test(text) && /AS DoneLastWeek/.test(text)) return { recordset: [{ Overdue: 4, DueSoon: 2, AvgProgress: 41.6, DoneThisWeek: 5, DoneLastWeek: 3 }] };
        if (/AS AwaitingQc/.test(text)) return { recordset: [{ Completed: 3, AwaitingQc: 2 }] };
        if (/SELECT TOP 6/.test(text)) return { recordset: [{ ProjectName: "Alpha", Total: 9, Done: 3, InProgress: 4, Overdue: 1, AvgProgress: 55.4 }, { ProjectName: null, Total: 2, Done: 0, InProgress: 0, Overdue: 0, AvgProgress: 0 }] };
        if (/DaysOverdue/.test(text)) return { recordset: [{ RungId: 7, ActivityName: "Plastering", ProjectName: "Alpha", ScopePath: "B1 > Floor 1", Status: "IN_PROGRESS", EndDate: "2026-10-01", DaysOverdue: 5, ProgressPercent: 30, EngineerNames: "Asha" }] };
        if (/SELECT TOP 5\s+u\.name AS Name/.test(text)) return { recordset: [{ Name: "Asha", Active: 4, Overdue: 2 }] };
        if (/COUNT\(\*\)\s+AS TotalCount/.test(text) && /ActivityMaster/.test(text)) return { recordset: [{ TotalCount: 10, ActiveCount: 9 }] };
        if (/ContractorAllocation/.test(text) && /ProjectCount/.test(text)) return { recordset: [{ TotalCount: 1, ProjectCount: 1, WorkerCount: 1, TodayCount: 0, NewCount: 0 }] };
        if (/SkilledToday/.test(text)) return { recordset: [{ SkilledToday: 5, UnskilledToday: 8, CrewsToday: 2 }] };
        return { recordset: [] };
      },
    }),
  }),
}));

const app = () => express().use("/api/civilworkdpr-dashboard", require("../routes/civilworkdprDashboard"));
beforeEach(() => { mockQueries = []; });

describe("GET /api/civilworkdpr-dashboard — live picture", () => {
  it("summarises the current attempts", async () => {
    const res = await request(app()).get("/api/civilworkdpr-dashboard");
    expect(res.status).toBe(200);
    expect(res.body.current).toEqual({
      total: 20,
      byStatus: { IN_PROGRESS: 6, COMPLETED: 3, APPROVED: 1, CANCELLED: 10 },
      active: 6,
      completionRate: 40, // (3 + 1) of the 10 that aren't cancelled
    });
    expect(res.body.insights).toEqual({
      overdue: 4, dueSoon: 2, avgProgress: 42, doneThisWeek: 5, doneLastWeek: 3, awaitingQc: 2, awaitingApproval: 1,
    });
  });

  it("returns per-project, most-overdue and per-engineer breakdowns", async () => {
    const res = await request(app()).get("/api/civilworkdpr-dashboard");
    expect(res.body.projects).toEqual([
      { name: "Alpha", total: 9, done: 3, inProgress: 4, overdue: 1, avgProgress: 55 },
      { name: "Unassigned", total: 2, done: 0, inProgress: 0, overdue: 0, avgProgress: 0 },
    ]);
    expect(res.body.overdueList[0]).toMatchObject({ rungId: 7, activityName: "Plastering", daysOverdue: 5, engineerNames: "Asha" });
    expect(res.body.engineerLoad).toEqual([{ name: "Asha", active: 4, overdue: 2 }]);
  });

  it("keeps the fields the web dashboard already reads", async () => {
    const res = await request(app()).get("/api/civilworkdpr-dashboard");
    for (const k of ["activities", "allocations", "labour", "assignedWork", "recentAssignments", "assignmentTimeline", "asOf"]) {
      expect(res.body).toHaveProperty(k);
    }
  });

  it("only counts current attempts, and ignores junk end dates when deciding what is overdue", async () => {
    await request(app()).get("/api/civilworkdpr-dashboard");
    const live = mockQueries.filter((q) => /AS Overdue|DaysOverdue|AS Active,/.test(q));
    expect(live.length).toBeGreaterThanOrEqual(3);
    for (const q of live) {
      expect(q).toMatch(/IsCurrent = 1/);
      expect(q).toMatch(/EndDate BETWEEN '2000-01-01' AND DATEADD\(DAY, -1, CAST\(GETDATE\(\) AS DATE\)\)/);
      expect(q).not.toMatch(/EndDate < CAST\(GETDATE\(\) AS DATE\)/);
    }
  });
});
