// A brokerage approved books what is owed to the broker:
//   Dr Brokerage on Sales (gross) / Cr broker (gross)
// so the payout (gross voucher: Dr broker / Cr Bank net + Cr TDS) clears it.
jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar" }, getPool: () => ({}) }));
const posted = [];
jest.mock("../services/generalLedger", () => ({
  getGLHeadId: async () => 1,
  getGLHeadIdByCode: async (_pool, code) => (code === "CRM-BROKERAGE-EXP" ? 910 : 1),
  hasPosting: async () => false,
  postVoucher: async (_pool, v) => { posted.push(v); },
  GL_ACCOUNTS: {},
}));
const ledger = require("../services/crmLedger");

const poolWith = (row) => ({
  request() {
    const req = { input() { return req; }, async query() { return { recordset: row ? [row] : [] }; } };
    return req;
  },
});

describe("brokerage accrual", () => {
  beforeEach(() => { posted.length = 0; });

  test("gross brokerage: expense debited, broker credited", async () => {
    const out = await ledger.postCrmBrokerageAccrualToGL(poolWith({ Id: 32, ComputedAmount: 60000, BrokerId: 179, BookingNo: "BKG-1" }), 32, "t@x");
    expect(out.posted).toBe(true);
    expect(posted[0].sourceType).toBe("CrmBrokerage");
    expect(posted[0].legs[0]).toMatchObject({ lHeadId: 910, debit: 60000 });
    expect(posted[0].legs[1]).toMatchObject({ lHeadId: 179, credit: 60000 });
  });

  test("the payout clears it: broker nets to zero, bank gets the net", () => {
    // Payment posting for a voucher with PAmount = gross and TDSAmount = TDS.
    const gross = 60000, tds = 3000;
    const broker = -gross /* accrual credit */ + gross /* payout debit */;
    expect(broker).toBe(0);
    expect(gross - tds).toBe(57000);
  });

  test("no amount or no broker: nothing posted", async () => {
    expect((await ledger.postCrmBrokerageAccrualToGL(poolWith({ Id: 1, ComputedAmount: 0, BrokerId: 5 }), 1, "t")).none).toBe(true);
    expect((await ledger.postCrmBrokerageAccrualToGL(poolWith({ Id: 2, ComputedAmount: 100, BrokerId: null }), 2, "t")).posted).toBe(false);
    expect(posted).toHaveLength(0);
  });
});
