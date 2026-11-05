// A shop must never be sold on a residential GST rule. Until a Unit + Parking
// rule marked Commercial exists, applying for / booking a commercial unit is
// refused; homes are unaffected.
let mockRuleExists = false;
jest.mock("../services/projectType", () => ({ loadCommercialKinds: async () => new Set(["SHOP"]) }));
jest.mock("../redis", () => ({ bumpCacheVersion: async () => {} }));
jest.mock("../db", () => ({ sql: { NVarChar: () => "NVarChar", VarChar: () => "VarChar", Int: "Int", Decimal: () => "Decimal" }, getPool: () => null }));

const { assertCommercialGstReady, GstSetupError } = require("../services/crmGst");

const db = (units) => ({
  request() {
    const r = { input() { return r; }, async query(text) {
      if (/FROM dbo\.UnitMaster/.test(text)) return { recordset: units };
      if (/FROM dbo\.CrmGstRule/.test(text)) return { recordset: mockRuleExists ? [{ x: 1 }] : [] };
      return { recordset: [] };
    } };
    return r;
  },
});

describe("assertCommercialGstReady", () => {
  beforeEach(() => { mockRuleExists = false; });
  test("a shop with no commercial rule is refused, naming the unit", async () => {
    await expect(assertCommercialGstReady(db([{ UnitName: "GLORIA/1/GF-1", UnitKind: "SHOP" }]), [1]))
      .rejects.toThrow(GstSetupError);
    await expect(assertCommercialGstReady(db([{ UnitName: "GLORIA/1/GF-1", UnitKind: "SHOP" }]), [1]))
      .rejects.toThrow(/GLORIA\/1\/GF-1 is commercial/);
  });
  test("a shop passes once a commercial rule exists", async () => {
    mockRuleExists = true;
    await expect(assertCommercialGstReady(db([{ UnitName: "GLORIA/1/GF-1", UnitKind: "SHOP" }]), [1])).resolves.toBeUndefined();
  });
  test("homes are never blocked", async () => {
    await expect(assertCommercialGstReady(db([{ UnitName: "CRT/1/1A", UnitKind: "FLAT" }]), [1])).resolves.toBeUndefined();
  });
});
