process.env.NODE_ENV = "test";

/**
 * backend/routes/approvalInbox.js's isVisibleToViewer() decides which
 * Pending records show up in a non-admin viewer's inbox, and whether they
 * can actually act on it there (canAct) or are only seeing it for
 * awareness (canAct: false — transition()'s own per-level gate will still
 * correctly 403 a click on the wrong level).
 *
 * Confirmed against real production data (2026-09-22): director-role users
 * Bikash and Parvin are Level-2 approvers on a 2-level Material Request
 * rule (Level 1: Super Admin/Amit, Level 2: Super Admin/Bikash/Parvin).
 * Only 1 of 9 currently-Pending MRs had been approved past Level 1 — the
 * other 8 correctly couldn't be acted on by them yet, but the OLD code also
 * hid them from view entirely (isVisibleToViewer matched ONLY the level a
 * record currently resolves to), which read as "the inbox is missing
 * older records" even though it was working exactly as configured.
 *
 * There's a second, narrower failure mode this same fix covers: level
 * resolution is computed live by replaying ApprovalAuditLog against the
 * CURRENT ApprovalWorkflows config (no stored snapshot of what the
 * workflow looked like when a record was submitted), so reconfiguring
 * Approval Setup after older records already had some history could land
 * a record past the workflow's last level entirely, even with Status still
 * Pending — silently dropped for everyone but admin.
 *
 * Fix: a record is visible to anyone named ANYWHERE on the module's
 * workflow, not only on whichever level it currently resolves to; canAct
 * is only true when they're named on the CURRENT level. The actual
 * approve/reject gate in transition() is untouched and still enforces the
 * real current level.
 */

jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  logger.child = jest.fn(() => logger);
  return logger;
});
jest.mock("../db", () => ({
  sql: require("mssql"),
  getPool: () => ({ request: () => ({ input: () => ({ input: () => ({ query: async () => ({ recordset: [] }) }) }), query: async () => ({ recordset: [] }) }) }),
  connectDB: jest.fn(async () => {}),
  closeDB: jest.fn(async () => {}),
  isDbReady: jest.fn(async () => true),
  queryWithRetry: async (pool, fn) => fn(pool.request()),
}));
jest.mock("../redis", () => ({
  bumpCacheVersion: jest.fn(async () => {}),
  redisGet: jest.fn(async () => null),
  redisSet: jest.fn(async () => {}),
}));

let mockCurrentLevel;
jest.mock("../services/approvalService", () => ({
  MODULE_MAP: {
    "material-requests": { table: "dbo.MaterialRequests", pk: "MRId", status: "Status" },
  },
  MODULE_APPROVER_ROLE_OVERRIDES: {},
  APPROVER_ROLES: ["admin", "super_admin", "dba"],
  getWorkflow: jest.fn(),
  resolveCurrentLevel: jest.fn(() => Promise.resolve(mockCurrentLevel)),
  hasApprovalInboxEditRight: jest.fn(async () => false),
}));

const { isVisibleToViewer, isNamedOnLevel, filterVisibleToViewer } = require("../routes/approvalInbox");

const item = { Module: "material-requests", RecordId: "42" };

// Mirrors the live production config: Level 1 = Super Admin + Amit (users
// 1, 2100), Level 2 = Super Admin + Bikash + Parvin (users 1, 1095, 2101).
const workflow = {
  Levels: 2,
  LevelDefs: [
    { userIds: [1, 2100], mode: "any" },
    { userIds: [1, 1095, 2101], mode: "any" },
  ],
};
const cache = new Map([["material-requests", workflow]]);

describe("isNamedOnLevel", () => {
  it("matches by userId", () => {
    expect(isNamedOnLevel({ userIds: [5, 6] }, "director", 6)).toBe(true);
    expect(isNamedOnLevel({ userIds: [5, 6] }, "director", 9)).toBe(false);
  });

  it("matches by role, case-insensitively", () => {
    expect(isNamedOnLevel({ roles: ["Director"] }, "director", null)).toBe(true);
    expect(isNamedOnLevel({ roles: ["marketing_head"] }, "director", null)).toBe(false);
  });

  it("returns null (uncustomised) when the level has neither roles nor userIds", () => {
    expect(isNamedOnLevel({}, "director", 6)).toBeNull();
    expect(isNamedOnLevel({ roles: [], userIds: [] }, "director", 6)).toBeNull();
  });
});

describe("isVisibleToViewer", () => {
  it("shows and allows acting for whoever is named on the level it currently resolves to", async () => {
    mockCurrentLevel = 1; // Level 1 = [1, 2100] (Amit)
    expect(await isVisibleToViewer(item, "director", 2100, cache)).toEqual({
      visible: true, canAct: true, currentLevel: 1, totalLevels: 2,
    });
  });

  it("still Level-2-only approver (Parvin/Bikash) sees a record still sitting at Level 1, but can't act on it yet", async () => {
    mockCurrentLevel = 1; // Amit hasn't approved yet — normal staged approval, not a bug
    const result = await isVisibleToViewer(item, "director", 1095, cache); // Parvin, Level-2 only
    expect(result.visible).toBe(true);
    expect(result.canAct).toBe(false);
  });

  it("lets the Level-2 approver act once the record actually reaches Level 2", async () => {
    mockCurrentLevel = 2;
    const result = await isVisibleToViewer(item, "director", 1095, cache);
    expect(result).toEqual({ visible: true, canAct: true, currentLevel: 2, totalLevels: 2 });
  });

  it("hides the record from someone the workflow never names at all", async () => {
    mockCurrentLevel = 1;
    expect(await isVisibleToViewer(item, "director", 999, cache)).toEqual({
      visible: false, canAct: false, currentLevel: 1, totalLevels: 2,
    });
  });

  it("still shows a record whose stale history resolves it past the final level, to anyone the workflow names — not silently dropped", async () => {
    mockCurrentLevel = 3; // > totalLevels (2) — the exact "vanished" bug
    const result = await isVisibleToViewer(item, "director", 2101, cache);
    expect(result.visible).toBe(true);
    expect(result.canAct).toBe(false);
  });

  it("hides a past-final-level record from a viewer the workflow doesn't name at all", async () => {
    mockCurrentLevel = 3;
    expect((await isVisibleToViewer(item, "director", 999, cache)).visible).toBe(false);
  });

  it("always shows everything to admin/super_admin, regardless of level, and lets them act", async () => {
    mockCurrentLevel = 3;
    expect(await isVisibleToViewer(item, "admin", 999, cache)).toEqual({ visible: true, canAct: true });
    expect(await isVisibleToViewer(item, "super_admin", 999, cache)).toEqual({ visible: true, canAct: true });
  });
});

describe("filterVisibleToViewer", () => {
  const { getWorkflow } = require("../services/approvalService");

  it("attaches _canAct only for records the viewer can't yet act on, leaving others untouched", async () => {
    getWorkflow.mockResolvedValue(workflow);
    mockCurrentLevel = 1;
    const req = { user: { role: "director", userId: 1095 } }; // Parvin, Level-2 only
    const out = await filterVisibleToViewer([item], req);
    expect(out).toHaveLength(1);
    expect(out[0]._canAct).toBe(false);
    expect(out[0]._currentLevel).toBe(1);
    expect(out[0]._totalLevels).toBe(2);
    // Original item object is untouched (a new object was returned).
    expect(item._canAct).toBeUndefined();
  });

  it("does not attach _canAct when the viewer can act right now", async () => {
    getWorkflow.mockResolvedValue(workflow);
    mockCurrentLevel = 1;
    const req = { user: { role: "director", userId: 2100 } }; // Amit, Level 1
    const out = await filterVisibleToViewer([item], req);
    expect(out).toHaveLength(1);
    expect(out[0]._canAct).toBeUndefined();
  });
});
