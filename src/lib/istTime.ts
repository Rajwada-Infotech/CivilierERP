// The database stamps rows with SYSDATETIME(), and the production SQL Server
// (a Linux container) keeps UTC. The API serialises that wall clock as an ISO
// string, sometimes with a trailing "Z" and sometimes without. Either way the
// value is UTC, so it is read as UTC and always displayed in India Standard
// Time (UTC+5:30) — whatever timezone the viewer's own device is set to.

const IST_ZONE = "Asia/Kolkata";

/** Parses a server timestamp as UTC (a missing zone marker is treated as UTC). */
export function parseServerUtc(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  const d = new Date(hasZone ? value : `${value.trim().replace(" ", "T")}Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** "04 Oct 2026, 10:47 am" — IST, 12-hour. Returns the input untouched if unparseable. */
export function fmtIstDateTime(
  value: string | Date | null | undefined,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
): string {
  if (!value) return "—";
  const d = parseServerUtc(value);
  if (!d) return String(value);
  return d.toLocaleString("en-IN", { ...opts, timeZone: IST_ZONE });
}

/** "2026-10-04 10:47" (or with seconds) — IST, 24-hour, for compact table cells. */
export function fmtIstIso(value: string | Date | null | undefined, withSeconds = false): string {
  if (!value) return "";
  const d = parseServerUtc(value);
  if (!d) return String(value);
  // sv-SE renders as "YYYY-MM-DD HH:mm:ss".
  const s = d.toLocaleString("sv-SE", { timeZone: IST_ZONE, hourCycle: "h23" });
  return withSeconds ? s : s.slice(0, 16);
}
