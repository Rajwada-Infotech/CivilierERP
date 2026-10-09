// A buy-back's own journal: the difference between the agreed price and what
// the seller had paid goes to Property Buy-back Cost (premium Dr, discount Cr).
jest.mock("../db", () => ({ sql: { Int: "Int", NVarChar: () => "NVarChar" }, getPool: () => ({}) }));
const posted = [];
jest.mock("../services/generalLedger", () => ({
  getGLHeadId: async () => 1,
  getGLHeadIdByCode: async (_pool, code) => (code === "CRM-BUYBACK-COST" ? 900 : 1),
  hasPosting: async () => false,
  postVoucher: async (_pool, v) => { posted.push(v); },
  GL_ACCOUNTS: {},
}));
const ledger = require("../services/crmLedger");

const poolWith = (row) => ({
  request() {
    const req = { input() { return req; }, async query() { return { recordset: [row] }; } };
    return req;
  },
});

describe("buy-back difference", () => {
  beforeEach(() => { posted.length = 0; });
  jest.spyOn(ledger, "ensureCrmCustomerLedgerHead");

  test("premium: bought back above what was paid", async () => {
    const row = { Id: 7, AgreedValue: 3200000, PaidAtTransfer: 2500000, FromCustomerId: 5, CompletedAt: null, ProjectId: 1, CompanyId: 1, Item: "Plot 21", LHeadId: 55 };
    const out = await ledger.postCrmBuyBackDifferenceToGL(poolWith(row), 7, "t@x");
    expect(out.posted).toBe(true);
    const legs = posted[0].legs;
    expect(legs[0]).toMatchObject({ lHeadId: 900, debit: 700000 });
    expect(legs[1].credit).toBe(700000);
  });

  test("discount: bought back below what was paid", async () => {
    const row = { Id: 8, AgreedValue: 2000000, PaidAtTransfer: 2500000, FromCustomerId: 5, Item: "Plot 22", LHeadId: 55 };
    await ledger.postCrmBuyBackDifferenceToGL(poolWith(row), 8, "t@x");
    const legs = posted[0].legs;
    expect(legs[0].debit).toBe(500000);
    expect(legs[1]).toMatchObject({ lHeadId: 900, credit: 500000 });
  });

  test("bought back at exactly what was paid: nothing to post", async () => {
    const row = { Id: 9, AgreedValue: 2500000, PaidAtTransfer: 2500000, FromCustomerId: 5, Item: "Plot 23", LHeadId: 55 };
    const out = await ledger.postCrmBuyBackDifferenceToGL(poolWith(row), 9, "t@x");
    expect(out.none).toBe(true);
    expect(posted).toHaveLength(0);
  });
});
