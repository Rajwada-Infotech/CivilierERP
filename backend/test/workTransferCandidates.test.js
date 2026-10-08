process.env.NODE_ENV = "test";

/** Work Transfer's candidate list: paged and filtered in SQL, ids-only endpoint for "select all". */
const express = require("express");
const request = require("supertest");

let mockQueries = [];
let mockInputs = {};
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 1, role: "user" }; next(); });
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (_req, _res, next) => next();
  return { requirePageRight: pass, requireAnyPageRight: pass };
});
jest.mock("../services/columnProbe", () => ({ makeColumnProbe: () => async () => true }));
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: (n, _t, v) => { mockInputs[n] = v; return r; },
        query: async (text) => {
          mockQueries.push(text);
          if (/SELECT daa\.Id AS assignmentId\s+FROM dbo\.DependencyActivityEngineer/.test(text)) return { recordset: [{ assignmentId: 11 }, { assignmentId: 12 }] };
          if (/COUNT\(\*\) AS total/.test(text)) return { recordset: [{ total: 42 }] };
          if (/GROUP BY dm\.ProjectId/.test(text)) return { recordset: [{ id: 3, name: "Alpha", count: 42 }] };
          if (/WHERE daa\.Id IN \(11,12\)/.test(text)) return { recordset: [{ assignmentId: 12, activityName: "B" }, { assignmentId: 11, activityName: "A" }] };
          if (/SELECT TOP 2000 daa\.Id AS id/.test(text)) return { recordset: [{ id: 5 }, { id: 6 }] };
          return { recordset: [] };
        },
      };
      return r;
    },
  }),
}));

let scope = null;
const app = () => {
  const a = express();
  a.use((req, _res, next) => { req.projectScope = scope; next(); });
  a.use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
  return a;
};
beforeEach(() => { mockQueries = []; mockInputs = {}; scope = null; });

describe("GET /transfer/candidates (paged)", () => {
  it("returns one page, the total and per-project counts, in the page's order", async () => {
    const res = await request(app()).get("/api/dependency-activity-assignment/transfer/candidates?engineerId=9&page=2&limit=20&projectId=3&search=plaster");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(42);
    expect(res.body.projects).toEqual([{ id: 3, name: "Alpha", count: 42 }]);
    expect(res.body.rows.map((r) => r.assignmentId)).toEqual([11, 12]); // page order, not detail order
    expect(mockInputs).toMatchObject({ engineerId: 9, offset: 20, limit: 20, projectId: 3, search: "%plaster%" });
    const pageSql = mockQueries.find((q) => /OFFSET @offset/.test(q));
    expect(pageSql).toMatch(/FROM dbo\.DependencyActivityEngineer dae/);
    expect(pageSql).toMatch(/dae\.EngineerId = @engineerId/);
  });

  it("restricts a scoped user to their projects", async () => {
    scope = [4, 7];
    await request(app()).get("/api/dependency-activity-assignment/transfer/candidates?engineerId=9&page=1");
    expect(mockQueries.find((q) => /OFFSET @offset/.test(q))).toMatch(/dm\.ProjectId IN \(4,7\)/);
  });

  it("without ?page the old full-array response still works", async () => {
    const res = await request(app()).get("/api/dependency-activity-assignment/transfer/candidates?engineerId=9");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("GET /transfer/candidates/ids", () => {
  it("returns every matching id, capped at 2000", async () => {
    const res = await request(app()).get("/api/dependency-activity-assignment/transfer/candidates/ids?engineerId=9&search=x");
    expect(res.body).toEqual({ ids: [5, 6] });
    expect(mockQueries[0]).toMatch(/TOP 2000/);
  });
  it("requires an engineer", async () => {
    const res = await request(app()).get("/api/dependency-activity-assignment/transfer/candidates/ids");
    expect(res.status).toBe(400);
  });
});
