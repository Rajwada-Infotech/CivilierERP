import { describe, expect, it } from "vitest";
import { resolveGridDateRange, gridVisibleCols, gridDefaultPrefs, GRID_ANY_DATE, type GridCol } from "./CrmDataTable";

// The list date filter's presets, worked out from a fixed "today".
describe("resolveGridDateRange", () => {
  const today = new Date(2026, 10, 5); // 5 Nov 2026

  it("any time has no ends", () => {
    expect(resolveGridDateRange(GRID_ANY_DATE, today)).toEqual({ from: "", to: "" });
  });
  it("last 7 / 30 days include today", () => {
    expect(resolveGridDateRange({ preset: "7d", from: "", to: "" }, today)).toEqual({ from: "2026-10-30", to: "2026-11-05" });
    expect(resolveGridDateRange({ preset: "30d", from: "", to: "" }, today)).toEqual({ from: "2026-10-07", to: "2026-11-05" });
  });
  it("this month starts on the 1st", () => {
    expect(resolveGridDateRange({ preset: "month", from: "", to: "" }, today)).toEqual({ from: "2026-11-01", to: "2026-11-05" });
  });
  it("the financial year runs from 1 April, also before April", () => {
    expect(resolveGridDateRange({ preset: "fy", from: "", to: "" }, today)).toEqual({ from: "2026-04-01", to: "2026-11-05" });
    expect(resolveGridDateRange({ preset: "fy", from: "", to: "" }, new Date(2027, 1, 10))).toEqual({ from: "2026-04-01", to: "2027-02-10" });
  });
  it("a custom range is taken as given, either end may be open", () => {
    expect(resolveGridDateRange({ preset: "custom", from: "2026-01-01", to: "" }, today)).toEqual({ from: "2026-01-01", to: "" });
  });
});

describe("grid columns", () => {
  const cols: GridCol<unknown>[] = [
    { id: "a", label: "A", locked: true, cell: () => null },
    { id: "b", label: "B", cell: () => null },
    { id: "c", label: "C", hiddenByDefault: true, cell: () => null },
  ];
  it("hidden-by-default columns start hidden; the viewer's order is kept; a locked column always shows", () => {
    expect(gridVisibleCols(cols, gridDefaultPrefs(cols)).map((c) => c.id)).toEqual(["a", "b"]);
    expect(gridVisibleCols(cols, { order: ["c", "b", "a"], hidden: ["a", "b"], widths: {} }).map((c) => c.id)).toEqual(["c", "a"]);
  });
});
