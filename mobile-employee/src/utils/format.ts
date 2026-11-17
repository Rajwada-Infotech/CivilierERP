// Dates and times shown in Indian time; the backend sends UTC ISO strings.
const IST = "Asia/Kolkata";
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST }) : "—";

export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return `${String(day).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
};

export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST }) : "—";

export const fmtDur = (sec?: number | null) => {
  if (sec == null) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

export const rupee = (v: unknown) => `₹${(Number(v) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Today's date in India as YYYY-MM-DD. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
