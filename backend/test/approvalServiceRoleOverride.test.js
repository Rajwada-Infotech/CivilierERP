process.env.NODE_ENV = "test";

/**
 * Approval Setup is the only source of approvers (migration 582): transition()
 * admits a user only when the record's current level in the module's workflow
 * names their role or names them. No code role list, no admin pass, and no
 * workflow means nobody may approve. Exercised against a fake DB.
 */

jest.mock("../db", () => {
  const sql = require("mssql");
  let recordStatus = "Pending";
  // Tracks whether an approval was written this test — these tests never
  // use "all" mode (no workflow configured -> single default level), so a
  // single Approved insert always satisfies the one level that exists.
  let insertedApproval = false;
  // null (default) = no Approval Setup workflow configured for the module
  // being tested, same as before this field existed. Set via __setWorkflow
  // to exercise transition()'s workflow-userId authorization path.
  let workflowLevelDefs = null;

  const makeRequest = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/SELECT .*status.* FROM/i.test(text)) {
          return { recordset: [{ status: recordStatus }] };
        }
        if (/UPDATE .* SET .* = @Status/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        if (/INSERT INTO dbo\.ApprovalAuditLog/i.test(text)) {
          insertedApproval = true;
          return { recordset: [], rowsAffected: [1] };
        }
        if (/MAX\(Level\) AS maxApprovedLevel/i.test(text)) {
          return { recordset: [{ maxApprovedLevel: insertedApproval ? 1 : 0 }] };
        }
        // isLevelSatisfied()'s default "any" check.
        if (/SELECT TOP 1 1 AS found/i.test(text)) {
          return { recordset: insertedApproval ? [{ found: 1 }] : [] };
        }
        if (/SELECT DISTINCT UserId FROM dbo\.ApprovalAuditLog/i.test(text)) {
          return { recordset: [] };
        }
        if (/FROM dbo\.ApprovalWorkflows/i.test(text)) {
          return workflowLevelDefs
            ? { recordset: [{ Id: 1, LevelsJson: JSON.stringify(workflowLevelDefs) }] }
            : { recordset: [] }; // no workflow configured -> defaults to 1 level
        }
        if (/GLPostingLog/i.test(text)) {
          return { recordset: [], rowsAffected: [1] };
        }
        return { recordset: [] };
      },
    };
    return req;
  };

  const fakePool = { request: makeRequest };
  const FakeTransaction = function () {
    return {
      begin: jest.fn(async () => {}),
      commit: jest.fn(async () => {}),
      rollback: jest.fn(async () => {}),
      request: makeRequest,
    };
  };

  return {
    sql: { ...sql, Transaction: FakeTransaction },
    getPool: () => fakePool,
    __setRecordStatus: (s) => { recordStatus = s; },
    __resetApproval: () => { insertedApproval = false; },
    __setWorkflow: (levelDefs) => { workflowLevelDefs = levelDefs; },
  };
});

jest.mock("../services/generalLedger", () => ({
  postGRNApproval: jest.fn(async () => ({ posted: true })),
  postExpenseBookingApproval: jest.fn(async () => ({ posted: true })),
  postPaymentApproval: jest.fn(async () => ({ posted: true })),
  postJournalVoucherApproval: jest.fn(async () => ({ posted: true })),
}));

const { transition } = require("../services/approvalService");
const dbMock = require("../db");

beforeEach(() => {
  dbMock.__setRecordStatus("Pending");
  dbMock.__resetApproval();
  dbMock.__setWorkflow(null);
});

describe("approvalService: Approval Setup decides who approves with parallel Super Admin rights", () => {
  test("no workflow in Approval Setup -> nobody may approve, ask an admin to add one", async () => {
    await expect(
      transition("journal-voucher", 1, "Approved", "user@example.com", "super_admin", null, 1),
    ).rejects.toThrow(/no approval rule is set up/i);
  });

  test("a role named on the level may approve", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Approval", roles: ["accounts_head"], userIds: [] }]);
    const result = await transition("journal-voucher", 1, "Approved", "user@example.com", "accounts_head", null, 1);
    expect(result.newStatus).toBe("Approved");
  });

  test("super_admin not explicitly named on the level may approve in parallel", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Approval", roles: ["accounts_head"], userIds: [] }]);
    const result = await transition("journal-voucher", 1, "Approved", "admin@example.com", "super_admin", null, 7);
    expect(result.newStatus).toBe("Approved");
  });

  test.each(["store_manager", "site_engineer"])("'%s' not named on the level is refused", async (role) => {
    dbMock.__setWorkflow([{ id: 1, label: "Approval", roles: ["accounts_head"], userIds: [] }]);
    await expect(
      transition("journal-voucher", 1, "Approved", "user@example.com", role, null, 7),
    ).rejects.toThrow(/not authorized/i);
  });

  test("a person named by userId may approve whatever their role", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", userIds: [42] }]);
    const result = await transition("journal-voucher", 1, "Approved", "user@example.com", "accounts_head", null, 42);
    expect(result.newStatus).toBe("Approved");
  });

  test("someone not named by role or userId is refused", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", userIds: [42] }]);
    await expect(
      transition("journal-voucher", 1, "Approved", "user@example.com", "store_manager", null, 99),
    ).rejects.toThrow(/not authorized/i);
  });

  test("a level naming nobody refuses non-superadmin", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", roles: [], userIds: [] }]);
    await expect(
      transition("grn", 1, "Approved", "user@example.com", "store_manager", null, 2),
    ).rejects.toThrow(/not authorized/i);
  });

  test("rejecting follows the same rule for non-superadmin", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", userIds: [42] }]);
    await expect(
      transition("grn", 1, "Rejected", "user@example.com", "store_manager", null, 2),
    ).rejects.toThrow(/not authorized/i);
  });
});
