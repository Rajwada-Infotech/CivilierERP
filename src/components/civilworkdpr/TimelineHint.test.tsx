import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineHint, localToday, timelineDaysLeft, timelineMessage } from "./TimelineHint";

const t = { startDate: "2026-10-01", days: 10, endDate: "2026-10-10" };

describe("days left on the timeline", () => {
  it("10-day timeline, back in progress on day 7 → 3 days left (10 − 7), holds included", () => {
    expect(timelineDaysLeft(t, "2026-10-07")).toEqual({ left: 3, dayNo: 7, total: 10 });
  });

  it("day 1 has 9 left; the last day has 0", () => {
    expect(timelineDaysLeft(t, "2026-10-01")?.left).toBe(9);
    expect(timelineDaysLeft(t, "2026-10-10")?.left).toBe(0);
  });

  it("goes negative once past the end", () => {
    expect(timelineDaysLeft(t, "2026-10-13")?.left).toBe(-3);
  });

  it("uses the end date when Days wasn't saved, and accepts full ISO timestamps", () => {
    expect(timelineDaysLeft({ startDate: "2026-10-01T00:00:00.000Z", days: null, endDate: "2026-10-10T00:00:00.000Z" }, "2026-10-07")?.left).toBe(3);
  });

  it("says nothing before the start date or without a timeline", () => {
    expect(timelineDaysLeft(t, "2026-09-30")).toBeNull();
    expect(timelineDaysLeft({ startDate: null, days: 10, endDate: null }, "2026-10-07")).toBeNull();
    expect(timelineDaysLeft({ startDate: "2026-10-01", days: null, endDate: null }, "2026-10-07")).toBeNull();
  });
});

describe("wording", () => {
  it("reads naturally", () => {
    expect(timelineMessage(3)).toBe("Complete within 3 days");
    expect(timelineMessage(1)).toBe("Complete within 1 day");
    expect(timelineMessage(0)).toBe("Due today");
    expect(timelineMessage(-1)).toBe("1 day overdue");
    expect(timelineMessage(-3)).toBe("3 days overdue");
  });
});

describe("<TimelineHint />", () => {
  // A timeline that ends 3 days from today, so the test holds on any date.
  const today = new Date();
  const iso = (offset: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return localToday(d);
  };

  it("shows the message for an In Progress activity", () => {
    render(<TimelineHint status="IN_PROGRESS" startDate={iso(-6)} days={10} endDate={iso(3)} />);
    expect(screen.getByText("Complete within 3 days")).toBeTruthy();
  });

  it("stays out of the way for any other status", () => {
    for (const status of ["HOLD", "PENDING", "ALLOCATED", "COMPLETED", "CANCELLED"]) {
      const { container, unmount } = render(<TimelineHint status={status} startDate={iso(-6)} days={10} endDate={iso(3)} />);
      expect(container.textContent).toBe("");
      unmount();
    }
  });
});
