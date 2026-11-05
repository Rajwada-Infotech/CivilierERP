import { describe, expect, it } from "vitest";
import { sameName } from "./faInventoryExcel";

describe("sameName (sheet value vs master name)", () => {
  it("ignores capitals, spaces at either end and repeated spaces", () => {
    expect(sameName("R..G OFFICE", "R..G OFFICE ")).toBe(true); // the production project is saved with a trailing space
    expect(sameName("r..g office", "R..G OFFICE")).toBe(true);
    expect(sameName("R..G OFFICE  Godown", "R..G OFFICE Godown")).toBe(true);
    expect(sameName("  Royal   Garden ", "ROYAL GARDEN")).toBe(true);
  });

  it("still tells different names apart", () => {
    expect(sameName("R.G. OFFICE", "R..G OFFICE")).toBe(false);
    expect(sameName("Royal Garden", "Royal Gardens")).toBe(false);
    expect(sameName("Rajwada 2", "Rajwada")).toBe(false);
  });

  it("an empty name never matches an empty master", () => {
    expect(sameName("", "")).toBe(false);
    expect(sameName("  ", null)).toBe(false);
    expect(sameName(undefined, "Main Store")).toBe(false);
  });
});
