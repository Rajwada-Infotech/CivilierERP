// Everything in this app is India time, whatever time zone the phone itself is set to.
//
// Two rules:
//  1. "Today" and "now" are read from the IST calendar and clock. Never `new Date().toISOString().slice(0, 10)`
//     (that is the UTC date: between midnight and 5:30 am IST it is still yesterday) and never the phone's
//     getHours() / toLocaleTimeString() (they follow the phone's zone).
//  2. A time that comes back from the API for a typed-in IST time (Vehicle In/Out entry and exit) carries a "Z",
//     but its digits ARE the IST wall-clock reading - the server stores what was typed. Show those digits as they
//     are (timeZone "UTC") instead of converting them to the phone's zone, which added 5h 30m.
//
// IST is a fixed UTC+5:30 (no daylight saving), so shifting the clock by that offset and then reading it as UTC is
// exact - and it needs nothing from the device's Intl time-zone data.

export const IST_OFFSET_MS = 330 * 60 * 1000;

const shifted = (ms: number) => new Date(ms + IST_OFFSET_MS);

/** Today in India, "YYYY-MM-DD". */
export const istToday = (now: number = Date.now()): string => shifted(now).toISOString().slice(0, 10);

/** The India wall clock now, "YYYY-MM-DDTHH:mm" - the shape the date-time pickers and the API use. */
export const istNowInput = (now: number = Date.now()): string => shifted(now).toISOString().slice(0, 16);

/** Hour of day in India, 0-23. */
export const istHour = (now: number = Date.now()): number => shifted(now).getUTCHours();

/** "05:10 pm" for a moment in time (a React Query `dataUpdatedAt`, say), in India time. */
export const fmtIstClock = (ms: number): string =>
  shifted(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** "08 Oct 2026, 05:10 pm" for a moment in time, in India time. */
export const fmtIstStamp = (ms: number): string =>
  shifted(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/**
 * A server time whose digits are already the IST wall clock (see rule 2), formatted as they stand.
 * Returns the input unchanged if it is not a date.
 */
export function fmtWallClock(value: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString("en-IN", { ...options, timeZone: "UTC" });
}
