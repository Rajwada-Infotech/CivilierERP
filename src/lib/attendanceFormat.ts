// Shared formatting for the Employee Attendance screens. Punch times are stored in UTC and shown
// in Indian Standard Time (the business calendar), whatever the viewer's browser time zone is.

const IST = "Asia/Kolkata";

export const fmtTimeIst = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

export const fmtDateTimeIst = (iso?: string | null): string =>
  iso
    ? new Date(iso).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })
    : "—";

export const fmtDateIst = (isoDate?: string | null): string =>
  isoDate ? new Date(`${isoDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric", weekday: "short" }) : "—";

/** 29700 → "8 h 15 m"; under a minute → "42 s"; null → "—". */
export function fmtDuration(totalSeconds?: number | null): string {
  if (totalSeconds == null) return "—";
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

/** "HH:MM:SS" for the live clock / running timers. */
export function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** ISO instant → value for <input type="datetime-local"> expressed in IST. */
export function toIstInput(iso?: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** <input type="datetime-local"> value (read as IST) → ISO instant. */
export function fromIstInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export const todayIstDate = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
