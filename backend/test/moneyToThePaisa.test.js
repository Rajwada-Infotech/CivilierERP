process.env.NODE_ENV = "test";
jest.mock("../db", () => ({ sql: require("mssql"), getPool: () => ({}) }));
const { sumMoney, round2, unitPrice } = require("../services/bookingUnits");

// Money comes from the database exact but becomes JS numbers; their sums carry float dust. Every money total
// worked out in JS goes through sumMoney / round2, so it compares and stores as what the parts add up to.
test("a total is exactly what the parts add up to, to the paisa", () => {
  expect(0.1 + 0.2).not.toBe(0.3); // the problem
  expect(sumMoney([0.1, 0.2])).toBe(0.3);
  expect(sumMoney([{ a: 25000.1 }, { a: 0.2 }], (r) => r.a)).toBe(25000.3);
  expect(sumMoney([{ a: 1000.1 }, { a: 1000.2 }, { a: 1000.3 }], (r) => r.a)).toBe(3000.6);
});

test("a covered milestone reads as covered (the comparison the coverage check makes)", () => {
  const onAccount = sumMoney([25000.1, 0.2]);          // money received + awaiting verification
  const required = round2(round2(0) + round2(25000.3 - 0)); // running requirement up to this milestone
  expect(onAccount >= required).toBe(true);
});

test("blanks, nulls and text count as nothing, never NaN", () => {
  expect(sumMoney([null, undefined, "", "12.5", 7.5])).toBe(20);
  expect(sumMoney([])).toBe(0);
  expect(sumMoney(undefined)).toBe(0);
});

test("the unit price for the GST band is to the paisa, like everywhere else (not to the rupee)", () => {
  expect(unitPrice(885, 3405.23)).toBe(3013628.55);
  expect(Math.round(885 * 3405.23)).toBe(3013629); // what the parking check used to use
});
