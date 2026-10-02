// The land-vs-construction rules from services/projectType.js.
//
// These encode a tax rule, not a preference: the sale of land is outside GST
// (Schedule III, CGST Act), while building and selling a flat or villa is a
// taxable supply. Getting it backwards means either charging customers tax on
// land or under-declaring output tax on construction, so it is pinned here
// rather than left to be re-derived at each call site.

// These are pure rules; services/projectType.js only pulls in db.js for the
// mssql type helpers, which would otherwise demand real DB env vars in CI.
jest.mock("../db", () => ({ sql: require("mssql") }));

const {
  UNIT_KIND,
  INCOME_ACCOUNT,
  LEGACY_DEFAULT,
  unitSaleTreatment,
  bookingSaleTreatment,
} = require("../services/projectType");

describe("unitSaleTreatment", () => {
  test("a plot is land: no GST, Sale of Land", () => {
    const t = unitSaleTreatment(UNIT_KIND.PLOT);
    expect(t.isLand).toBe(true);
    expect(t.gstApplicable).toBe(false);
    expect(t.incomeAccount).toBe(INCOME_ACCOUNT.LAND);
  });

  test("a plot stays out of the affordable-housing GST bracket", () => {
    // The Rs 45 lakh threshold applies to construction value. Letting land
    // into that sum would push villas over the bracket and misprice them.
    expect(unitSaleTreatment(UNIT_KIND.PLOT).countsTowardGstBracket).toBe(false);
    expect(unitSaleTreatment(UNIT_KIND.VILLA).countsTowardGstBracket).toBe(true);
  });

  test.each([UNIT_KIND.FLAT, UNIT_KIND.VILLA])(
    "%s is construction: GST applies, Sale of Flat/Parking",
    (kind) => {
      const t = unitSaleTreatment(kind);
      expect(t.isLand).toBe(false);
      expect(t.gstApplicable).toBe(true);
      expect(t.incomeAccount).toBe(INCOME_ACCOUNT.CONSTRUCTION);
    },
  );

  test("an unknown or missing kind falls back to FLAT, never to land", () => {
    // Failing open to "land" would silently zero-rate a taxable sale, so the
    // safe default is the taxable one.
    for (const bad of [undefined, null, "", "SOMETHING_NEW"]) {
      const t = unitSaleTreatment(bad);
      expect(t.isLand).toBe(false);
      expect(t.gstApplicable).toBe(true);
    }
  });

  test("kind matching is case-insensitive", () => {
    expect(unitSaleTreatment("plot").isLand).toBe(true);
    expect(unitSaleTreatment("Plot").isLand).toBe(true);
  });
});

describe("bookingSaleTreatment", () => {
  test("several plots on one booking are still wholly land", () => {
    // The case that started this: a buyer takes 2-3 plots on one agreement.
    const t = bookingSaleTreatment([UNIT_KIND.PLOT, UNIT_KIND.PLOT, UNIT_KIND.PLOT]);
    expect(t.hasLand).toBe(true);
    expect(t.hasConstruction).toBe(false);
    expect(t.isMixed).toBe(false);
    expect(t.gstApplicable).toBe(false);
    expect(t.incomeAccount).toBe(INCOME_ACCOUNT.LAND);
  });

  test("a plot plus the villa on it is flagged mixed, not blended", () => {
    // A mixed booking must apportion per line; collapsing it to one rate
    // would tax the land half.
    const t = bookingSaleTreatment([UNIT_KIND.PLOT, UNIT_KIND.VILLA]);
    expect(t.isMixed).toBe(true);
    expect(t.hasLand).toBe(true);
    expect(t.hasConstruction).toBe(true);
  });

  test("an empty booking is not treated as land", () => {
    expect(bookingSaleTreatment([]).hasLand).toBe(false);
  });
});

describe("LEGACY_DEFAULT", () => {
  test("an unset project behaves exactly as CRM did before migration 502", () => {
    // Nothing was backfilled on the live database, so every pre-existing
    // project resolves to this. It must stay floor-based, single-unit and
    // taxable, or migration 502 silently changed behaviour for live projects.
    expect(LEGACY_DEFAULT.HasFloors).toBe(true);
    expect(LEGACY_DEFAULT.SellsLand).toBe(false);
    expect(LEGACY_DEFAULT.SellsConstruction).toBe(true);
    expect(LEGACY_DEFAULT.AllowsMultiUnitSale).toBe(false);
  });
});

describe("land kinds come from the master, not a literal", () => {
  // Migration 512 dropped the CHECK constraint on UnitMaster.UnitKind and made
  // kinds an editable master, which turned the old `kind === "PLOT"` test into
  // a trap: a kind added from the UI as COMMERCIAL_PLOT or FARM_LAND would be
  // taxed as construction even though it is land. Migration 517 moved the
  // decision onto an IsLand flag; these pin that it stays there.
  const register = new Set(["PLOT", "COMMERCIAL_PLOT", "FARM_LAND"]);

  test("a land kind that is not literally PLOT is still land", () => {
    const t = unitSaleTreatment("COMMERCIAL_PLOT", register);
    expect(t.isLand).toBe(true);
    expect(t.gstApplicable).toBe(false);
    expect(t.countsTowardGstBracket).toBe(false);
    expect(t.incomeAccount).toBe(INCOME_ACCOUNT.LAND);
  });

  test("a kind absent from the register is taxable construction", () => {
    const t = unitSaleTreatment("SHOP", register);
    expect(t.isLand).toBe(false);
    expect(t.gstApplicable).toBe(true);
  });

  test("with no register supplied it falls back to PLOT alone", () => {
    // The fallback may only ever UNDER-claim land. Over-claiming would
    // zero-rate a taxable supply, which is the worse of the two errors.
    expect(unitSaleTreatment("PLOT").isLand).toBe(true);
    expect(unitSaleTreatment("COMMERCIAL_PLOT").isLand).toBe(false);
  });

  test("bookingSaleTreatment threads the register through to every line", () => {
    // Guards a real hazard: passing unitSaleTreatment straight to .map() would
    // hand it the array INDEX in the register slot.
    const t = bookingSaleTreatment(["COMMERCIAL_PLOT", "FARM_LAND"], register);
    expect(t.hasLand).toBe(true);
    expect(t.hasConstruction).toBe(false);
    expect(t.gstApplicable).toBe(false);
  });

  test("a mixed booking is still detected when the land kind is a custom one", () => {
    const t = bookingSaleTreatment(["COMMERCIAL_PLOT", "VILLA"], register);
    expect(t.isMixed).toBe(true);
  });
});
