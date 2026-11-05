import { describe, expect, it } from "vitest";
import { formatCountdown, formatIst, fromIstInputValue, maintenanceProgress, toIstInputValue } from "./maintenanceTime";

describe("formatCountdown", () => {
  it("shows hours, minutes and seconds only as far as they matter", () => {
    expect(formatCountdown(3_909_000)).toBe("1h 05m 09s");
    expect(formatCountdown(723_000)).toBe("12m 03s");
    expect(formatCountdown(42_000)).toBe("42s");
  });
  it("never goes negative", () => {
    expect(formatCountdown(-5000)).toBe("0s");
  });
});

describe("maintenanceProgress", () => {
  const start = "2026-10-08T10:00:00Z";
  const end = "2026-10-08T12:00:00Z";
  it("is how far through the window we are, kept between 0 and 1", () => {
    expect(maintenanceProgress(start, end, Date.parse("2026-10-08T11:00:00Z"))).toBeCloseTo(0.5);
    expect(maintenanceProgress(start, end, Date.parse("2026-10-08T09:00:00Z"))).toBe(0);
    expect(maintenanceProgress(start, end, Date.parse("2026-10-08T13:00:00Z"))).toBe(1);
  });
  it("is null with no end, no start or an end before the start", () => {
    expect(maintenanceProgress(start, null, 0)).toBeNull();
    expect(maintenanceProgress(null, end, 0)).toBeNull();
    expect(maintenanceProgress(end, start, 0)).toBeNull();
  });
});

describe("India time", () => {
  it("writes a time in IST whatever the computer's zone", () => {
    expect(formatIst("2026-10-08T12:00:00Z")).toBe("Thu, 8 Oct, 5:30 pm IST");
  });
  it("round-trips the datetime-local value through IST", () => {
    const d = fromIstInputValue("2026-10-08T17:30");
    expect(d?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(toIstInputValue(d as Date)).toBe("2026-10-08T17:30");
  });
  it("reads an empty or malformed value as no date", () => {
    expect(fromIstInputValue("")).toBeNull();
    expect(fromIstInputValue("tomorrow")).toBeNull();
    expect(fromIstInputValue("2026-13-45T99:99")).toBeNull();
  });
});
