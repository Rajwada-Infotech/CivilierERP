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

  // A pool that answers by table: user rows, role rows (or "table missing").
  const tablePool = ({ userRows = [], roleRows = [], roleTableMissing = false }) => ({
    request: () => {
      const inputs = {};
      return {
        input(k, _t, v) { inputs[k] = v; return this; },
        query: async (text) => {
          if (/UserProjectAccess/.test(text)) return { recordset: userRows };
          if (/RoleProjectAccess/.test(text)) {
            if (roleTableMissing) { const e = new Error("Invalid object name"); e.number = 208; throw e; }
            return { recordset: inputs.rid === 7 ? roleRows : [] };
          }
          return { recordset: [] };
        },
      };
    },
  });

  test("a user with no personal list follows their role's list", async () => {
    getPool.mockReturnValue(tablePool({ roleRows: [{ ProjectId: 5 }, { ProjectId: 6 }] }));
    expect(await getProjectScope({ userId: 10, role: "engineer", roleId: 7 })).toEqual([5, 6]);
  });

  test("a personal list overrides the role's, it is not added to it", async () => {
    getPool.mockReturnValue(tablePool({ userRows: [{ ProjectId: 9 }], roleRows: [{ ProjectId: 5 }, { ProjectId: 6 }] }));
    expect(await getProjectScope({ userId: 11, role: "engineer", roleId: 7 })).toEqual([9]);
  });

  test("neither a personal nor a role list means unrestricted", async () => {
    getPool.mockReturnValue(tablePool({}));
    expect(await getProjectScope({ userId: 12, role: "engineer", roleId: 7 })).toBeNull();
  });

  test("a role with a list does not restrict users of other roles", async () => {
    getPool.mockReturnValue(tablePool({ roleRows: [{ ProjectId: 5 }] }));
    expect(await getProjectScope({ userId: 13, role: "engineer", roleId: 8 })).toBeNull();
  });

  test("admin roles ignore a role list", async () => {
    getPool.mockReturnValue(tablePool({ roleRows: [{ ProjectId: 5 }] }));
    expect(await getProjectScope({ userId: 14, role: "admin", roleId: 7 })).toBeNull();
  });

  test("before migration 534 (no role table) it fails open for the role part", async () => {
    getPool.mockReturnValue(tablePool({ roleTableMissing: true }));
    expect(await getProjectScope({ userId: 15, role: "engineer", roleId: 7 })).toBeNull();
  });

  test("the missing role table does not disturb a user's own list", async () => {
    getPool.mockReturnValue(tablePool({ userRows: [{ ProjectId: 3 }], roleTableMissing: true }));
    expect(await getProjectScope({ userId: 16, role: "engineer", roleId: 7 })).toEqual([3]);
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
