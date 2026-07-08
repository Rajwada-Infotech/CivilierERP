process.env.NODE_ENV = "test";

/**
 * Contract on-account advance/adjustment ledger (services/contractLedger.js).
 *
 * This is the single source of truth for a contract's running unallocated
 * advance balance — every advance and every automatic FIFO adjustment is
 * one signed row in dbo.ContractLedger, and the balance is always exactly
 * SUM(Amount). These tests exercise the actual arithmetic against a fake
 * pool (no real DB), since a feature whose whole point is "no
 * miscalculations" needs its math independently verified, not just its
 * plumbing.
 */

// contractLedger.js imports db.js at the top level, which calls loadEnv() and
// throws when DB env vars are absent (as in CI without a real connection).
// Mock the db module before requiring the service so loadEnv() is never called.
jest.mock("../db", () => ({
  sql: {
    Int: "Int",
    NVarChar: "NVarChar",
    Decimal: () => "Decimal",
    DateTime: "DateTime",
    Bit: "Bit",
  },
  getPool: jest.fn(),
}));

const {
  getContractBalance,
  recordAdvance,
  autoAllocateFIFO,
  getContractSummary,
} = require("../services/contractLedger");

function makeFakePool({ balance = 0, contractAmount = 0, totalDocumented = 0 } = {}) {
  const inserted = [];
  const request = () => {
    const req = {
      input: () => req,
      query: async (text) => {
        if (/SELECT ISNULL\(SUM\(Amount\), 0\) AS Balance FROM dbo\.ContractLedger/i.test(text)) {
          return { recordset: [{ Balance: balance }] };
        }
        if (/INSERT INTO dbo\.ContractLedger/i.test(text)) {
          inserted.push(text);
          return { recordset: [], rowsAffected: [1] };
        }
        if (/SELECT ContractAmount FROM dbo\.Contract/i.test(text)) {
          return { recordset: [{ ContractAmount: contractAmount }] };
        }
        if (/TotalDocumented/i.test(text)) {
          return { recordset: [{ TotalDocumented: totalDocumented }] };
        }
        if (/TotalAdvance.*TotalAllocated.*UnallocatedBalance/is.test(text)) {
          return {
            recordset: [{ TotalAdvance: balance >= 0 ? balance : 0, TotalAllocated: 0, UnallocatedBalance: balance }],
          };
        }
        return { recordset: [] };
      },
    };
    return req;
  };
  return { request, _inserted: inserted };
}

describe("contractLedger: getContractBalance", () => {
  test("returns the raw SUM(Amount) from the ledger", async () => {
    const pool = makeFakePool({ balance: 12345.67 });
    await expect(getContractBalance(pool, 1)).resolves.toBe(12345.67);
  });

  test("returns 0 (not null/NaN) when the ledger has no rows", async () => {
    const pool = makeFakePool({ balance: 0 });
    await expect(getContractBalance(pool, 1)).resolves.toBe(0);
  });
});

describe("contractLedger: recordAdvance", () => {
  test("inserts a positive 'Advance' row for the given amount", async () => {
    const pool = makeFakePool();
    await recordAdvance(pool, {
      contractId: 1, sourceType: "ReceivedPayment", sourceId: 5, sourceDocNo: "RP-1", amount: 5000,
    });
    expect(pool._inserted).toHaveLength(1);
  });

  test("no-ops silently when contractId or amount is missing (never throws on an untagged payment)", async () => {
    const pool = makeFakePool();
    await recordAdvance(pool, { contractId: null, amount: 5000 });
    await recordAdvance(pool, { contractId: 1, amount: 0 });
    expect(pool._inserted).toHaveLength(0);
  });
});

describe("contractLedger: autoAllocateFIFO", () => {
  test("allocates the full document amount when the balance covers it", async () => {
    const pool = makeFakePool({ balance: 10000, contractAmount: 50000, totalDocumented: 3000 });
    const result = await autoAllocateFIFO(pool, {
      contractId: 1, sourceType: "SaleInvoice", sourceId: 10, sourceDocNo: "SI-1", documentAmount: 4000,
    });
    expect(result.allocatedAmount).toBe(4000);
    expect(result.remainingBalance).toBe(6000);
    expect(pool._inserted).toHaveLength(1);
  });

  test("caps allocation at the available balance — never allocates more than exists", async () => {
    const pool = makeFakePool({ balance: 1500, contractAmount: 50000, totalDocumented: 0 });
    const result = await autoAllocateFIFO(pool, {
      contractId: 1, sourceType: "SaleInvoice", sourceId: 10, sourceDocNo: "SI-1", documentAmount: 4000,
    });
    expect(result.allocatedAmount).toBe(1500);
    expect(result.remainingBalance).toBe(0);
  });

  test("allocates nothing and writes no ledger row when there is no available balance", async () => {
    const pool = makeFakePool({ balance: 0, contractAmount: 50000, totalDocumented: 0 });
    const result = await autoAllocateFIFO(pool, {
      contractId: 1, sourceType: "SaleInvoice", sourceId: 10, sourceDocNo: "SI-1", documentAmount: 4000,
    });
    expect(result.allocatedAmount).toBe(0);
    expect(pool._inserted).toHaveLength(0);
  });

  test("flags overBilled when total documented exceeds the contract amount", async () => {
    const pool = makeFakePool({ balance: 0, contractAmount: 10000, totalDocumented: 12000 });
    const result = await autoAllocateFIFO(pool, {
      contractId: 1, sourceType: "SaleInvoice", sourceId: 10, sourceDocNo: "SI-1", documentAmount: 2000,
    });
    expect(result.overBilled).toBe(true);
  });

  test("does not flag overBilled when the contract has no value set (0 = unbounded)", async () => {
    const pool = makeFakePool({ balance: 0, contractAmount: 0, totalDocumented: 999999 });
    const result = await autoAllocateFIFO(pool, {
      contractId: 1, sourceType: "SaleInvoice", sourceId: 10, sourceDocNo: "SI-1", documentAmount: 100,
    });
    expect(result.overBilled).toBe(false);
  });

  test("no-ops when contractId or documentAmount is missing", async () => {
    const pool = makeFakePool({ balance: 5000 });
    const result = await autoAllocateFIFO(pool, { contractId: null, documentAmount: 4000 });
    expect(result).toEqual({ allocatedAmount: 0, remainingBalance: 0, overBilled: false });
    expect(pool._inserted).toHaveLength(0);
  });
});

describe("contractLedger: getContractSummary", () => {
  test("derives every figure live — nothing hardcoded or cached", async () => {
    const pool = makeFakePool({ balance: 2000, contractAmount: 10000, totalDocumented: 6000 });
    const summary = await getContractSummary(pool, 1);
    expect(summary.ContractValue).toBe(10000);
    expect(summary.TotalDocumented).toBe(6000);
    expect(summary.RemainingContractValue).toBe(4000);
    expect(summary.OverBilled).toBe(false);
  });
});
