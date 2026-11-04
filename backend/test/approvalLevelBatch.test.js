process.env.NODE_ENV = "test";

/**
 * Approval checks without the round trips (services/approvalService.js):
 * - a record's current level comes from ONE read of this cycle's approvals, not one query per level
 *   (that was ~1.7 million queries on production), with the same rules as before;
 * - a workflow is kept in memory between checks and dropped when Approval Setup saves.
 */
const mockState = { queries: [], approvals: [], levels: [{ id: 1 }, { id: 2 }, { id: 3 }] };
jest.mock("../db", () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q) => {
        mockState.queries.push(q);
        if (/SELECT Level, UserId, Role FROM dbo\.ApprovalAuditLog/.test(q)) return { recordset: mockState.approvals };
        if (/FROM dbo\.ApprovalWorkflows/.test(q)) return { recordset: [{ Id: 1, LevelsJson: JSON.stringify(mockState.levels) }] };
        return { recordset: [] };
      },
    };
    return r;
  };
  return { sql: require("mssql"), getPool: () => ({ request }) };
});

const { resolveCurrentLevel, levelSatisfiedBy, getWorkflow, invalidateWorkflowCache } = require("../services/approvalService");

beforeEach(() => { mockState.queries = []; mockState.approvals = []; invalidateWorkflowCache(); });
const auditReads = () => mockState.queries.filter((q) => /ApprovalAuditLog/.test(q) && /SELECT/.test(q)).length;

describe("current level from one read", () => {
  test("three levels, one read; the first unsatisfied level is current", async () => {
    mockState.approvals = [{ Level: 1, UserId: 5, Role: "manager" }];
    expect(await resolveCurrentLevel("PurchaseOrders", 9, 3, [{}, {}, {}])).toBe(2);
    expect(auditReads()).toBe(1);
  });

  test("every level done: past the last", async () => {
    mockState.approvals = [1, 2, 3].map((Level) => ({ Level, UserId: Level, Role: "x" }));
    expect(await resolveCurrentLevel("PurchaseOrders", 9, 3, [{}, {}, {}])).toBe(4);
  });

  test("an 'everyone must approve' level waits for every named person", () => {
    const def = { mode: "all", userIds: [7, 8] };
    expect(levelSatisfiedBy([{ Level: 1, UserId: 7, Role: "a" }], 1, def)).toBe(false);
    expect(levelSatisfiedBy([{ Level: 1, UserId: 7, Role: "a" }, { Level: 1, UserId: 8, Role: "b" }], 1, def)).toBe(true);
  });

  test("Super Admin's sign-off completes an 'everyone' level on its own", () => {
    expect(levelSatisfiedBy([{ Level: 1, UserId: 1, Role: "super_admin" }], 1, { mode: "all", userIds: [7, 8] })).toBe(true);
  });

  test("an approval at another level does not count", () => {
    expect(levelSatisfiedBy([{ Level: 2, UserId: 7, Role: "a" }], 1, {})).toBe(false);
  });

  test("only this cycle counts: the read starts at the last 'sent for approval' marker", async () => {
    await resolveCurrentLevel("PurchaseOrders", 9, 2, [{}, {}]);
    const q = mockState.queries.find((x) => /SELECT Level, UserId, Role/.test(x));
    expect(q).toMatch(/ActionAt >= ISNULL\(\(\s*SELECT MAX\(ActionAt\) FROM dbo\.ApprovalAuditLog[\s\S]*Level = 0 AND ActionStatus = 'Pending'/);
  });
});

describe("workflow kept in memory", () => {
  const wfReads = () => mockState.queries.filter((q) => /ApprovalWorkflows/.test(q)).length;

  test("read once, then served from memory", async () => {
    await getWorkflow("purchase-orders");
    await getWorkflow("purchase-orders");
    expect(wfReads()).toBe(1);
  });

  test("Approval Setup saving drops it", async () => {
    await getWorkflow("purchase-orders");
    invalidateWorkflowCache();
    await getWorkflow("purchase-orders");
    expect(wfReads()).toBe(2);
  });

  test("a caller changing its copy does not change the next caller's", async () => {
    const a = await getWorkflow("purchase-orders");
    a.LevelDefs.push({ id: 99 });
    const b = await getWorkflow("purchase-orders");
    expect(b.LevelDefs).toHaveLength(3);
  });
});
