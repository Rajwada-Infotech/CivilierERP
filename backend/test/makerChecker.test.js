// Creators may approve their own requests — work guards removed.
let mockMaker = 7;
let mockRaiserMay = true;
jest.mock("../db", () => {
  const request = () => {
    const r = { input() { return r; }, async query(q) {
      if (/ApprovalRaiserRule/.test(q)) return { recordset: [{ RaiserMayApprove: true }] };
      // Approval Setup names the admin role, so the approver gate passes.
      if (/ApprovalWorkflows/.test(q)) return { recordset: [{ Id: 1, LevelsJson: '[{"id":1,"label":"Approval","roles":["admin"]}]' }] };
      if (/ApprovalAuditLog/.test(q)) return { recordset: [] };
      return { recordset: [{ Maker: mockMaker }] };
    } };
    return r;
  };
  return {
    sql: new Proxy({}, { get: () => () => "type" }),
    getPool: () => ({ request }),
  };
});

const { transition } = require("../services/approvalService");

describe("creator self-approval (maker-checker guards removed)", () => {
  test("the person who raised a refund can approve it (no 403 maker-checker refusal)", async () => {
    mockMaker = 7;
    // Beyond the maker guard into the transaction (fake pool doesn't implement Transaction, so it throws TypeError not 403)
    await expect(transition("crm-refunds", 1, "Approved", "a@x.com", "admin", null, 7))
      .rejects.not.toMatchObject({ status: 403 });
  });

  test("the same applies to cancellations and brokerage", async () => {
    mockMaker = 9;
    for (const m of ["crm-cancellations", "crm-brokerage"]) {
      await expect(transition(m, 1, "Approved", "a@x.com", "admin", null, 9))
        .rejects.not.toMatchObject({ status: 403 });
    }
  });

  test("resale raiser can approve their own request", async () => {
    mockMaker = 7;
    await expect(transition("crm-resales", 1, "Approved", "a@x.com", "admin", null, 7))
      .rejects.not.toMatchObject({ status: 403 });
  });
});
