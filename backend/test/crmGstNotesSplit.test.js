// (Scenario tests kept alongside crmGstNotes.test.js.)
// A paid refund's GST documents: the part never invoiced -> refund voucher,
// the invoiced part -> credit notes against the invoices (latest first), and a
// credit note past 30 November after the invoice's financial year is
// time-barred (no number; the buyer claims the GST).
let mockDb;
// The documents are written in one transaction: it reuses the same fake requests.
jest.mock("../db", () => {
  class Transaction {
    constructor(pool) { this.pool = pool; }
    async begin() {}
    async commit() {}
    async rollback() {}
    request() { return this.pool.request(); }
  }
  return { sql: { Int: "Int", NVarChar: () => "NVarChar", Date: "Date", Decimal: () => "Decimal", Transaction }, getPool: () => ({}) };
});
jest.mock("../services/crmLedger", () => ({
  // 5% GST inside the amount, as getGstSplit does from the booking.
  getGstSplit: async (_p, _b, amt) => { const g = Math.round(amt * (5 / 105) * 100) / 100; return { gstAmount: g, baseAmount: Math.round((amt - g) * 100) / 100 }; },
}));
let mockSeq = 0;
jest.mock("../services/docNumber", () => ({ getNextDocNumber: async (_p, t) => `${t}-2026-${String(++mockSeq).padStart(5, "0")}` }));
const gst = require("../services/crmGstNotes");

const pool = {
  request() {
    const inputs = {};
    const req = {
      input(k, _t, v) { inputs[k] = v; return req; },
      async query(q) {
        if (/COUNT\(\*\) AS n FROM dbo\.CrmGstNote/.test(q)) return { recordset: [{ n: 0 }] };
        if (/FROM dbo\.CrmRefund r LEFT JOIN dbo\.CrmBooking/.test(q)) return { recordset: [mockDb.refund] };
        if (/AS Received/.test(q)) return { recordset: [mockDb.sums] };
        if (/UnitParkingGstRate, 0\) AS Rate/.test(q)) return { recordset: [{ Rate: 5, Gst: 0, Grand: 0 }] };
        if (/FROM dbo\.CrmInvoice i/.test(q)) return { recordset: mockDb.invoices };
        if (/FROM dbo\.CrmOnAccountPayment/.test(q)) return { recordset: [{ No: "OACC-1", RPDocDate: "2026-04-10" }] };
        if (/INSERT INTO dbo\.CrmGstNote/.test(q)) { mockDb.inserted.push({ ...inputs }); return { recordset: [{ Id: mockDb.inserted.length }] }; }
        return { recordset: [] };
      },
    };
    return req;
  },
};
const refund = (net, paidAt = "2026-10-13") => ({ Id: 7, RefundNo: "CRFD-1", BookingId: 3, CustomerId: 1, NetAmount: net, DeductionAmount: 0, Status: "Paid", PaidAt: paidAt });

beforeEach(() => { mockSeq = 0; });

test("extra money on account (more received than invoiced): one refund voucher", async () => {
  mockDb = { refund: refund(10500), sums: { Received: 110500, Invoiced: 100000, PriorVouchers: 0, PriorKept: 0 }, invoices: [], inserted: [] };
  const out = await gst.issueForRefund(pool, 7, "f@x");
  expect(out.issued).toHaveLength(1);
  expect(mockDb.inserted[0]).toMatchObject({ t: "RefundVoucher", no: "RFV-2026-00001", tot: 10500, g: 500, tv: 10000, ag: "OACC-1" });
});

test("cancelled after invoicing: voucher for the uninvoiced part, credit notes latest invoice first", async () => {
  mockDb = {
    refund: refund(70000),
    sums: { Received: 110000, Invoiced: 100000, PriorVouchers: 0, PriorKept: 0 },
    invoices: [{ Id: 2, InvoiceNo: "INV-2", InvoiceDate: "2026-06-01", OpenAmount: 40000 }, { Id: 1, InvoiceNo: "INV-1", InvoiceDate: "2026-05-01", OpenAmount: 60000 }],
    inserted: [],
  };
  await gst.issueForRefund(pool, 7, "f@x");
  const [v, c2, c1] = mockDb.inserted;
  expect(v).toMatchObject({ t: "RefundVoucher", tot: 10000 });
  expect(c2).toMatchObject({ t: "CreditNote", inv: 2, tot: 40000, st: "Issued", dl: "2027-11-30" });
  expect(c1).toMatchObject({ t: "CreditNote", inv: 1, tot: 20000, st: "Issued" });
  // The GST shares add up exactly to the refund's GST.
  expect(Math.round((v.g + c2.g + c1.g) * 100) / 100).toBe(Math.round(70000 * (5 / 105) * 100) / 100);
});

test("invoice from an old year, past 30 November: time-barred, no credit note number", async () => {
  mockDb = {
    refund: refund(21000, "2026-12-15"),
    sums: { Received: 100000, Invoiced: 100000, PriorVouchers: 0, PriorKept: 0 },
    invoices: [{ Id: 1, InvoiceNo: "INV-1", InvoiceDate: "2025-03-20", OpenAmount: 100000 }],
    inserted: [],
  };
  await gst.issueForRefund(pool, 7, "f@x");
  expect(mockDb.inserted[0]).toMatchObject({ t: "CreditNote", st: "TimeBarred", no: null, dl: "2025-11-30" });
});

test("deadline: 30 November after the invoice's April–March year", () => {
  expect(gst.creditNoteDeadline("2026-04-01")).toBe("2027-11-30");
  expect(gst.creditNoteDeadline("2026-03-31")).toBe("2026-11-30");
});
