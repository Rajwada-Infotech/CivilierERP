process.env.NODE_ENV = "test";

/**
 * Journal Voucher and Inter-Company Transfer forcefully correct account-head
 * mismatches / fire an entire auto-generated document chain on approval —
 * both are restricted to super_admin only, unlike every other module where
 * admin/dba can also approve (backend/services/approvalService.js's
 * MODULE_APPROVER_ROLE_OVERRIDES). This test exercises transition()'s
 * authorization gate directly against a fake DB, for both the restricted
 * modules and one ordinary module (grn) that must remain unaffected.
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

describe("approvalService: per-module approver role restriction", () => {
  test.each(["admin", "dba"])(
    "rejects '%s' approving a journal-voucher (super_admin only)",
    async (role) => {
      await expect(
        transition("journal-voucher", 1, "Approved", "user@example.com", role),
      ).rejects.toThrow(/not authorized/i);
    },
  );

  test("allows 'super_admin' to approve a journal-voucher", async () => {
    const result = await transition("journal-voucher", 1, "Approved", "user@example.com", "super_admin");
    expect(result.newStatus).toBe("Approved");
  });

  test.each(["admin", "dba"])(
    "rejects '%s' approving an inter-company-transfer (super_admin only)",
    async (role) => {
      await expect(
        transition("inter-company-transfer", 1, "Approved", "user@example.com", role),
      ).rejects.toThrow(/not authorized/i);
    },
  );

  test("allows 'super_admin' to approve an inter-company-transfer", async () => {
    const result = await transition("inter-company-transfer", 1, "Approved", "user@example.com", "super_admin");
    expect(result.newStatus).toBe("Approved");
  });

  test("allows a non-super_admin user named by userId on Approval Setup's current level for journal-voucher", async () => {
    // Reproduces the production report: Approval Setup named a specific
    // person (userId 42, role "accounts_head") alongside super_admin as a
    // Journal Voucher approver, but transition() never consulted the
    // workflow for restricted modules — only super_admin's role check ever
    // passed, so that person's Approve/Reject 403'd even though the inbox
    // showed the record as theirs to act on.
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", userIds: [42] }]);
    const result = await transition("journal-voucher", 1, "Approved", "user@example.com", "accounts_head", null, 42);
    expect(result.newStatus).toBe("Approved");
  });

  test("still rejects a non-super_admin user NOT named on journal-voucher's Approval Setup level", async () => {
    dbMock.__setWorkflow([{ id: 1, label: "Level 1", userIds: [42] }]);
    await expect(
      transition("journal-voucher", 1, "Approved", "user@example.com", "accounts_head", null, 99),
    ).rejects.toThrow(/not authorized/i);
  });

  test("ordinary modules (grn) are unaffected — admin/dba can still approve", async () => {
    const asAdmin = await transition("grn", 1, "Approved", "user@example.com", "admin");
    expect(asAdmin.newStatus).toBe("Approved");
    dbMock.__setRecordStatus("Pending");
    dbMock.__resetApproval();
    const asDba = await transition("grn", 1, "Approved", "user@example.com", "dba");
    expect(asDba.newStatus).toBe("Approved");
  });
});
