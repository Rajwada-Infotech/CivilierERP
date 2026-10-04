import { describe, it, expect } from "vitest";
import { fmtIstDateTime, parseServerUtc } from "./istTime";

describe("fmtIstDateTime", () => {
  it("shows a UTC timestamp in IST (+5:30)", () => {
    expect(fmtIstDateTime("2026-10-04T05:17:00.000Z")).toBe("04 Oct 2026, 10:47 am");
  });

  it("treats a timestamp with no zone marker as UTC too", () => {
    expect(fmtIstDateTime("2026-10-04T05:17:00")).toBe("04 Oct 2026, 10:47 am");
    expect(fmtIstDateTime("2026-10-04 05:17:00")).toBe("04 Oct 2026, 10:47 am");
  });

  it("rolls over midnight correctly", () => {
    expect(fmtIstDateTime("2026-10-04T20:00:00Z")).toBe("05 Oct 2026, 01:30 am");
  });

  it("honours an explicit offset instead of assuming UTC", () => {
    expect(fmtIstDateTime("2026-10-04T10:47:00+05:30")).toBe("04 Oct 2026, 10:47 am");
  });

  it("handles blanks and junk without throwing", () => {
    expect(fmtIstDateTime(null)).toBe("—");
    expect(fmtIstDateTime("not a date")).toBe("not a date");
    expect(parseServerUtc("")).toBeNull();
  });
});
