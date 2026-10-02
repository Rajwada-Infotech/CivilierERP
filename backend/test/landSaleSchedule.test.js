// A plot sale has no payment plan: Booking Amount, then the balance.
jest.mock("../db", () => ({ sql: {}, getPool: () => null }));
const { landSaleSchedule } = require("../services/crmEntityCreation");

describe("landSaleSchedule", () => {
  test("booking amount then balance, summing to the total", () => {
    const s = landSaleSchedule(6750000, 100000);
    expect(s.map((m) => [m.no, m.name, m.amount])).toEqual([[1, "Booking", 100000], [2, "Balance", 6650000]]);
  });
  test("no booking amount -> the full value is one payment", () => {
    expect(landSaleSchedule(6750000, 0)).toEqual([expect.objectContaining({ no: 1, name: "Full Payment", amount: 6750000 })]);
  });
  test("a booking amount equal to or above the total is one payment, never a negative balance", () => {
    expect(landSaleSchedule(500000, 500000)).toHaveLength(1);
    expect(landSaleSchedule(500000, 900000)[0].amount).toBe(500000);
  });
  test("paise are kept exact", () => {
    const s = landSaleSchedule(1000000.55, 0.25);
    expect(s[0].amount + s[1].amount).toBeCloseTo(1000000.55, 2);
  });
});
