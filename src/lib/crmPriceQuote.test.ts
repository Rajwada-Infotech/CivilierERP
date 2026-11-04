import { describe, expect, it } from "vitest";
import { round2, sumMoney } from "./crmPriceQuote";

// The screens work out balances from exact amounts that are JS numbers; without rounding, nothing left to pay
// can read as ₹0.0000001 and show "₹0.00 due" instead of "Fully collected". Same rule as the server.
describe("money to the paisa", () => {
  it("a fully collected booking has nothing outstanding", () => {
    const grand = 30_13_628.55, cleared = 30_00_000.25, onAccount = 13_628.3;
    expect(grand - cleared - onAccount).not.toBe(0); // the float dust
    expect(Math.max(0, round2(grand - cleared - onAccount))).toBe(0);
  });

  it("a total is what its parts add up to", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([{ Amount: 1000.1 }, { Amount: 1000.2 }], (r) => r.Amount)).toBe(2000.3);
    expect(sumMoney([null, undefined, "", "7.5"])).toBe(7.5);
    expect(sumMoney(null)).toBe(0);
  });
});
