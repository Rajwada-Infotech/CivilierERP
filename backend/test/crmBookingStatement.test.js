process.env.NODE_ENV = "test";

/**
 * Booking statement (routes/crmBookingStatement.js): every money record on a
 * booking in date order, with totals taken from getBookingFunding — so a
 * deposit later applied to a demand appears as two events but is counted once,
 * a bounced deposit is shown but never counted, and an approved receipt is not
 * listed again beside the payment it became.
 */
const express = require("express");
const request = require("supertest");

jest.mock("../middleware/apiRateLimit", () => (_req, _res, next) => next());
jest.mock("../middleware/auth", () => (req, _res, next) => {
  req.user = { userId: 7, role: "crm_user" };
  req.projectScope = global.__scope ?? null;
  next();
});
jest.mock("../middleware/requirePageRight", () => ({
  requirePageRight: () => (_req, _res, next) => next(),
}));
jest.mock("../services/crmPaymentFunding", () => ({
  onAccountWithAvailableSql: (a) => `ONACC_${a}`,
  getBookingFunding: async () => ({ requiredAmount: 1000000, milestonePaid: 300000, onAccountAvailable: 50000, totalFunded: 350000, shortfall: 650000 }),
}));

const D = (s) => new Date(`${s}T00:00:00Z`);
const mockRows = {
  booking: [{ Id: 5, BookingNo: "BK-5", ProjectId: 3 }],
  milestones: [
    { Id: 1, MilestoneName: "On booking", DueDate: D("2026-09-01"), AmountDue: 200000, AmountPaid: 200000, Status: "Paid", DemandStatus: "Paid", DemandNo: "DM-1", DemandDate: D("2026-09-01") },
    { Id: 2, MilestoneName: "Plinth", DueDate: D("2026-10-01"), AmountDue: 300000, AmountPaid: 100000, Status: "Partially Paid", DemandStatus: "Demanded", DemandNo: "DM-2", DemandDate: D("2026-10-01") },
    { Id: 3, MilestoneName: "Roof", DueDate: D("2027-01-01"), AmountDue: 500000, AmountPaid: 0, Status: "Pending", DemandStatus: "Pending", DemandNo: null, DemandDate: null },
    { Id: 4, MilestoneName: "Waived fee", DueDate: D("2026-09-15"), AmountDue: 9999, AmountPaid: 0, Status: "Waived", DemandStatus: "Demanded", DemandNo: "DM-4", DemandDate: D("2026-09-15") },
  ],
  payments: [
    { Id: 10, ReceiptNo: "PR-10", Amount: 200000, ReceivedDate: D("2026-09-02"), PaymentMode: "NEFT", TransactionRef: "T1", OnAccountPaymentId: null, MilestoneName: "On booking" },
    { Id: 11, ReceiptNo: "PR-11", Amount: 100000, ReceivedDate: D("2026-10-03"), PaymentMode: null, TransactionRef: null, OnAccountPaymentId: 20, MilestoneName: "Plinth" },
  ],
  deposits: [
    { Id: 20, ReceiptNo: "OA-20", Amount: 150000, AppliedAmount: 100000, AvailableAmount: 50000, Status: "Partially Applied", ReceivedDate: D("2026-09-20"), PaymentMode: "Cheque", TransactionRef: "C9" },
    { Id: 21, ReceiptNo: "OA-21", Amount: 70000, AppliedAmount: 0, AvailableAmount: 0, Status: "Bounced", ReceivedDate: D("2026-10-10"), PaymentMode: "Cheque", TransactionRef: "C10" },
  ],
  receipts: [{ Id: 30, ReceiptNo: "MR-30", Amount: 25000, ReceivedDate: D("2026-10-20"), PaymentMode: "UPI", TransactionRef: "U1", Status: "Pending" }],
  refunds: [],
};
jest.mock("../db", () => ({
  sql: { Int: "Int" },
  getPool: () => ({
    request: () => {
      const r = {
        input: () => r,
        query: async (q) => {
          if (q.includes("FROM dbo.CrmBooking WHERE") || /ProjectId/.test(q)) return { recordset: mockRows.booking };
          if (q.includes("FROM dbo.CrmPaymentReceipt")) return { recordset: mockRows.payments };
          if (q.includes("FROM dbo.CrmPaymentMilestone WHERE")) return { recordset: mockRows.milestones };
          if (q.includes("ONACC_o")) return { recordset: mockRows.deposits };
          if (q.includes("FROM dbo.CrmMoneyReceipt")) return { recordset: mockRows.receipts };
          if (q.includes("FROM dbo.CrmRefund")) return { recordset: mockRows.refunds };
          throw new Error(`unexpected query: ${q}`);
        },
      };
      return r;
    },
  }),
}));

const app = express();
app.use("/statement", require("../routes/crmBookingStatement"));

beforeEach(() => { global.__scope = null; });

test("totals come from the booking's funding, demands from their own due minus paid", async () => {
  const res = await request(app).get("/statement/5");
  expect(res.status).toBe(200);
  expect(res.body.totals).toEqual({
    price: 1000000, paid: 300000, onAccount: 50000, balance: 650000,
    demandedOpen: 200000, // Plinth 300000 - 100000; On booking fully paid; waived ignored
    awaitingApproval: 25000,
  });
});

test("events in date order; an applied deposit is an event, not new money; waived and undemanded are not demands", async () => {
  const res = await request(app).get("/statement/5");
  const e = res.body.entries;
  expect(e.map((x) => `${x.date} ${x.kind} ${x.ref}`)).toEqual([
    "2026-09-01 demand DM-1",
    "2026-09-02 payment PR-10",
    "2026-09-20 deposit OA-20",
    "2026-10-01 demand DM-2",
    "2026-10-03 applied PR-11",
    "2026-10-10 void OA-21",
    "2026-10-20 awaiting MR-30",
  ]);
  expect(e.find((x) => x.ref === "OA-20").detail).toBe("Cheque · C9 · ₹1,00,000 applied · ₹50,000 still available");
  expect(res.body.upcoming).toEqual([{ text: "Roof", dueDate: "2027-01-01", amount: 500000, paid: 0 }]);
});

test("a booking outside the user's projects is refused (shared CRM guard)", async () => {
  global.__scope = [9];
  const res = await request(app).get("/statement/5");
  expect(res.status).toBe(403);
});
