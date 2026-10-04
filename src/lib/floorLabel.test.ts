import { describe, it, expect } from "vitest";
import { floorLabel, floorDisplay } from "./floorLabel";

describe("floorLabel", () => {
  it("maps Ground (0) to the stored label 'G' — the Work Allocation dependency match depends on it", () => {
    expect(floorLabel("0")).toBe("G");
    expect(floorLabel(0)).toBe("G");
    expect(floorLabel("3")).toBe("3");
    expect(floorLabel("")).toBe("");
    expect(floorLabel(null)).toBe("");
  });
  it("readable names", () => {
    expect(floorDisplay("0")).toBe("Ground");
    expect(floorDisplay("12")).toBe("Floor 12");
    expect(floorDisplay("")).toBe("");
  });
});
