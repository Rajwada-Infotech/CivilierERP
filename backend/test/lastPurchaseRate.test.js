process.env.NODE_ENV = "test";

/**
 * lastPurchaseRate.getLastPurchaseRate(): resolves the SENDING project's own
 * cost basis for an item, checked GRN history first (most recent), then
 * PurchaseOrderItems as a fallback for items ordered but not yet GRN'd.
 * Used to price the auto-generated invoice/GRN in the Inter-Company Stock
 * Transfer feature so no artificial profit/loss is booked on the transfer.
 *
 * Live-verified separately against a known real GRN row in the dev DB
 * (rate 600, DocNo GRN-2026-00004) during development.
 */

const { getLastPurchaseRate } = require("../services/lastPurchaseRate");

function makePool(grnRows, poRows) {
  return {
    request: () => ({
      input() {
        return this;
      },
      query: async (text) => {
        if (/FROM dbo\.GoodsReceiptNotes/i.test(text)) {
          return { recordset: grnRows };
        }
        if (/FROM dbo\.PurchaseOrderItems/i.test(text)) {
          return { recordset: poRows };
        }
        return { recordset: [] };
      },
    }),
  };
}

describe("getLastPurchaseRate", () => {
  test("returns the most recent GRN rate when GRN history exists", async () => {
    const pool = makePool(
      [{ Rate: 600, SourceDocNo: "GRN-2026-00004", SourceDate: "2026-07-01" }],
      [],
    );
    const result = await getLastPurchaseRate(pool, 3, "ITEM-1");
    expect(result).toEqual({ rate: 600, sourceDocNo: "GRN-2026-00004", sourceDate: "2026-07-01" });
  });

  test("falls back to PurchaseOrderItems when no GRN history exists", async () => {
    const pool = makePool([], [{ Rate: 450, SourceDocNo: "PO-2026-00010", SourceDate: "2026-06-15" }]);
    const result = await getLastPurchaseRate(pool, 3, "ITEM-2");
    expect(result).toEqual({ rate: 450, sourceDocNo: "PO-2026-00010", sourceDate: "2026-06-15" });
  });

  test("returns null when neither GRN nor PO history has a rate on file", async () => {
    const pool = makePool([], []);
    const result = await getLastPurchaseRate(pool, 3, "NEVER-BOUGHT");
    expect(result).toBeNull();
  });

  test("prefers GRN history over PurchaseOrderItems when both exist", async () => {
    const pool = makePool(
      [{ Rate: 600, SourceDocNo: "GRN-2026-00004", SourceDate: "2026-07-01" }],
      [{ Rate: 450, SourceDocNo: "PO-2026-00010", SourceDate: "2026-06-15" }],
    );
    const result = await getLastPurchaseRate(pool, 3, "ITEM-1");
    expect(result.rate).toBe(600);
  });
});
