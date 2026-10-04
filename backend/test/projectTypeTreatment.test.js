// The land-vs-construction rules from services/projectType.js.
//
// These encode a tax rule, not a preference: the sale of land is outside GST
// (Schedule III, CGST Act), while building and selling a flat or villa is a
// taxable supply. Getting it backwards means either charging customers tax on
// land or under-declaring output tax on construction, so it is pinned here
// rather than left to be re-derived at each call site.

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

describe("bookingTypeViolation", () => {
  const { bookingTypeViolation } = require("../services/projectType");
  // Minimal pool: every getEffectiveType lookup returns the given type row.
  const poolWith = (row) => ({
    request() {
      const r = { input: () => r, query: async () => ({ recordset: row ? [row] : [] }) };
      return r;
    },
  });
  const tower = { Id: 1, Code: "HIGHRISE", Name: "High Rise Apartments", HasFloors: true, SellsLand: false, SellsConstruction: true, AllowsMultiUnitSale: false };
  const plotted = { Id: 3, Code: "PLOTTED", Name: "Plotted Development", HasFloors: false, SellsLand: true, SellsConstruction: false, AllowsMultiUnitSale: true };
  const flat = (id) => ({ Id: id, UnitName: `F${id}`, ProjectId: 1, BlockId: 1, UnitKind: "FLAT" });
  const plot = (id) => ({ Id: id, UnitName: `P${id}`, ProjectId: 2, BlockId: 2, UnitKind: "PLOT" });

  test("an unset type is never enforced (legacy behaviour)", async () => {
    expect(await bookingTypeViolation(poolWith(null), [flat(1), flat(2), plot(3)])).toBeNull();
  });
  test("one flat in a high-rise is fine", async () => {
    expect(await bookingTypeViolation(poolWith(tower), [flat(1)])).toBeNull();
  });
  test("two flats are refused where the type allows one unit per booking", async () => {
    expect(await bookingTypeViolation(poolWith(tower), [flat(1), flat(2)])).toMatch(/one unit per booking/);
  });
  test("several plots are fine where the type allows it", async () => {
    expect(await bookingTypeViolation(poolWith(plotted), [plot(1), plot(2)], { isPlotBooking: true })).toBeNull();
  });
  test("land is refused where the type does not sell land", async () => {
    expect(await bookingTypeViolation(poolWith(tower), [plot(1)])).toMatch(/does not sell land/);
  });
  test("a flat is refused where the type does not sell construction", async () => {
    expect(await bookingTypeViolation(poolWith(plotted), [flat(1)])).toMatch(/does not sell construction/);
  });
});

describe("bookingTypeViolation — residential vs commercial", () => {
  const { bookingTypeViolation } = require("../services/projectType");
  const poolWith = (row) => ({
    request() {
      const r = { input: () => r, query: async () => ({ recordset: row ? [row] : [] }) };
      return r;
    },
  });
  // Kinds marked commercial come from the kind master; here a test register.
  const commercialKinds = new Set(["SHOP"]);
  const base = { Id: 7, Code: "X", Name: "Test Type", HasFloors: true, SellsLand: false, SellsConstruction: true, AllowsMultiUnitSale: true };
  const mixedUse = { ...base, SellsResidential: true, SellsCommercial: true };
  const residentialOnly = { ...base, SellsResidential: true, SellsCommercial: false };
  const commercialOnly = { ...base, SellsResidential: false, SellsCommercial: true };
  const shop = (id) => ({ Id: id, UnitName: `GF-${id}`, ProjectId: 1, BlockId: 1, UnitKind: "SHOP" });
  const flat = (id) => ({ Id: id, UnitName: `${id}A`, ProjectId: 1, BlockId: 1, UnitKind: "FLAT" });

  test("a shop in a commercial + residential building is fine", async () => {
    expect(await bookingTypeViolation(poolWith(mixedUse), [shop(1)], { commercialKinds })).toBeNull();
  });
  test("a flat in a commercial + residential building is fine", async () => {
    expect(await bookingTypeViolation(poolWith(mixedUse), [flat(2)], { commercialKinds })).toBeNull();
  });
  test("a shop is refused where the type sells no commercial", async () => {
    expect(await bookingTypeViolation(poolWith(residentialOnly), [shop(1)], { commercialKinds })).toMatch(/does not sell commercial/);
  });
  test("a flat is refused in a purely commercial building", async () => {
    expect(await bookingTypeViolation(poolWith(commercialOnly), [flat(2)], { commercialKinds })).toMatch(/does not sell residential/);
  });
  test("a shop and a flat can't share one booking", async () => {
    expect(await bookingTypeViolation(poolWith(mixedUse), [shop(1), flat(2)], { commercialKinds })).toMatch(/can't be on one booking/);
  });
  test("with no commercial register every unit is residential (today's behaviour)", async () => {
    expect(await bookingTypeViolation(poolWith(residentialOnly), [shop(1)])).toBeNull();
  });
});

describe("resolveHsnCode — usage qualifier", () => {
  test("before migration 526 usage isn't considered at all", async () => {
    const { resolveHsnCode } = require("../services/gstRules");
    let text = "";
    const pool = { request() { const r = { input: () => r, query: async (q) => (/COL_LENGTH/.test(q) ? { recordset: [{ c: null }] } : ((text = q), { recordset: [] })) }; return r; } };
    await resolveHsnCode(pool, "UNIT_PARKING", { value: 1, commercial: true });
    expect(text).not.toMatch(/ForCommercial/);
  });
  const { resolveHsnCode } = require("../services/gstRules");
  const capture = () => {
    const seen = { inputs: {}, text: "" };
    const pool = {
      request() {
        const r = {
          input: (k, _t, v) => { seen.inputs[k] = v; return r; },
          // Migration 526 present: the column probe answers, the rule query is captured.
          query: async (q) => (/COL_LENGTH/.test(q) ? { recordset: [{ c: 1 }] } : ((seen.text = q), { recordset: [] })),
        };
        return r;
      },
    };
    return { pool, seen };
  };
  test("unknown usage matches only usage-agnostic rules", async () => {
    const { pool, seen } = capture();
    await resolveHsnCode(pool, "UNIT_PARKING", { value: 1 });
    expect(seen.text).toMatch(/r\.ForCommercial IS NULL/);
    expect(seen.inputs.commercial).toBeUndefined();
  });
  test("commercial usage also matches commercial-only rules, specific first", async () => {
    const { pool, seen } = capture();
    await resolveHsnCode(pool, "UNIT_PARKING", { value: 1, commercial: true });
    expect(seen.text).toMatch(/r\.ForCommercial = @commercial/);
    expect(seen.text).toMatch(/CASE WHEN r\.ForCommercial IS NULL THEN 1 ELSE 0 END/);
    expect(seen.inputs.commercial).toBe(1);
  });
});
