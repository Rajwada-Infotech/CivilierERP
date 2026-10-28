// Which invoices a GRN went into: the one booked on it, and any it was merged into (ELinkedGrnIds).
const { ebCoversGrnSql, grnIdsOfExpense } = require("../services/expenseGrnLink");

describe("ebCoversGrnSql", () => {
  test("matches the GRN an invoice was booked on and every GRN merged into one", () => {
    const sqlText = ebCoversGrnSql("eb", "@g");
    expect(sqlText).toContain("eb.ESourceType = 'GRN'");
    expect(sqlText).toContain("eb.ESourceId = @g");
    expect(sqlText).toContain("OPENJSON(eb.ELinkedGrnIds)");
    expect(sqlText).toContain("TRY_CAST(value AS INT) = @g");
  });

  test("works without a table alias", () => {
    expect(ebCoversGrnSql("", "@g")).toContain("(ESourceType = 'GRN' AND (ESourceId = @g");
  });
});

describe("grnIdsOfExpense", () => {
  test("a single-GRN invoice covers its own GRN", () => {
    expect(grnIdsOfExpense({ ESourceId: "11", ELinkedGrnIds: null })).toEqual([11]);
  });

  test("a merged invoice covers every GRN, first one first, none twice", () => {
    expect(grnIdsOfExpense({ ESourceId: 11, ELinkedGrnIds: "[11, 12, \"13\"]" })).toEqual([11, 12, 13]);
  });

  test("a malformed list leaves the first GRN", () => {
    expect(grnIdsOfExpense({ ESourceId: 11, ELinkedGrnIds: "not json" })).toEqual([11]);
  });
});
