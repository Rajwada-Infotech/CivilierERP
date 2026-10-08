// Times shown on the Maintenance page and the admin switch. The business runs on India time, so every time here
// is written in IST whatever the viewer's computer is set to.

const TZ = "Asia/Kolkata";

/** "1h 05m 09s", "12m 03s", "42s" - never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** How far through the planned window we are, 0..1. Null when there is no end or no start to measure from. */
export function maintenanceProgress(startedAt: string | null, endsAt: string | null, now: number): number | null {
  if (!startedAt || !endsAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

/** "Thu, 8 Oct, 5:30 pm IST" */
export function formatIst(iso: string): string {
  const text = new Date(iso).toLocaleString("en-IN", {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${text.replace(/\bam\b/i, "am").replace(/\bpm\b/i, "pm")} IST`;
}

/** The value a <input type="datetime-local"> shows for an instant, in IST ("2026-10-08T17:30"). */
export function toIstInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** The instant an IST "datetime-local" value stands for. Null when it is empty or not a date. */
export function fromIstInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}
