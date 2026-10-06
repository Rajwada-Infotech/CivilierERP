// Maker-checker on requests that pay money out: whoever raised a cancellation
// refund, a refund or a brokerage payout can't approve it themselves.
let mockMaker = 7;
jest.mock("../db", () => {
  const request = () => {
    const r = { input() { return r; }, async query() { return { recordset: [{ Maker: mockMaker }] }; } };
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
  test("a different approver gets past the check", async () => {
    mockMaker = 7;
    // Gets beyond maker-checker into the transaction (which the fake pool can't open).
    await expect(transition("crm-refunds", 1, "Approved", "b@x.com", "admin", null, 8))
      .rejects.not.toMatchObject({ status: 403 });
  });
});
