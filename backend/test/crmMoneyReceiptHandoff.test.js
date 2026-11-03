process.env.NODE_ENV = "test";

/**
 * The booking-amount money receipt has no approval of its own
 * (services/crmMoneyReceiptWorkflow.js):
 * - it is sent to Finance only once the Director has approved the booking —
 *   before that the booking can still be deleted, which cancels the receipt;
 * - sending it links the Finance Received Payment but leaves the receipt
 *   Pending, so its status follows Finance;
 * - Finance's approval of that payment is what marks the receipt Approved.
 */
const mockState = { stage: "DirectorApproval", queries: [] };

jest.mock("../db", () => {
  const request = () => {
    const r = {
      input: () => r,
      query: async (q) => {
        mockState.queries.push(q);
        if (q.includes("FROM dbo.CrmMoneyReceipt mr WITH (UPDLOCK")) {
          return { recordset: [{ Id: 9, BookingId: 5, Amount: 10000, Status: "Pending", ReceivedPaymentId: null, WorkflowStage: mockState.stage, ApplicationId: 3 }] };
        }
        if (q.includes("SELECT Id FROM dbo.CrmMoneyReceipt WHERE ReceivedPaymentId")) return { recordset: [{ Id: 9 }] };
        return { recordset: [], rowsAffected: [1] };
      },
    };
    return r;
  };
  class Transaction {
    begin() { return Promise.resolve(); }
    commit() { return Promise.resolve(); }
    rollback() { return Promise.resolve(); }
    request() { return request(); }
  }
  return { sql: new Proxy({ Transaction }, { get: (t, k) => (k in t ? t[k] : () => "type") }), getPool: () => ({ request }) };
});
jest.mock("../services/moneyReceiptPdf", () => ({
  generateMoneyReceiptPdf: jest.fn(async () => {}),
  getMoneyReceiptByReceivedPaymentId: async () => ({ Id: 9 }),
}));
jest.mock("../routes/receivedPayment", () => ({
  createReceivedPaymentInternal: jest.fn(async () => ({ RPPaymentID: 77, RPDocNo: "RP-77" })),
  invalidateReceivedPaymentWorkflowCaches: jest.fn(async () => {}),
}));

const { sendMoneyReceiptToFinance, ensureMoneyReceiptForApprovedPayment } = require("../services/crmMoneyReceiptWorkflow");
const { createReceivedPaymentInternal } = require("../routes/receivedPayment");
const { getPool } = require("../db");

beforeEach(() => { mockState.queries.length = 0; createReceivedPaymentInternal.mockClear(); });

test("not sent to Finance before the Director approves the booking", async () => {
  mockState.stage = "DirectorApproval";
  await expect(sendMoneyReceiptToFinance(getPool(), 9, 1, "a@b.c")).rejects.toThrow(/when the Director approves/);
  expect(createReceivedPaymentInternal).not.toHaveBeenCalled();
});

test("sent once confirmed: linked to Finance, but left Pending so its status follows Finance", async () => {
  mockState.stage = "Confirmed";
  const res = await sendMoneyReceiptToFinance(getPool(), 9, 1, "a@b.c");
  expect(res).toMatchObject({ success: true, ReceivedPaymentId: 77 });
  const link = mockState.queries.find((q) => q.includes("UPDATE dbo.CrmMoneyReceipt SET") && q.includes("ReceivedPaymentId = @rpid"));
  expect(link).toBeDefined();
  expect(link).not.toMatch(/Status = 'Approved'/);
});

test("Finance approving the payment marks the receipt Approved", async () => {
  await ensureMoneyReceiptForApprovedPayment(getPool(), 77, 1);
  expect(mockState.queries.some((q) => /SET Status = 'Approved'/.test(q) && /Status = 'Pending'/.test(q))).toBe(true);
});
