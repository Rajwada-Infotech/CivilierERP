// Depreciation run: months, money, and how each asset's state for the month reads as a sheet mark.
import type { GenerateAssetRow, GenerateOutcome, GeneratePreview } from "@/api/fixedAssetDepreciationGenerateApi";

export const fmtAmt = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const fmtDateTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** "YYYY-MM" of the month before today — the most recent month that has closed. */
export function lastClosedMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return ym(d);
}
export const currentMonth = () => ym(new Date());

type Tone = "done" | "waiting" | "stopped" | "none";

/** An asset's state for the month; what the last Generate click did to it wins over the preview. */
export function assetMark(r: GenerateAssetRow, outcome?: GenerateOutcome): { text: string; tone: Tone } {
  if (outcome === "generated") return { text: "Generated now", tone: "done" };
  if (outcome === "failed") return { text: "Failed", tone: "stopped" };
  if (r.state === "posted") return { text: "Posted", tone: "done" };
  if (r.state === "pending") return { text: "Due", tone: "waiting" };
  return { text: "Not eligible", tone: "none" };
}

export function monthMark(s: GeneratePreview["monthStatus"]): { text: string; tone: Tone } {
  if (s === "Generated") return { text: "Generated", tone: "done" };
  if (s === "Partially generated") return { text: "Partly generated", tone: "waiting" };
  return { text: "Not generated", tone: "none" };
}
