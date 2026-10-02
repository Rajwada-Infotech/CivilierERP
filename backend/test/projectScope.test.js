jest.mock("../db", () => ({ getPool: jest.fn(), sql: require("mssql") }));

const { getPool } = require("../db");
const {
  getProjectScope,
  invalidateProjectScope,
  projectPredicate,
  projectAllowed,
  assertProjectAllowed,
  assertProjectRawAllowed,
  assertGodownAllowed,
  ebResolvedProjectSql,
  paymentProjectSql,
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

const mockRes = () => {
  const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
  return res;
};

describe("assertProjectRawAllowed (project given as text: an id or a name)", () => {
  test("unrestricted users always pass, even with no project", async () => {
    expect(await assertProjectRawAllowed({ projectScope: null }, mockRes(), "")).toBe(true);
  });

  test("a restricted user passes with an allowed numeric id and is refused for another", async () => {
    expect(await assertProjectRawAllowed({ projectScope: [4] }, mockRes(), "4")).toBe(true);
    const res = mockRes();
    expect(await assertProjectRawAllowed({ projectScope: [4] }, res, "9")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("a restricted user must name a project - blank is refused (the row would be invisible to them)", async () => {
    const res = mockRes();
    expect(await assertProjectRawAllowed({ projectScope: [4] }, res, "  ")).toBe(false);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("a project given by name is resolved to its id first", async () => {
    getPool.mockReturnValue(poolReturning([{ id: 4 }]));
    expect(await assertProjectRawAllowed({ projectScope: [4] }, mockRes(), "Emporis")).toBe(true);
    getPool.mockReturnValue(poolReturning([]));
    expect(await assertProjectRawAllowed({ projectScope: [4] }, mockRes(), "Unknown")).toBe(false);
  });
});

describe("assertGodownAllowed", () => {
  test("allows a godown of an in-scope project, refuses other projects and project-less godowns", async () => {
    getPool.mockReturnValue(poolReturning([{ ProjectID: 4 }]));
    expect(await assertGodownAllowed({ projectScope: [4] }, mockRes(), 1)).toBe(true);
    getPool.mockReturnValue(poolReturning([{ ProjectID: 9 }]));
    expect(await assertGodownAllowed({ projectScope: [4] }, mockRes(), 1)).toBe(false);
    getPool.mockReturnValue(poolReturning([{ ProjectID: null }]));
    expect(await assertGodownAllowed({ projectScope: [4] }, mockRes(), 1)).toBe(false);
  });

  test("unrestricted users are not checked at all", async () => {
    getPool.mockClear();
    expect(await assertGodownAllowed({ projectScope: null }, mockRes(), 1)).toBe(true);
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("project-resolving SQL fragments", () => {
  test("an invoice's project handles the id form, the name form and the GRN->PO fallback", () => {
    const sql = ebResolvedProjectSql("eb");
    expect(sql).toContain("TRY_CAST(eb.EProjectName AS INT)");
    expect(sql).toContain("pj.name = eb.EProjectName");
    expect(sql).toContain("GoodsReceiptNotes");
  });

  test("a payment's project is its invoice's, else its own PProject", () => {
    const sql = paymentProjectSql("np");
    expect(sql).toContain("np.PExpenseRef");
    expect(sql).toContain("TRY_CAST(np.PProject AS INT)");
  });
});
