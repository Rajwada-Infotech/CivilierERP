process.env.NODE_ENV = "test";

/**
 * The agreement's date approval shares the agreement's approval log (same
 * table). Accepting a proposed date sets it Pending directly, so it must also
 * open a fresh approval cycle — otherwise the agreement's own earlier
 * approvals count toward the date approval's levels and a level is skipped.
 */
const mockQueries = [];
jest.mock("../db", () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q) => {
        mockQueries.push(q);
        if (q.includes("FROM dbo.CrmAgreement WITH (UPDLOCK, HOLDLOCK)")) {
          return { recordset: [{ AgreementDate: null, DateApprovalStatus: null, ProposedDate: "2026-11-20", ProposedDateStatus: "PendingCompanyReview" }] };
        }
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return r;
  };
  return { sql: new Proxy({}, { get: () => () => "type" }), getPool: () => ({ request }) };
});
jest.mock("../services/approvalService", () => ({ restartApprovalCycle: jest.fn(async () => {}) }));

const { acceptAgreementDate } = require("../services/crmWorkflowGuards");
const { restartApprovalCycle } = require("../services/approvalService");
const { getPool } = require("../db");

test("accepting a date sends it for approval from level 1 (a fresh cycle on the date approval)", async () => {
  await acceptAgreementDate(getPool(), 31, "Company");
  expect(mockQueries.some((q) => q.includes("DateApprovalStatus = 'Pending'"))).toBe(true);
  expect(restartApprovalCycle).toHaveBeenCalledWith("crm-agreement-date", 31, null, null, expect.stringMatching(/accepted by the company/));
});
