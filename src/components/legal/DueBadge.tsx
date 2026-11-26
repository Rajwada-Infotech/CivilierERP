import React from "react";

/**
 * One look for every due / target / expiry / next-hearing date in the Legal module:
 *   overdue → red · due today → amber · within 7 days → blue · later → plain.
 * `done` (work finished / closed) shows the date plain, without a warning.
 */
export type DueLevel = "overdue" | "today" | "soon" | "later" | "none";

const DAY = 86_400_000;
const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export function daysUntil(date: string | Date | null | undefined): number | null {
  if (!date) return null;
  const d = typeof date === "string" ? new Date(date.length === 10 ? `${date}T00:00:00` : date) : date;
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((startOf(d) - startOf(new Date())) / DAY);
}
export function dueLevel(date: string | Date | null | undefined, soonDays = 7): DueLevel {
  const n = daysUntil(date);
  if (n == null) return "none";
  return n < 0 ? "overdue" : n === 0 ? "today" : n <= soonDays ? "soon" : "later";
}
export const DUE_TEXT: Record<DueLevel, string> = {
  overdue: "text-destructive", today: "text-amber-700 dark:text-amber-400", soon: "text-sky-700 dark:text-sky-400", later: "text-foreground", none: "text-muted-foreground",
};
export const DUE_BG: Record<DueLevel, string> = {
  overdue: "border-destructive/50 bg-destructive/10", today: "border-amber-500/50 bg-amber-500/10", soon: "border-sky-500/40 bg-sky-500/10", later: "border-transparent", none: "border-transparent",
};
/** Row background for a list row with this due date (only when it needs attention). */
export const dueRow = (date: string | Date | null | undefined, done = false) => {
  if (done) return "";
  const l = dueLevel(date);
  return l === "overdue" ? "bg-destructive/5" : l === "today" ? "bg-amber-500/5" : "";
};
export function dueHint(date: string | Date | null | undefined, kind: "due" | "expires" | "hearing" = "due"): string {
  const n = daysUntil(date);
  if (n == null) return "";
  const verb = kind === "expires" ? "expires" : kind === "hearing" ? "hearing" : "due";
  if (n < 0) return kind === "expires" ? `expired ${-n} day${n === -1 ? "" : "s"} ago` : kind === "hearing" ? `${-n} day${n === -1 ? "" : "s"} ago` : `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return `${verb} today`;
  if (n === 1) return `${verb} tomorrow`;
  return `${verb} in ${n} days`;
}
const fmt = (date: string | Date) => new Date(typeof date === "string" && date.length === 10 ? `${date}T00:00:00` : date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** A due date with its colour and a short "3 days overdue / due in 2 days" note. */
export function DueBadge({ date, done = false, kind = "due", label, compact = false, empty = "—", soon = 7 }: {
  date: string | Date | null | undefined; done?: boolean; kind?: "due" | "expires" | "hearing"; label?: string; compact?: boolean; empty?: string; soon?: number;
}) {
  if (!date) return <span className="text-muted-foreground">{empty}</span>;
  const level = done ? "later" : dueLevel(date, soon);
  const hint = done ? "" : dueHint(date, kind);
  const warn = level === "overdue" || level === "today" || level === "soon";
  return (
    <span title={hint || undefined} className={`inline-flex flex-col leading-tight ${warn ? `border px-1.5 py-0.5 ${DUE_BG[level]}` : ""}`}>
      <span className={warn ? `font-semibold ${DUE_TEXT[level]}` : ""}>{label ? `${label} ` : ""}{fmt(date)}</span>
      {!compact && warn && <span className={`text-[0.6875rem] ${DUE_TEXT[level]}`}>{hint}</span>}
    </span>
  );
}
