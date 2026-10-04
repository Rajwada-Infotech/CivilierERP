// Multi-plot pricing and apportionment (services/bookingUnits.js).
//
// The property that matters most here is that apportioned values RECONCILE
// EXACTLY to the booking total. Each plot is registered on its own conveyance
// deed with its own stamp duty, so if the parts do not add back up to the
// agreement value, the sub-registrar has a discrepancy to query. Proportional
// splits almost never divide cleanly, so that is pinned explicitly below with
// deliberately awkward numbers.

const { apportion, priceBooking, allocateConsideration, round2 } = require("../services/bookingUnits");

const sum = (a) => round2(a.reduce((x, y) => x + y, 0));

describe("apportion", () => {
  test("parts reconcile exactly even when the split does not divide cleanly", () => {
    // 1/3 each of 100 is 33.333... — naive rounding loses a paisa.
    const parts = apportion(100, [1, 1, 1]);
    expect(sum(parts)).toBe(100);
  });

  test("reconciles across a range of ugly totals and weights", () => {
    const cases = [
      [1000000, [1200, 1500, 900]],
      [7777777.77, [333, 667]],
      [45_00_000, [1000, 1000, 1000, 1]],
      [0.03, [1, 1, 1]],
      [1, [3, 5, 7, 11]],
    ];
    for (const [total, weights] of cases) {
      expect(sum(apportion(total, weights))).toBe(round2(total));
    }
  });

  test("splits by weight, not evenly, when areas differ", () => {
    // The whole point: plots are different sizes.
    const parts = apportion(3600, [1200, 1500, 900]); // total area 3600 -> Rs 1/sqft
    expect(parts).toEqual([1200, 1500, 900]);
  });

  test("falls back to an equal split when no area is recorded", () => {
    const parts = apportion(100, [0, 0, 0]);
    expect(sum(parts)).toBe(100);
    expect(parts[0]).toBeCloseTo(33.33, 2);
  });

  test("no lines yields no parts", () => {
    expect(apportion(500, [])).toEqual([]);
  });
});

describe("priceBooking — several plots as a single unit", () => {
  const threePlots = [
    { unitId: 1, areaSqFt: 1200 },
    { unitId: 2, areaSqFt: 1500 },
    { unitId: 3, areaSqFt: 900 },
  ];

  test("prices on COMBINED area at one rate", () => {
    const r = priceBooking({ lines: threePlots, ratePerSqFt: 2000 });
    expect(r.combinedArea).toBe(3600);
    // 3600 x 2000, not three independent calculations summed.
    expect(r.total).toBe(7_200_000);
  });

  test("allocations reconcile to the total", () => {
    const r = priceBooking({ lines: threePlots, ratePerSqFt: 1999.99 });
    expect(sum(r.lines.map((l) => l.allocatedValue))).toBe(r.total);
  });

  test("each plot gets its area's share, for its own deed", () => {
    const r = priceBooking({ lines: threePlots, ratePerSqFt: 1000 });
    expect(r.lines.map((l) => l.allocatedValue)).toEqual([1_200_000, 1_500_000, 900_000]);
  });

  test("a single plot behaves exactly as a single unit always did", () => {
    const r = priceBooking({ lines: [{ unitId: 9, areaSqFt: 1000 }], ratePerSqFt: 3000 });
    expect(r.total).toBe(3_000_000);
    expect(r.lines[0].allocatedValue).toBe(3_000_000);
  });
});

describe("priceBooking — optional per-plot overrides", () => {
  test("a premium attaches to the plot that earned it, and is not spread", () => {
    const r = priceBooking({
      lines: [
        { unitId: 1, areaSqFt: 1000 },
        { unitId: 2, areaSqFt: 1000, premiumAmount: 50_000 }, // corner plot
      ],
      ratePerSqFt: 1000,
    });
    expect(r.premiumTotal).toBe(50_000);
    expect(r.lines[0].allocatedValue).toBe(1_000_000);
    expect(r.lines[1].allocatedValue).toBe(1_050_000);
    expect(sum(r.lines.map((l) => l.allocatedValue))).toBe(r.total);
  });

  test("a plot with its own rate is priced on its own area, others still pool", () => {
    const r = priceBooking({
      lines: [
        { unitId: 1, areaSqFt: 1000 },
        { unitId: 2, areaSqFt: 1000 },
        { unitId: 3, areaSqFt: 1000, ratePerSqFt: 2500 }, // negotiated separately
      ],
      ratePerSqFt: 1000,
    });
    expect(r.pooledArea).toBe(2000);
    expect(r.total).toBe(2_000_000 + 2_500_000);
    expect(r.lines[2].allocatedValue).toBe(2_500_000);
    expect(sum(r.lines.map((l) => l.allocatedValue))).toBe(r.total);
  });

  test("with no overrides anywhere, nothing needs configuring", () => {
    const r = priceBooking({ lines: [{ unitId: 1, areaSqFt: 500 }], ratePerSqFt: 100 });
    expect(r.premiumTotal).toBe(0);
    expect(r.total).toBe(50_000);
  });
});

describe("allocateConsideration — negotiated lump sum", () => {
  test("splits an agreed total pro-rata by area and reconciles", () => {
    const lines = [
      { unitId: 1, areaSqFt: 1234 },
      { unitId: 2, areaSqFt: 987 },
      { unitId: 3, areaSqFt: 1111 },
    ];
    const out = allocateConsideration({ lines, totalConsideration: 10_000_001 });
    expect(sum(out.map((l) => l.allocatedValue))).toBe(10_000_001);
    expect(out[0].allocatedValue).toBeGreaterThan(out[1].allocatedValue);
  });
});
