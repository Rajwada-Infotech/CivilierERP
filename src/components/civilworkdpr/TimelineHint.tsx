import { inclusiveDays } from "@/pages/civilworkdpr/allocationDates";

// How much of an in-progress activity's timeline is left.
//
//   Timeline 10 days; reported on days 1–4, on hold on day 5, back In Progress on day 7
//   → "Complete within 3 days" (10 − 7). Days spent on hold stay on the clock: the deadline is
//   the original end of the timeline, not pushed out by a pause.
//
// Counting is by calendar day, inclusive of the start day (day 1 = the start date).

export type TimelineInput = {
  startDate: string | null;
  days: number | null;
  endDate: string | null;
};

const day = (iso: string) => iso.slice(0, 10);

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Days left on the timeline as of `today` (negative once past it), or null when it can't be told. */
export function timelineDaysLeft(t: TimelineInput, today: string): { left: number; dayNo: number; total: number } | null {
  if (!t.startDate) return null;
  const start = day(t.startDate);
  const total = t.days != null && t.days > 0 ? t.days : t.endDate ? inclusiveDays(start, day(t.endDate)) : null;
  if (total == null) return null;
  const dayNo = inclusiveDays(start, today);
  if (dayNo == null) return null; // hasn't started yet
  return { left: total - dayNo, dayNo, total };
}

export function timelineMessage(left: number): string {
  if (left > 1) return `Complete within ${left} days`;
  if (left === 1) return "Complete within 1 day";
  if (left === 0) return "Due today";
  return `${-left} day${left === -1 ? "" : "s"} overdue`;
}

export function TimelineHint({
  status,
  startDate,
  days,
  endDate,
  className = "",
}: TimelineInput & { status: string; className?: string }) {
  if (status !== "IN_PROGRESS") return null;
  const r = timelineDaysLeft({ startDate, days, endDate }, localToday());
  if (!r) return null;
  const tone =
    r.left < 0
      ? "text-red-600 dark:text-red-400"
      : r.left <= 1
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <span
      title={`Day ${r.dayNo} of ${r.total}`}
      className={`block text-[0.625rem] leading-tight font-medium ${tone} ${className}`}
    >
      {timelineMessage(r.left)}
    </span>
  );
}
