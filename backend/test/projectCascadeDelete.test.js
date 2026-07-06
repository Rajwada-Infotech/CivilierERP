process.env.NODE_ENV = "test";

/**
 * Project cascade delete (services/projectCascadeDelete.js).
 *
 * This is the super-admin-only "delete a project and everything under it"
 * feature. Given how destructive and irreversible it is, the two properties
 * that matter most are:
 *   1. Atomicity — if ANY single delete in the ~40-table pipeline throws
 *      (an FK constraint we didn't account for, a transient DB error), the
 *      whole operation rolls back instead of leaving a half-deleted project.
 *   2. It runs to completion and commits on the happy path, returning a
 *      summary of what was deleted.
 *
 * The mssql pool/transaction is faked rather than hitting a real DB: a
 * generic query-text dispatcher classifies each call as SELECT (returns an
 * empty or seeded recordset) or DELETE/UPDATE (returns rowsAffected), so the
 * whole ~40-query pipeline runs without needing to hand-mock every call.
 */

const { deleteProjectCascade } = require("../services/projectCascadeDelete");

function makeFakeTx({ seeded = {}, seededDeletes = {}, failOnQueryMatching = null } = {}) {
  const calls = [];
  const tx = {
    committed: false,
    rolledBack: false,
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {
      tx.committed = true;
    }),
    rollback: jest.fn(async () => {
      tx.rolledBack = true;
    }),
    request: () => {
      const inputs = {};
      const req = {
        input: (name, _type, value) => {
          inputs[name] = value;
          return req;
        },
        query: async (text) => {
          calls.push(text);
          if (failOnQueryMatching && failOnQueryMatching.test(text)) {
            throw new Error("Simulated failure: " + failOnQueryMatching);
          }
          const trimmed = text.trim();
          if (/^SELECT/i.test(trimmed)) {
            for (const [pattern, rows] of Object.entries(seeded)) {
              if (new RegExp(pattern).test(text)) return { recordset: rows };
            }
            return { recordset: [] };
          }
          // DELETE / UPDATE — real SQL Server reports 0 rows affected when
          // nothing matches the WHERE clause, so the fake must too, or every
          // count() call in the pipeline would falsely report 1 row deleted.
          for (const [pattern, n] of Object.entries(seededDeletes)) {
            if (new RegExp(pattern).test(text)) return { recordset: [], rowsAffected: [n] };
          }
          return { recordset: [], rowsAffected: [0] };
        },
      };
      return req;
    },
  };
  return { tx, calls };
}

describe("deleteProjectCascade", () => {
  test("commits and returns an empty summary when the project has nothing linked", async () => {
    const { tx } = makeFakeTx();
    const pool = { transaction: () => tx };

    const summary = await deleteProjectCascade(pool, 42, "Empty Test Project");

    expect(tx.commit).toHaveBeenCalledTimes(1);
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(summary).toEqual({});
  });

  test("cascades through Purchase Order -> GRN -> Expense Booking -> Payment and reports counts", async () => {
    const { tx, calls } = makeFakeTx({
      seeded: {
        "FROM dbo\\.PurchaseOrders WHERE ProjectId": [{ PurchaseOrderID: 501 }],
        "FROM dbo\\.GoodsReceiptNotes WHERE POID": [{ GRNID: 901 }],
        "FROM dbo\\.ExpenseBooking WHERE": [{ EId: 71, EDocNo: "ExB/INV/000099" }],
        "FROM dbo\\.NewPayment WHERE PExpenseRef": [{ PPaymentID: 33 }],
      },
      seededDeletes: {
        "DELETE FROM dbo\\.PurchaseOrders WHERE PurchaseOrderID": 1,
        "DELETE FROM dbo\\.GoodsReceiptNotes WHERE GRNID": 1,
        "DELETE FROM dbo\\.ExpenseBooking WHERE EId": 1,
        "DELETE FROM dbo\\.NewPayment WHERE PPaymentID": 1,
      },
    });
    const pool = { transaction: () => tx };

    const summary = await deleteProjectCascade(pool, 7, "Linked Test Project");

    expect(tx.commit).toHaveBeenCalledTimes(1);
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(summary.PurchaseOrders).toBe(1);
    expect(summary.GoodsReceiptNotes).toBe(1);
    expect(summary.ExpenseBooking).toBe(1);
    expect(summary.NewPayment).toBe(1);

    // The GRN lookup must be scoped to the POIDs actually found for this
    // project, not run unconditionally.
    expect(calls.some((c) => /FROM dbo\.GoodsReceiptNotes WHERE POID/.test(c))).toBe(true);
  });

  test("rolls back the entire transaction if any single delete fails mid-pipeline", async () => {
    const { tx } = makeFakeTx({
      seeded: { "FROM dbo\\.PurchaseOrders WHERE ProjectId": [{ PurchaseOrderID: 501 }] },
      failOnQueryMatching: /DELETE FROM dbo\.PurchaseOrders WHERE PurchaseOrderID/,
    });
    const pool = { transaction: () => tx };

    await expect(deleteProjectCascade(pool, 7, "Failing Test Project")).rejects.toThrow(
      "Simulated failure",
    );

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledTimes(1);
  });
});
