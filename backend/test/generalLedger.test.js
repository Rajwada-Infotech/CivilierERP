process.env.NODE_ENV = "test";

// db.js calls loadEnv() at require time, which throws without DB_* vars set.
// Mock it out (same approach as sanity.test.js) so we can unit-test the pure
// posting logic without a database.
jest.mock("../config/env", () => ({ loadEnv: jest.fn(), envPath: "" }));
jest.mock("../logger", () => {
  const l = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() };
  l.child = jest.fn(() => l);
  return l;
});

const { postVoucher } = require("../services/generalLedger");

// Minimal mssql-shaped mock: pool.transaction() → tx with begin/commit/
// rollback and a chainable request().input()…query().
function makeMockPool() {
  const inserted = [];
  const makeRequest = () => {
    const values = {};
    const r = {
      input: (name, _type, val) => {
        values[name] = val;
        return r;
      },
      query: async () => {
        inserted.push({ ...values });
        return { recordset: [] };
      },
    };
    return r;
  };
  const tx = {
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    request: makeRequest,
  };
  const pool = { transaction: () => tx, request: makeRequest };
  return { pool, tx, inserted };
}

describe("generalLedger.postVoucher — accounting invariants", () => {
  const base = {
    voucherNo: "V-1",
    voucherDate: "2026-07-01",
    sourceType: "NewPayment",
    sourceId: 1,
  };

  test("rejects a voucher with fewer than 2 legs", async () => {
    const { pool, tx } = makeMockPool();
    await expect(
      postVoucher(pool, { ...base, legs: [{ lHeadId: 1, debit: 100 }] }),
    ).rejects.toThrow(/at least 2 legs/);
    expect(tx.begin).not.toHaveBeenCalled();
  });

  test("rejects a voucher whose debits and credits do not balance", async () => {
    const { pool, tx } = makeMockPool();
    await expect(
      postVoucher(pool, {
        ...base,
        legs: [
          { lHeadId: 1, debit: 100 },
          { lHeadId: 2, credit: 90 },
        ],
      }),
    ).rejects.toThrow(/does not balance/);
    // Balance is checked before the transaction opens.
    expect(tx.begin).not.toHaveBeenCalled();
  });

  test("accepts a balanced voucher within a 1-cent rounding tolerance", async () => {
    const { pool, tx } = makeMockPool();
    await expect(
      postVoucher(pool, {
        ...base,
        legs: [
          { lHeadId: 1, debit: 100.004 },
          { lHeadId: 2, credit: 100 },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(tx.begin).toHaveBeenCalledTimes(1);
    expect(tx.commit).toHaveBeenCalledTimes(1);
    expect(tx.rollback).not.toHaveBeenCalled();
  });

  test("commits balanced legs and skips zero-amount legs", async () => {
    const { pool, tx, inserted } = makeMockPool();
    await postVoucher(pool, {
      ...base,
      legs: [
        { lHeadId: 1, debit: 100 },
        { lHeadId: 2, credit: 100 },
        { lHeadId: 3, debit: 0, credit: 0 }, // no-op leg — must not insert
      ],
    });
    // Only the two non-zero legs are written.
    expect(inserted.length).toBe(2);
    expect(tx.commit).toHaveBeenCalledTimes(1);
  });

  test("rolls back when a leg is missing its lHeadId", async () => {
    const { pool, tx } = makeMockPool();
    await expect(
      postVoucher(pool, {
        ...base,
        legs: [
          { debit: 100 }, // no lHeadId
          { lHeadId: 2, credit: 100 },
        ],
      }),
    ).rejects.toThrow(/no lHeadId/);
    expect(tx.rollback).toHaveBeenCalledTimes(1);
    expect(tx.commit).not.toHaveBeenCalled();
  });
});
