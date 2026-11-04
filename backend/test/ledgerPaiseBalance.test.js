process.env.NODE_ENV = "test";

/**
 * Ledger postings balance to the paisa by construction (services/generalLedger.js):
 * - an expense booking split across heads, whose heads differ from the invoice total by its round-off
 *   (up to 50 paise, what the booking screen allows): the last head carries the exact rest, so approving it
 *   no longer fails with "does not balance";
 * - every leg is stored as what the voucher was checked against.
 */
const mockInserted = [];
let mockAllocations = [];
jest.mock("../db", () => {
  const sql = require("mssql");
  const request = () => {
    const r = {
      inputs: {},
      input(n, _t, v) { r.inputs[n] = v; return r; },
      async query(q) {
        if (/FROM dbo\.GeneralLedgerEntry WHERE SourceType = @SourceType/.test(q)) return { recordset: [] }; // not posted yet
        if (/FROM dbo\.ExpenseBooking eb/.test(q)) {
          return { recordset: [{ Eid: 7, EDocNo: "DINV/7", EDocDate: "2026-11-04", EAmount: 1000, ENetAmount: 1180.4,
            ESourceType: "Direct", ESourceId: null, EName: "Acme", ECompanyId: 2, EProjectName: null, EBillingTermsData: null, LHeadId: 55 }] };
        }
        if (/FROM dbo\.AccountHeadMaster/.test(q)) return { recordset: [{ LHeadId: 900 }] };
        if (/INSERT INTO dbo\.GeneralLedgerEntry/.test(q)) { mockInserted.push({ debit: r.inputs.DebitAmount, credit: r.inputs.CreditAmount, head: r.inputs.LHeadId }); return { recordset: [] }; }
        return { recordset: [] };
      },
    };
    return r;
  };
  const tx = { begin: async () => {}, commit: async () => {}, rollback: async () => {}, request };
  return { sql, getPool: () => ({ request, transaction: () => tx }) };
});
jest.mock("../services/expenseHeadAllocation", () => ({ getAllocations: async () => mockAllocations }));

const { postExpenseBookingApproval } = require("../services/generalLedger");
const { getPool } = require("../db");
const totals = () => mockInserted.reduce((t, l) => ({ dr: Math.round((t.dr + l.debit) * 100) / 100, cr: Math.round((t.cr + l.credit) * 100) / 100 }), { dr: 0, cr: 0 });

beforeEach(() => { mockInserted.length = 0; });

test("heads 40 paise short of the invoice total (its round-off): posts, balanced, last head carries the rest", async () => {
  mockAllocations = [{ lHeadId: 11, amount: 600, lHeadName: "Cement" }, { lHeadId: 12, amount: 580, lHeadName: "Steel" }]; // 1180.00 vs 1180.40
  const res = await postExpenseBookingApproval(getPool(), 7, "a@b.c");
  expect(res.reason).toBeUndefined();
  const { dr, cr } = totals();
  expect(dr).toBe(1180.4);
  expect(cr).toBe(1180.4);
  expect(mockInserted.find((l) => l.head === 11).debit).toBe(600);  // entered as is
  expect(mockInserted.find((l) => l.head === 12).debit).toBe(580.4); // the rest
});

test("heads that already add up exactly post exactly as entered", async () => {
  mockAllocations = [{ lHeadId: 11, amount: 600.2, lHeadName: "Cement" }, { lHeadId: 12, amount: 580.2, lHeadName: "Steel" }];
  await postExpenseBookingApproval(getPool(), 7, "a@b.c");
  expect(mockInserted.find((l) => l.head === 11).debit).toBe(600.2);
  expect(mockInserted.find((l) => l.head === 12).debit).toBe(580.2);
  expect(totals()).toEqual({ dr: 1180.4, cr: 1180.4 });
});

// postVoucher: a voucher is stored only if its rounded legs balance to the paisa.
const { postVoucher } = require("../services/generalLedger");
describe("postVoucher balances to the paisa", () => {
  const post = (legs) => postVoucher(getPool(), { voucherNo: "T-1", voucherDate: "2026-11-04", sourceType: "Test", sourceId: 1, legs });

  test("a voucher off by one paisa is refused (it used to post)", async () => {
    await expect(post([{ lHeadId: 1, debit: 100 }, { lHeadId: 2, credit: 99.99 }])).rejects.toThrow(/does not balance/);
    expect(mockInserted).toHaveLength(0);
  });

  test("legs that only balance before rounding are refused, not stored out of balance", async () => {
    // 0.005 + 0.005 = 0.01 unrounded, but each leg stores as 0.01 → 0.02 against 0.01.
    await expect(post([{ lHeadId: 1, debit: 0.005 }, { lHeadId: 2, debit: 0.005 }, { lHeadId: 3, credit: 0.01 }])).rejects.toThrow(/does not balance/);
  });

  test("a balanced voucher posts as is, including float dust", async () => {
    await post([{ lHeadId: 1, debit: 0.1 + 0.2 }, { lHeadId: 2, credit: 0.3 }]);
    expect(mockInserted).toEqual([{ debit: 0.3, credit: 0, head: 1 }, { debit: 0, credit: 0.3, head: 2 }]);
  });
});
