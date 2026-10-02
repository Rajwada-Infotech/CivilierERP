jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));

const { getPool } = require("../db");
const {
  getProjectScope,
  invalidateProjectScope,
  projectPredicate,
  projectAllowed,
  assertProjectAllowed,
} = require("../services/projectScope");

const poolReturning = (rows) => ({
  request: () => ({ input() { return this; }, query: async () => ({ recordset: rows }) }),
});

describe("projectPredicate / projectAllowed", () => {
  test("unrestricted scope adds no SQL and allows everything", () => {
    expect(projectPredicate(null, "mr.ProjectId")).toBe("");
    expect(projectAllowed(null, 99)).toBe(true);
  });

  test("restricted scope limits to the listed ids only", () => {
    expect(projectPredicate([3, 7], "mr.ProjectId")).toBe(" AND mr.ProjectId IN (3,7)");
    expect(projectPredicate([3], "id", "").trim()).toBe("id IN (3)");
    expect(projectAllowed([3, 7], "7")).toBe(true);
    expect(projectAllowed([3, 7], 8)).toBe(false);
  });

  test("a NULL / missing project is never inside a restricted scope", () => {
    expect(projectAllowed([3], null)).toBe(false);
    expect(projectAllowed([3], undefined)).toBe(false);
  });

  test("ids are coerced to integers so nothing can be injected", () => {
    expect(projectPredicate(["1; DROP TABLE x", 5], "p")).toBe(" AND p IN (5)");
  });
});

describe("assertProjectAllowed", () => {
  const mockRes = () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    return res;
  };

  test("403s and returns false for a project outside the scope", () => {
    const res = mockRes();
    expect(assertProjectAllowed({ projectScope: [1] }, res, 2)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("passes when unrestricted, in scope, or no project given", () => {
    expect(assertProjectAllowed({ projectScope: null }, mockRes(), 2)).toBe(true);
    expect(assertProjectAllowed({ projectScope: [2] }, mockRes(), "2")).toBe(true);
    expect(assertProjectAllowed({ projectScope: [2] }, mockRes(), null)).toBe(true);
  });
});

describe("getProjectScope", () => {
  beforeEach(() => invalidateProjectScope());

  test("admin roles are never restricted and never hit the DB", async () => {
    getPool.mockClear();
    expect(await getProjectScope({ userId: 1, role: "super_admin" })).toBeNull();
    expect(await getProjectScope({ userId: 1, role: "admin" })).toBeNull();
    expect(getPool).not.toHaveBeenCalled();
  });

  test("a user with no assignments is unrestricted (opt-in scoping)", async () => {
    getPool.mockReturnValue(poolReturning([]));
    expect(await getProjectScope({ userId: 2, role: "user" })).toBeNull();
  });

  test("a user with assignments is limited to exactly those projects", async () => {
    getPool.mockReturnValue(poolReturning([{ ProjectId: 4 }, { ProjectId: 9 }]));
    expect(await getProjectScope({ userId: 3, role: "user" })).toEqual([4, 9]);
  });

  test("before the migration has run (missing table) it fails open, not 500", async () => {
    getPool.mockReturnValue({
      request: () => ({ input() { return this; }, query: async () => { const e = new Error("Invalid object name"); e.number = 208; throw e; } }),
    });
    expect(await getProjectScope({ userId: 4, role: "user" })).toBeNull();
  });
});
