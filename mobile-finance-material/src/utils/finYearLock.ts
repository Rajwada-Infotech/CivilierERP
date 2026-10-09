// Which financial year a NEW document is locked to:
//   1. the year that contains today's date, else
//   2. the most recent year (the latest one that has already ended; if every
//      year is still in the future, the earliest of them).
// Forms used to leave the year on "Auto" or let it be picked by hand, so new
// documents could land in an old year.

import { istToday } from "./istTime";

export interface FinYearWindow {
  /** YYYY-MM-DD (an ISO date-time is accepted; only the date part is used). */
  start: string;
  end: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");

/** Today as YYYY-MM-DD on the India calendar (not the phone's zone, not UTC). */
export function localToday(now: Date = new Date()): string {
  return istToday(now.getTime());
}

export function pickLockedFinYear<T>(
  list: T[] | null | undefined,
  windowOf: (item: T) => FinYearWindow | null | undefined,
  today: string = localToday(),
): T | null {
  const rows: Array<{ item: T; start: string; end: string }> = [];
  for (const item of list ?? []) {
    const w = windowOf(item);
    if (!w) continue;
    const start = day(w.start);
    const end = day(w.end);
    if (DATE_RE.test(start) && DATE_RE.test(end)) rows.push({ item, start, end });
  }
  if (!rows.length) return null;

  // 1. The year that contains today (if several, the latest-starting).
  const current = rows
    .filter((r) => r.start <= today && today <= r.end)
    .sort((a, b) => (a.start < b.start ? 1 : -1));
  if (current.length) return current[0].item;

  // 2. Otherwise the most recent year that has already ended.
  const past = rows
    .filter((r) => r.end < today)
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : a.start < b.start ? 1 : -1));
  if (past.length) return past[0].item;

  // 3. Every year is still in the future — take the earliest.
  return [...rows].sort((a, b) => (a.start < b.start ? -1 : 1))[0].item;
}
