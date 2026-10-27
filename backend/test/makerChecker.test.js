// Maker-checker: whoever raised a request can't approve it themselves —
// unless Approval Setup lets the raiser approve in that module
// (dbo.ApprovalRaiserRule, migration 571).
let mockMaker = 7;
let mockRaiserMay = false;
jest.mock("../db", () => {
  const request = () => {
    const r = { input() { return r; }, async query(q) {
      if (/ApprovalRaiserRule/.test(q)) return { recordset: [{ RaiserMayApprove: mockRaiserMay }] };
      // Approval Setup names the admin role, so the approver gate passes and
      // maker-checker is what's under test.
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

describe("maker-checker", () => {
  test("the person who raised a refund can't approve it", async () => {
    mockMaker = 7;
    await expect(transition("crm-refunds", 1, "Approved", "a@x.com", "admin", null, 7))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/someone else has to approve/) });
  });
  test("the same applies to cancellations and brokerage", async () => {
    mockMaker = 9;
    for (const m of ["crm-cancellations", "crm-brokerage"]) {
      await expect(transition(m, 1, "Approved", "a@x.com", "admin", null, 9)).rejects.toMatchObject({ status: 403 });
    }
  });
  test("when Approval Setup lets the raiser approve, they get past the check", async () => {
    mockMaker = 7; mockRaiserMay = true;
    await expect(transition("crm-resales", 1, "Approved", "a@x.com", "admin", null, 7))
      .rejects.not.toMatchObject({ status: 403 });
    mockRaiserMay = false;
  });
  test("with the setting off the same resale is refused", async () => {
    mockMaker = 7; mockRaiserMay = false;
    await expect(transition("crm-resales", 1, "Approved", "a@x.com", "admin", null, 7)).rejects.toMatchObject({ status: 403 });
  });
  test("a different approver gets past the check", async () => {
    mockMaker = 7;
    // Gets beyond maker-checker into the transaction (which the fake pool can't open).
    await expect(transition("crm-refunds", 1, "Approved", "b@x.com", "admin", null, 8))
      .rejects.not.toMatchObject({ status: 403 });
  });
});
