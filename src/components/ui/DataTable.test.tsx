import { describe, expect, it } from "vitest";
import { columnShownAt } from "./DataTable";

// The table's minimum width counts only the columns showing at the current width; a column hidden below a
// breakpoint ("hidden lg:table-cell") must not widen the table there.
describe("columnShownAt", () => {
  it("always shows a column with no hiding class", () => {
    expect(columnShownAt(undefined, 375)).toBe(true);
    expect(columnShownAt("text-right font-mono", 375)).toBe(true);
  });

  it("shows a responsive column only from its breakpoint", () => {
    expect(columnShownAt("hidden lg:table-cell", 820)).toBe(false);
    expect(columnShownAt("hidden lg:table-cell", 1024)).toBe(true);
    expect(columnShownAt("hidden md:table-cell", 767)).toBe(false);
    expect(columnShownAt("hidden md:table-cell", 768)).toBe(true);
    expect(columnShownAt("px-3 hidden sm:table-cell text-right", 640)).toBe(true);
    expect(columnShownAt("hidden 2xl:table-cell", 1440)).toBe(false);
  });

  it("never shows a column that is just hidden", () => {
    expect(columnShownAt("hidden", 1920)).toBe(false);
  });
});
