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
const mockState = { stage: "DirectorApproval", queries: [], calls: [], unsent: null };

jest.mock("../db", () => {
  const request = () => {
    const r = {
      inputs: {},
      input: (name, _t, v) => { r.inputs[name] = v; return r; },
      query: async (q) => {
        mockState.queries.push(q);
        mockState.calls.push({ q, inputs: r.inputs });
        // refreshUnsentMoneyReceipt: the receipt not yet with Finance, and what the booking now says.
        if (q.includes("SELECT TOP 1 Id, Amount FROM dbo.CrmMoneyReceipt")) return { recordset: mockState.unsent ? [mockState.unsent] : [] };
        if (q.includes("b.BookingAmount, b.TokenValue, b.PaymentMode")) {
          return { recordset: [{ BookingId: 5, TokenValue: 50000, BookingAmount: 100000, PaymentMode: "UPI", TransactionRef: "UTR-2", DepositBankName: "HDFC Collections" }] };
        }
        if (q.includes("ISNULL(UnitParkingGstRate,0)")) return { recordset: [{ TotalGstAmount: 0, GrandTotal: 0, UnitParkingGstRate: 5 }] };
        if (/FROM dbo\.CrmMoneyReceipt\s+WITH \(UPDLOCK, HOLDLOCK\)\s+WHERE Id = @id/.test(q)) {
          return { recordset: [{ Id: 9, Status: "Pending", BookingId: 5, ReceivedPaymentId: null }] };
        }
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

const { sendMoneyReceiptToFinance, ensureMoneyReceiptForApprovedPayment, refreshUnsentMoneyReceipt } = require("../services/crmMoneyReceiptWorkflow");
const { generateMoneyReceiptPdf } = require("../services/moneyReceiptPdf");
const { createReceivedPaymentInternal } = require("../routes/receivedPayment");
const { getPool } = require("../db");

beforeEach(() => { mockState.queries.length = 0; mockState.calls.length = 0; mockState.unsent = null; createReceivedPaymentInternal.mockClear(); generateMoneyReceiptPdf.mockClear(); });

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

// A booking sent back to Data Review can have its token / payment mode corrected;
// the receipt that has not gone to Finance follows (refreshUnsentMoneyReceipt).
describe("the receipt not yet with Finance follows a corrected token", () => {
  test("redrawn from the booking: amount, mode, reference, GST split and PDF", async () => {
    mockState.unsent = { Id: 9, Amount: 25000 };
    const res = await refreshUnsentMoneyReceipt(getPool(), 5);
    expect(res).toEqual({ id: 9, from: 25000, to: 50000 });
    const upd = mockState.calls.find((c) => c.q.includes("Amount = ISNULL(@amt, Amount)"));
    expect(upd.inputs).toMatchObject({ amt: 50000, mode: "UPI", ref: "UTR-2", bank: "HDFC Collections" });
    expect(upd.q).toMatch(/ReceivedPaymentId IS NULL/);
    const split = mockState.calls.find((c) => c.q.includes("SET GSTAmount = @gst, BaseAmount = @base"));
    // 5% GST inside ₹50,000: 2,380.95 GST + 47,619.05 base.
    expect(split.inputs.gst + split.inputs.base).toBeCloseTo(50000, 2);
    expect(split.inputs.gst).toBeCloseTo(2380.95, 2);
    expect(split.q).toMatch(/ReceivedPaymentId IS NULL/);
    expect(generateMoneyReceiptPdf).toHaveBeenCalledWith(expect.anything(), 9);
  });

  test("only a receipt still Pending / Bounced and not linked to Finance is looked at", async () => {
    await refreshUnsentMoneyReceipt(getPool(), 5);
    const pick = mockState.calls.find((c) => c.q.includes("SELECT TOP 1 Id, Amount FROM dbo.CrmMoneyReceipt"));
    expect(pick.q).toMatch(/Status IN \('Pending', 'Bounced'\) AND ReceivedPaymentId IS NULL/);
  });

  test("already with Finance (or none): nothing changes", async () => {
    mockState.unsent = null;
    expect(await refreshUnsentMoneyReceipt(getPool(), 5)).toBeNull();
    expect(mockState.calls.some((c) => /UPDATE dbo\.CrmMoneyReceipt/.test(c.q))).toBe(false);
    expect(generateMoneyReceiptPdf).not.toHaveBeenCalled();
  });
});

// The application's re-submit copies a corrected token onto the booking; the
// receipt is redrawn when the booking is sent again — before the "create if
// missing" step, which would otherwise find the old receipt and keep it.
test("sending a booking again redraws its waiting receipt before anything else", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../routes/crmBookings.js"), "utf8");
  const route = src.slice(src.indexOf('"/:id/ready-for-approval"'));
  const refresh = route.indexOf("await refreshUnsentMoneyReceipt(pool, id)");
  const create = route.indexOf("await createMoneyReceiptAfterDataReview(pool, id, actor)");
  expect(refresh).toBeGreaterThan(-1);
  expect(create).toBeGreaterThan(refresh);
});
