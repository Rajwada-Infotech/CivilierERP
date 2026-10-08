// Work Allocation: Start Date, Days and End Date move together.
//
//   • Days comes from the Activity Master's "Days of Completion" (editable here).
//   • Give a Start Date  → the End Date is worked out.
//   • Give an End Date   → a tentative Start Date is worked out (flagged `startAuto`, so a later
//                           End Date edit moves it again instead of being read as a real choice).
//   • Counting is inclusive: 5 days starting on the 5th finishes on the 9th.
//
// Pure functions on ISO "YYYY-MM-DD" strings, using UTC date math — local-time math is off by a
// day in timezones ahead of UTC (toISOString() converts a local midnight back to the day before).

export type AllocDates = {
  startDate: string;
  endDate: string;
  /** Kept as the input's own string so a half-typed value doesn't get rewritten. */
  days: string;
  /** The start date was derived from the end date, not typed by the user. */
  startAuto: boolean;
};

const MS_DAY = 86_400_000;

function toUtc(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(dateStr: string, n: number): string {
  return new Date(toUtc(dateStr) + n * MS_DAY).toISOString().slice(0, 10);
}

/** Whole days from start to end, inclusive of both (same day = 1); null if end is before start. */
export function inclusiveDays(startStr: string, endStr: string): number | null {
  const diff = Math.round((toUtc(endStr) - toUtc(startStr)) / MS_DAY);
  return diff >= 0 ? diff + 1 : null;
}

/** A usable day count (≥ 1), or null while the field is empty / not a number. */
function parseDays(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

const endFor = (start: string, n: number) => addDays(start, n - 1);
const startFor = (end: string, n: number) => addDays(end, -(n - 1));

export function changeStart(s: AllocDates, value: string): AllocDates {
  const n = parseDays(s.days);
  const next: AllocDates = { ...s, startDate: value, startAuto: false };
  if (value && n != null) next.endDate = endFor(value, n);
  return next;
}

export function changeEnd(s: AllocDates, value: string): AllocDates {
  const n = parseDays(s.days);
  const next: AllocDates = { ...s, endDate: value };
  if (!value) return next;
  if ((!s.startDate || s.startAuto) && n != null) {
    next.startDate = startFor(value, n);
    next.startAuto = true;
  } else if (s.startDate) {
    // A start the user picked and an end they picked — the span is theirs; Days follows it.
    const d = inclusiveDays(s.startDate, value);
    if (d != null) next.days = String(d);
  }
  return next;
}

export function changeDays(s: AllocDates, value: string): AllocDates {
  const n = parseDays(value);
  const next: AllocDates = { ...s, days: value };
  if (n == null) return next;
  if (s.endDate && (!s.startDate || s.startAuto)) {
    next.startDate = startFor(s.endDate, n);
    next.startAuto = true;
  } else if (s.startDate) {
    next.endDate = endFor(s.startDate, n);
  }
  return next;
}

/** Fill Days from the Activity Master when nothing is set yet (and carry it through to the dates). */
export function applyDefaultDays(s: AllocDates, masterDays: number | null | undefined): AllocDates {
  if (masterDays == null || masterDays < 1 || s.days.trim() !== "") return s;
  return changeDays(s, String(masterDays));
}
