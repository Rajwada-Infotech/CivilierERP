const { ledgerOptionGroup } = require("../utils/ledgerOptionGroup");

describe("ledgerOptionGroup", () => {
  test.each([
    ["GL", null, "ACCDEP", "general"],
    ["GL", "Other Expenses", "BNKCHG", "general"],
    ["A", null, "CRMCUST-35", "customer"],
    ["S", "Cement & Concrete", null, "supplier"],
    ["S", "Landlord", null, "landlord"],
    ["C", "MEP Contractor", null, "contractor"],
    ["BR", null, null, "broker"],
    ["P", null, "BA-CAP", "partner"],
    ["V", "Vendor", null, "vendor"],
    ["B", null, "AXIS-1", "bank"],
    ["B", "Cash", "CASH-IN-HAND", "cash"],
    ["C", null, "PRJ-3-CUST", "project"],
    ["S", null, "PRJ-16-SUPP", "project"],
    ["XX", null, null, "other"],
  ])("%s / %s / %s -> %s", (type, category, code, expected) => {
    expect(ledgerOptionGroup(type, category, code)).toBe(expected);
  });

  test("a Landlord never lands in the Supplier group", () => {
    expect(ledgerOptionGroup("S", "Landlord", "X")).not.toBe("supplier");
  });
});
