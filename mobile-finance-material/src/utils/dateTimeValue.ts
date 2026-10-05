// Pure date/time helpers for DateTimeField. Values are local wall-clock strings,
// "YYYY-MM-DDTHH:mm" — the same shape the Vehicle In/Out form and API already
// use — so nothing is converted through UTC and nothing shifts by a time zone.

export interface LocalDateTime {
  y: number;
  /** 1-12 */
  m: number;
  d: number;
  /** 0-23 */
  h: number;
  /** 0-59 */
  min: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
/** Monday-first, as on an Indian calendar. */
export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** Accepts "YYYY-MM-DDTHH:mm[:ss[.sss]][Z]", a space instead of T, or a bare date (-> 00:00). */
export function parseLocal(value: string | null | undefined): LocalDateTime | null {
  const m = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] != null ? Number(m[4]) : 0;
  const min = m[5] != null ? Number(m[5]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || min > 59) return null;
  return { y, m: mo, d, h, min };
}

export function toLocalString(v: LocalDateTime): string {
  return `${v.y}-${pad(v.m)}-${pad(v.d)}T${pad(v.h)}:${pad(v.min)}`;
}

export function fromDate(date: Date = new Date()): LocalDateTime {
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), min: date.getMinutes() };
}

export function to12h(h: number): { hour12: number; pm: boolean } {
  return { hour12: h % 12 === 0 ? 12 : h % 12, pm: h >= 12 };
}

export function from12h(hour12: number, pm: boolean): number {
  return (hour12 % 12) + (pm ? 12 : 0);
}

/** "YYYY-MM-DD" for a date-only field. */
export function toDateString(v: LocalDateTime): string {
  return `${v.y}-${pad(v.m)}-${pad(v.d)}`;
}

/** "04 Oct 2026" — empty string for an empty/invalid value. */
export function formatDateDisplay(value: string | null | undefined): string {
  const v = parseLocal(value);
  return v ? `${pad(v.d)} ${MONTH_SHORT[v.m - 1]} ${v.y}` : "";
}

/** "04 Oct 2026, 05:10 PM" — empty string for an empty/invalid value. */
export function formatDisplay(value: string | null | undefined): string {
  const v = parseLocal(value);
  if (!v) return "";
  const { hour12, pm } = to12h(v.h);
  return `${pad(v.d)} ${MONTH_SHORT[v.m - 1]} ${v.y}, ${pad(hour12)}:${pad(v.min)} ${pm ? "PM" : "AM"}`;
}

/**
 * Weeks of a month, Monday-first; null pads the days that belong to the
 * neighbouring months. Always whole weeks (4-6 rows).
 */
export function monthGrid(y: number, m: number): (number | null)[][] {
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Mon=0 .. Sun=6
  const cells: (number | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth(y, m) }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Month +/- delta with year roll-over. */
export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

/** Keeps the day valid when moving to a shorter month (31 Jan -> Feb). */
export function clampDay(y: number, m: number, d: number): number {
  return Math.min(d, daysInMonth(y, m));
}
