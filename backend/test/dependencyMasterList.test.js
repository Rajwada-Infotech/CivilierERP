process.env.NODE_ENV = "test";

/** GET /api/dependency-master — optional project / search / paging narrowing used by the mobile app. */
const express = require("express");
const request = require("supertest");

let mockQueries = [];
let mockInputs = {};
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 1, role: "user" }; next(); });
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: (n, _t, v) => { mockInputs[n] = v; return r; },
        query: async (text) => { mockQueries.push(text); return { recordset: /FROM dbo.DependencyMaster dm/.test(text) && /AS scopePath/.test(text) ? [{ id: 5 }, { id: 9 }] : [] }; },
      };
      return r;
    },
  }),
}));

const app = () => {
  const a = express();
  a.use((req, _res, next) => { req.projectScope = null; next(); });
  a.use("/api/dependency-master", require("../routes/dependencyMaster"));
  return a;
};
beforeEach(() => { mockQueries = []; mockInputs = {}; });

describe("GET /api/dependency-master narrowing", () => {
  it("filters by project, pages, and only loads the returned chains' rungs", async () => {
    await request(app()).get("/api/dependency-master?projectId=4&page=2&limit=10");
    expect(mockQueries[0]).toMatch(/dm\.ProjectId = @projectId/);
    expect(mockQueries[0]).toMatch(/OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    expect(mockInputs).toMatchObject({ projectId: 4, offset: 10, limit: 10 });
    expect(mockQueries[1]).toMatch(/DependencyMasterId IN \(5,9\)/);
  });

  it("withActivities=0 skips the rung query", async () => {
    await request(app()).get("/api/dependency-master?projectId=4&withActivities=0");
    expect(mockQueries).toHaveLength(1);
  });

  it("unchanged without params: whole list, all rungs", async () => {
    await request(app()).get("/api/dependency-master");
    expect(mockQueries[0]).not.toMatch(/OFFSET/);
    expect(mockQueries[1]).not.toMatch(/DependencyMasterId IN/);
  });
});
