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
  let approvedLevelCount = 0;

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
          return { recordset: [], rowsAffected: [1] };
        }
        if (/MAX\(Level\) AS maxApprovedLevel/i.test(text)) {
          return { recordset: [{ maxApprovedLevel: approvedLevelCount }] };
        }
        if (/FROM dbo\.ApprovalWorkflows/i.test(text)) {
          return { recordset: [] }; // no workflow configured -> defaults to 1 level
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

  test("ordinary modules (grn) are unaffected — admin/dba can still approve", async () => {
    const asAdmin = await transition("grn", 1, "Approved", "user@example.com", "admin");
    expect(asAdmin.newStatus).toBe("Approved");
    dbMock.__setRecordStatus("Pending");
    const asDba = await transition("grn", 1, "Approved", "user@example.com", "dba");
    expect(asDba.newStatus).toBe("Approved");
  });
});
