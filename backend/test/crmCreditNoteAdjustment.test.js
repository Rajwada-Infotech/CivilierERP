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
        if (/FROM dbo\.CrmPaymentMilestone WITH \(UPDLOCK\)/.test(q)) return { recordset: [mockState.milestone] };
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
  TaxableValue: 28571.43, CustomerId: 1, InvoiceDate: "2026-06-01", InvoiceType: "Milestone", OpenAmount: 100000, OpenRequests: 0, ...extra });

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
