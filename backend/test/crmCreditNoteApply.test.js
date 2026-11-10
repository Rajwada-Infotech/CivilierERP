// (Scenario tests kept alongside crmCreditNoteAdjustment.test.js.)
// A credit note without a refund, approved on a milestone the customer has
// already paid: the milestone comes down, the extra moves to the customer's
// account (an offsetting receipt line + an on-account credit), the booking's
// credited total goes up. On an unpaid milestone nothing moves.
let mockState;
jest.mock("../db", () => {
  class Transaction {
    async begin() {}
    async commit() {}
    async rollback() {}
    request() { return mockReq(); }
  }
  function mockReq() {
    const inputs = {};
    const req = {
      input(k, _t, v) { inputs[k] = v; return req; },
      async query(q) {
        mockState.log.push({ q, inputs: { ...inputs } });
        if (/FROM dbo\.CrmGstNote WITH \(UPDLOCK\)/.test(q)) return { recordset: [mockState.note] };
        if (/FROM dbo\.CrmPaymentMilestone WITH \(UPDLOCK\)/.test(q)) return { recordset: mockState.plan || [mockState.milestone] };
        if (/SELECT InvoiceType FROM dbo\.CrmInvoice/.test(q)) return { recordset: [{ InvoiceType: mockState.invoiceType }] };
        if (/SELECT Amount, AppliedAmount, Status FROM dbo\.CrmOnAccountPayment/.test(q)) return { recordset: [{ Amount: 1, AppliedAmount: 0, Status: "Unapplied" }] };
        if (/INSERT INTO dbo\.CrmOnAccountPayment/.test(q)) return { recordset: [{ Id: 77 }] };
        return { recordset: [] };
      },
    };
    return req;
  }
  return { sql: { Int: "Int", NVarChar: () => "NVarChar", Date: "Date", Decimal: () => "Decimal", Transaction }, getPool: () => ({}) };
});
jest.mock("../services/crmLedger", () => ({ getGstSplit: async () => ({ gstAmount: 0, baseAmount: 0 }), ensureCrmCustomerLedgerHead: async () => 1 }));
jest.mock("../services/docNumber", () => ({ getNextDocNumber: async () => "CRN-2026-00009" }));
jest.mock("../services/crmGst", () => ({ recalculateBookingGst: async () => {} }));
jest.mock("../services/generalLedger", () => ({ hasPosting: async () => true, postVoucher: async () => {}, reversePostingBySource: async () => {} }));
jest.mock("../services/approvalService", () => ({ transition: async (_m, _id, target) => ({ newStatus: target }) }));

const gst = require("../services/crmGstNotes");
const pool = { request() { return new (require("../db").sql.Transaction)().request(); } };
// load() reads the note back through the pool: answer with the note, as issued.
const noteRow = (extra = {}) => ({ Id: 5, Source: "Adjustment", Status: "Pending", BookingId: 3, InvoiceId: 9, MilestoneId: 4, TotalAmount: 30000, GstAmount: 1428.57,
  TaxableValue: 28571.43, CustomerId: 1, InvoiceDate: "2026-06-01", InvoiceType: "Milestone", OpenAmount: 100000, OpenRequests: 0,
  BookingActive: true, BookingStatus: "Approved", ...extra });

beforeEach(() => { mockState = { log: [], note: noteRow(), milestone: { Id: 4, AmountDue: 100000, AmountPaid: 100000, MilestoneName: "Slab 1" } }; });

const find = (re) => mockState.log.filter((l) => re.test(l.q));

test("paid milestone: the extra moves to the customer's account", async () => {
  // decideAdjustment -> applyAdjustment, with every read answered by the mocks.
  const origQuery = pool.request;
  pool.request = () => {
    const r = origQuery();
    const q = r.query;
    r.query = async (sqlText) => (/FROM dbo\.CrmGstNote n/.test(sqlText) || /FROM dbo\.CrmInvoice i JOIN/.test(sqlText)
      ? { recordset: [noteRow()] } : q(sqlText));
    return r;
  };
  await gst.decideAdjustment(pool, 5, true, null, { email: "a@x", userId: 2 });
  const booking = find(/UPDATE dbo\.CrmBooking SET CreditNoteTotal/)[0];
  expect(booking.inputs).toMatchObject({ t: 30000, g: 1428.57 });
  const offset = find(/INSERT INTO dbo\.CrmPaymentReceipt/)[0];
  expect(offset.inputs).toMatchObject({ amt: -30000, no: "CRN-2026-00009" });
  const credit = find(/INSERT INTO dbo\.CrmOnAccountPayment/)[0];
  expect(credit.inputs).toMatchObject({ amt: 30000 });
  expect(find(/UPDATE dbo\.CrmPaymentMilestone SET AmountDue/)[0].inputs).toMatchObject({ due: 70000 });
  expect(find(/SET DocNo = @no, Status = N'Issued'/)[0].inputs).toMatchObject({ no: "CRN-2026-00009", mv: 30000, oa: 77 });
  pool.request = origQuery;
});

test("unpaid milestone: due comes down, nothing moves to the account", async () => {
  mockState.milestone = { Id: 4, AmountDue: 100000, AmountPaid: 20000, MilestoneName: "Slab 1" };
  const origQuery = pool.request;
  pool.request = () => {
    const r = origQuery();
    const q = r.query;
    r.query = async (sqlText) => (/FROM dbo\.CrmGstNote n/.test(sqlText) || /FROM dbo\.CrmInvoice i JOIN/.test(sqlText)
      ? { recordset: [noteRow()] } : q(sqlText));
    return r;
  };
  await gst.decideAdjustment(pool, 5, true, null, { email: "a@x", userId: 2 });
  expect(find(/INSERT INTO dbo\.CrmPaymentReceipt/)).toHaveLength(0);
  expect(find(/INSERT INTO dbo\.CrmOnAccountPayment/)).toHaveLength(0);
  expect(find(/UPDATE dbo\.CrmPaymentMilestone SET AmountDue/)[0].inputs).toMatchObject({ due: 70000 });
  pool.request = origQuery;
});

test("partly paid above the new amount: only the part above moves", async () => {
  mockState.milestone = { Id: 4, AmountDue: 100000, AmountPaid: 85000, MilestoneName: "Slab 1" };
  const origQuery = pool.request;
  pool.request = () => {
    const r = origQuery();
    const q = r.query;
    r.query = async (sqlText) => (/FROM dbo\.CrmGstNote n/.test(sqlText) || /FROM dbo\.CrmInvoice i JOIN/.test(sqlText)
      ? { recordset: [noteRow()] } : q(sqlText));
    return r;
  };
  await gst.decideAdjustment(pool, 5, true, null, { email: "a@x", userId: 2 });
  expect(find(/INSERT INTO dbo\.CrmOnAccountPayment/)[0].inputs).toMatchObject({ amt: 15000 });
  pool.request = origQuery;
});

describe("a credit note on a Final invoice", () => {
  const answerNote = (note) => {
    const orig = pool.request;
    pool.request = () => {
      const r = orig();
      const q = r.query;
      r.query = async (t) => (/FROM dbo\.CrmGstNote n/.test(t) || /FROM dbo\.CrmInvoice i JOIN/.test(t) ? { recordset: [note] } : q(t));
      return r;
    };
    return () => { pool.request = orig; };
  };
  const final = { MilestoneId: null, InvoiceType: "Final", OpenAmount: 200000, TotalAmount: 150000, GstAmount: 7142.86, TaxableValue: 142857.14 };

  test("comes off the milestones last first, and the customer gets one refundable credit for all of it", async () => {
    mockState.note = noteRow(final);
    mockState.invoiceType = "Final";
    mockState.plan = [{ Id: 7, AmountDue: 100000, AmountPaid: 100000, MilestoneName: "Possession" }, { Id: 6, AmountDue: 100000, AmountPaid: 100000, MilestoneName: "Slab" }];
    const restore = answerNote(noteRow(final));
    await gst.decideAdjustment(pool, 5, true, null, { email: "a@x", userId: 2 });
    restore();
    expect(find(/INSERT INTO dbo\.CrmPaymentReceipt/).map((l) => [l.inputs.m, l.inputs.amt])).toEqual([[7, -100000], [6, -50000]]);
    expect(find(/UPDATE dbo\.CrmPaymentMilestone SET AmountDue/).map((l) => [l.inputs.m, l.inputs.due])).toEqual([[7, 0], [6, 50000]]);
    expect(find(/INSERT INTO dbo\.CrmOnAccountPayment/)).toHaveLength(1);
    expect(find(/INSERT INTO dbo\.CrmOnAccountPayment/)[0].inputs).toMatchObject({ amt: 150000 });
    const issued = find(/SET DocNo = @no, Status = N'Issued'/)[0].inputs;
    expect(issued).toMatchObject({ mv: 150000, dr: 150000, oa: 77 });
    expect(JSON.parse(issued.sp)).toEqual([{ m: 7, reduced: 100000, moved: 100000 }, { m: 6, reduced: 50000, moved: 50000 }]);
  });

  test("cancelling it puts every milestone back and withdraws the credit once", async () => {
    const issued = noteRow({ ...final, Status: "Issued", DocNo: "CRN-1", CancelApprovalStatus: "Pending", CancelRequestReason: "Raised in error", OnAccountId: 77, MovedToAccount: 150000, DueReducedBy: 150000,
      MilestoneSpread: JSON.stringify([{ m: 7, reduced: 100000, moved: 100000 }, { m: 6, reduced: 50000, moved: 50000 }]) });
    const restore = answerNote(issued);
    await gst.decideCancel(pool, 5, true, null, { email: "a@x", userId: 2 });
    restore();
    expect(find(/INSERT INTO dbo\.CrmPaymentReceipt/).map((l) => [l.inputs.m, l.inputs.amt])).toEqual([[7, 100000], [6, 50000]]);
    expect(find(/UPDATE dbo\.CrmPaymentMilestone SET AmountDue = AmountDue \+ @t/).map((l) => [l.inputs.m, l.inputs.t])).toEqual([[7, 100000], [6, 50000]]);
    expect(find(/SET AppliedAmount = Amount, Status = N'Applied'/)).toHaveLength(1);
  });

  test("a Final note issued before this change has no spread, so cancelling it moves no milestone", async () => {
    const old = noteRow({ ...final, Status: "Issued", DocNo: "CRN-2", CancelApprovalStatus: "Pending", CancelRequestReason: "Raised in error" });
    const restore = answerNote(old);
    await gst.decideCancel(pool, 5, true, null, { email: "a@x", userId: 2 });
    restore();
    expect(find(/UPDATE dbo\.CrmPaymentMilestone SET AmountDue/)).toHaveLength(0);
  });
});
