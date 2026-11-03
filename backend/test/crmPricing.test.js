// The shared pricing pieces the application form's quote and the booking both
// use: one unit-price rule, one totals formula, one schedule split.
const { unitPrice, priceBooking } = require("../services/bookingUnits");
const { saleTotals, gstOn } = require("../services/crmGst");
const { planSchedule } = require("../services/crmEntityCreation");

describe("unitPrice — area x rate, to the paisa, everywhere", () => {
  test("885 sqft at Rs 3,405.23 is Rs 30,13,628.55 (not rounded to the rupee)", () => {
    expect(unitPrice(885, 3405.23)).toBe(3013628.55);
  });
  test("agrees with booking creation's priceBooking for one unit", () => {
    const p = priceBooking({ lines: [{ unitId: 1, areaSqFt: 885 }], ratePerSqFt: 3405.23 });
    expect(p.total).toBe(unitPrice(885, 3405.23));
  });
  test("a rate worked out from a typed price to 4 decimals gives that price back", () => {
    // Rs 30,00,000 on 1,234 sqft: 2431.1183 (4dp) lands on the price; 2431.12 (2dp) did not.
    expect(Math.round(unitPrice(1234, 2431.1183))).toBe(3000000);
    expect(unitPrice(1234, 2431.12)).toBe(3000002.08);
  });
  test("no area or no rate is no price", () => {
    expect(unitPrice(0, 3000)).toBe(0);
    expect(unitPrice(1000, null)).toBe(0);
  });
});

describe("saleTotals — the Grand Total formula", () => {
  test("unit + unit GST + parking (with GST) + extras (with GST)", () => {
    const parkingBase = 300000, rate = 5;
    const parkingTotal = parkingBase + gstOn(parkingBase, rate);
    const t = saleTotals({ totalValue: 5000000, constructionValue: 5000000, rate, parkingBase, parkingTotal,
      extraChargesTotal: 118000, extraWorkGstAmount: 18000 });
    expect(t.unitGstAmount).toBe(250000);
    expect(t.parkingGstAmount).toBe(15000);
    expect(t.totalGstAmount).toBe(283000);
    expect(t.grandTotal).toBe(5000000 + 250000 + 315000 + 118000);
  });
  test("GST only on the construction part when land is inside the price", () => {
    const t = saleTotals({ totalValue: 8000000, constructionValue: 5000000, rate: 1, parkingBase: 0, parkingTotal: 0, extraChargesTotal: 0, extraWorkGstAmount: 0 });
    expect(t.unitGstAmount).toBe(50000);
    expect(t.grandTotal).toBe(8050000);
  });
  test("credit notes come off the total and the GST", () => {
    const t = saleTotals({ totalValue: 6000000, constructionValue: 6000000, rate: 0, parkingBase: 0, parkingTotal: 0,
      extraChargesTotal: 0, extraWorkGstAmount: 0, creditNoteTotal: 300000, creditNoteGst: 0 });
    expect(t.grandTotal).toBe(5700000);
  });
});

describe("planSchedule — the split the booking stores", () => {
  const plan = [
    { no: 1, name: "Booking", pct: 0 }, { no: 2, name: "Agreement", pct: 15 }, { no: 3, name: "Foundation", pct: 15 },
    { no: 4, name: "Superstructure", pct: 15 }, { no: 5, name: "Slab", pct: 15 }, { no: 6, name: "Plastering", pct: 20 },
    { no: 7, name: "Handover", pct: 20 },
  ];
  test("the screenshot's sale: Booking Rs 10,000, the rest by % of what's left", () => {
    const s = planSchedule(3043765.29, 10000, plan);
    expect(s[0]).toMatchObject({ name: "Booking", amount: 10000 });
    expect(s[1].amount).toBe(455064.79);
    expect(s[5].amount).toBe(606753.06);
  });
  test("always adds up exactly to the Grand Total", () => {
    for (const total of [3043765.29, 8750000, 1234567.89, 10000.01]) {
      const sum = planSchedule(total, 10000, plan).reduce((a, m) => a + m.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(total);
    }
  });
  test("weights are relative — a plan whose steps don't sum to 100 still fills the total", () => {
    const s = planSchedule(1000000, 0, [{ no: 1, name: "Booking", pct: 0 }, { no: 2, name: "A", pct: 30 }, { no: 3, name: "B", pct: 30 }]);
    expect(s.map((m) => m.amount)).toEqual([0, 500000, 500000]);
  });
});
