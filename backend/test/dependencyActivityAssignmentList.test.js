process.env.NODE_ENV = "test";

/**
 * GET /api/dependency-activity-assignment — the paged list the mobile app reads. Filters and project scope are
 * applied in SQL (so a phone never downloads everything). The pool is faked; the SQL itself runs on the live server.
 */
const express = require("express");
const request = require("supertest");

let mockQuery = null;
let mockInputs = {};
jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => { req.user = { userId: 1, role: "user" }; next(); });
jest.mock("../middleware/requirePageRight", () => {
  const pass = () => (_req, _res, next) => next();
  return { requirePageRight: pass, requireAnyPageRight: pass };
});
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({
    request: () => {
      const r = {
        input: (name, _t, v) => { mockInputs[name] = v; return r; },
        query: async (text) => { mockQuery = text; return { recordset: [] }; },
      };
      return r;
    },
  }),
}));
jest.mock("../services/columnProbe", () => ({ makeColumnProbe: () => async () => true }));

let scope = null;
const app = () => {
  const a = express();
  a.use((req, _res, next) => { req.projectScope = scope; next(); });
  a.use("/api/dependency-activity-assignment", require("../routes/dependencyActivityAssignment"));
  return a;
};
beforeEach(() => { mockQuery = null; mockInputs = {}; scope = null; });

describe("GET /api/dependency-activity-assignment — paging, filters and scope", () => {
  it("pages with OFFSET/FETCH", async () => {
    await request(app()).get("/api/dependency-activity-assignment?page=3&limit=25");
    expect(mockQuery).toMatch(/OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY/);
    expect(mockInputs).toMatchObject({ offset: 50, limit: 25 });
  });

  it("search, overdue and due-soon become SQL conditions", async () => {
    await request(app()).get("/api/dependency-activity-assignment?search=plaster&overdue=1");
    expect(mockQuery).toMatch(/am\.activity_name LIKE @search/);
    expect(mockQuery).toMatch(/daa\.EndDate BETWEEN '2000-01-01'/);
    expect(mockInputs.search).toBe("%plaster%");
    await request(app()).get("/api/dependency-activity-assignment?dueSoon=1");
    expect(mockQuery).toMatch(/DATEADD\(DAY, 2,/);
  });

  it("qcPending leaves out activities whose latest QC already passed", async () => {
    await request(app()).get("/api/dependency-activity-assignment?status=COMPLETED&qcPending=1");
    expect(mockQuery).toMatch(/<> 'APPROVED'/);
    await request(app()).get("/api/dependency-activity-assignment?status=COMPLETED");
    expect(mockQuery).not.toMatch(/qcp\.Decision/);
  });

  it("a single rung skips the active-chain filter", async () => {
    await request(app()).get("/api/dependency-activity-assignment?rungId=9&limit=1");
    expect(mockQuery).toMatch(/daa\.DependencyMasterActivityId = @rungIdFilter/);
    expect(mockQuery).not.toMatch(/dm\.IsActive = 1/);
    await request(app()).get("/api/dependency-activity-assignment");
    expect(mockQuery).toMatch(/dm\.IsActive = 1/);
  });

  it("restricts a scoped user to their projects; super admin (no scope) is unrestricted", async () => {
    scope = [4, 7];
    await request(app()).get("/api/dependency-activity-assignment");
    expect(mockQuery).toMatch(/dm\.ProjectId IN \(4,7\)/);
    scope = null;
    await request(app()).get("/api/dependency-activity-assignment");
    expect(mockQuery).not.toMatch(/dm\.ProjectId IN/);
  });
});
