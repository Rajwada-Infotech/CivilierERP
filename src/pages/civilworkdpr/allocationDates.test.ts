import { describe, expect, it } from "vitest";
import {
  addDays,
  applyDefaultDays,
  changeDays,
  changeEnd,
  changeStart,
  inclusiveDays,
  type AllocDates,
} from "./allocationDates";

const empty: AllocDates = { startDate: "", endDate: "", days: "", startAuto: false };

describe("date arithmetic", () => {
  it("adds days across month and year ends, with no timezone drift", () => {
    expect(addDays("2026-10-05", 4)).toBe("2026-10-09");
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts days inclusively", () => {
    expect(inclusiveDays("2026-10-05", "2026-10-09")).toBe(5);
    expect(inclusiveDays("2026-10-05", "2026-10-05")).toBe(1);
    expect(inclusiveDays("2026-10-09", "2026-10-05")).toBeNull();
  });
});

describe("Days comes from the Activity Master", () => {
  it("fills Days when empty and leaves a value the user already set", () => {
    expect(applyDefaultDays(empty, 5).days).toBe("5");
    expect(applyDefaultDays({ ...empty, days: "9" }, 5).days).toBe("9");
    expect(applyDefaultDays(empty, null).days).toBe("");
  });

  it("carries the default through to the dates when one is already filled", () => {
    expect(applyDefaultDays({ ...empty, startDate: "2026-10-05" }, 5).endDate).toBe("2026-10-09");
    expect(applyDefaultDays({ ...empty, endDate: "2026-10-09" }, 5).startDate).toBe("2026-10-05");
  });
});

describe("start date given → end date calculated", () => {
  it("5 days from the 5th ends on the 9th", () => {
    const s = changeStart({ ...empty, days: "5" }, "2026-10-05");
    expect(s.startDate).toBe("2026-10-05");
    expect(s.endDate).toBe("2026-10-09");
    expect(s.startAuto).toBe(false);
  });

  it("with no Days yet, leaves the end date alone", () => {
    expect(changeStart(empty, "2026-10-05").endDate).toBe("");
  });
});

describe("end date given → tentative start date calculated", () => {
  it("5 days ending on the 9th starts on the 5th, flagged as tentative", () => {
    const s = changeEnd({ ...empty, days: "5" }, "2026-10-09");
    expect(s.startDate).toBe("2026-10-05");
    expect(s.startAuto).toBe(true);
  });

  it("changing the end again moves the tentative start with it", () => {
    let s = changeEnd({ ...empty, days: "5" }, "2026-10-09");
    s = changeEnd(s, "2026-10-20");
    expect(s.startDate).toBe("2026-10-16");
    expect(s.startAuto).toBe(true);
  });

  it("a start the user picked is respected: Days follows the span instead", () => {
    let s = changeStart({ ...empty, days: "5" }, "2026-10-05");
    s = changeEnd(s, "2026-10-12");
    expect(s.startDate).toBe("2026-10-05");
    expect(s.days).toBe("8");
  });

  it("the user typing a start over a tentative one makes it theirs", () => {
    let s = changeEnd({ ...empty, days: "5" }, "2026-10-09");
    s = changeStart(s, "2026-10-06");
    expect(s.startAuto).toBe(false);
    expect(s.endDate).toBe("2026-10-10");
  });

  it("with no Days to work from, leaves the start date empty", () => {
    expect(changeEnd(empty, "2026-10-09").startDate).toBe("");
  });
});

describe("editing Days", () => {
  it("re-works the end date from a typed start", () => {
    const s = changeDays({ ...empty, startDate: "2026-10-05", endDate: "2026-10-09", days: "5" }, "10");
    expect(s.endDate).toBe("2026-10-14");
  });

  it("re-works the tentative start from a typed end", () => {
    const s = changeDays({ ...empty, endDate: "2026-10-09", startDate: "2026-10-05", startAuto: true, days: "5" }, "3");
    expect(s.startDate).toBe("2026-10-07");
  });

  it("an end date alone becomes a tentative start once Days is known", () => {
    const s = changeDays({ ...empty, endDate: "2026-10-09" }, "5");
    expect(s.startDate).toBe("2026-10-05");
    expect(s.startAuto).toBe(true);
  });

  it("ignores a cleared or invalid value without touching the dates", () => {
    const base = { ...empty, startDate: "2026-10-05", endDate: "2026-10-09", days: "5" };
    expect(changeDays(base, "").endDate).toBe("2026-10-09");
    expect(changeDays(base, "0").endDate).toBe("2026-10-09");
  });
});
