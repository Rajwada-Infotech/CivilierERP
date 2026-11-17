// Shared pieces for the Employee Portal pages: page heading, rounded card, stat tile, empty/error notes, formatters.
// The look (orange + deep teal, rounded tiles) comes from the .ep-* classes in components/layout/EmployeeLayout.tsx.
import React from "react";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const inr = (n: number | null | undefined) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** A date-only value (or a UTC midnight timestamp from the server) as 05 Nov 2026. */
export const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
export const fmtWeekday = (d: string) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
/** A real moment (UTC ISO from the server) in Indian time. */
export const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
export const fmtTime = (d?: string | null) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";

export const labelCls = "text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-muted-foreground";
export const fieldCls = "ep-field";
export const keyInk = "ep-btn ep-btn-gold";
export const keyLine = "ep-btn ep-btn-line";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.14em]" style={{ color: "hsl(var(--ep-gold))" }}>Employee Portal</p>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, right, children, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`ep-card ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/70">
          <h2 className="font-heading text-sm font-bold">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="ep-card p-4">
      <p className={labelCls}>{label}</p>
      <p className="font-heading text-2xl font-bold mt-1 tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground mt-0.5">{note}</p>}
    </div>
  );
}

export function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" }) {
  return <p className={`px-4 py-6 text-sm ${tone === "error" ? "text-destructive" : "text-muted-foreground"}`}>{children}</p>;
}

export function Loading() {
  return <div className="px-4 py-6"><div className="h-4 w-40 rounded-full bg-muted animate-pulse" /></div>;
}

const TONES: Record<string, string> = {
  Approved: "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300",
  Present: "text-emerald-700 bg-emerald-500/15 dark:text-emerald-300",
  Pending: "text-amber-700 bg-amber-500/15 dark:text-amber-300",
  "Half Day": "text-amber-700 bg-amber-500/15 dark:text-amber-300",
  Rejected: "text-red-700 bg-red-500/15 dark:text-red-300",
  Absent: "text-red-700 bg-red-500/15 dark:text-red-300",
  "On Leave": "text-sky-700 bg-sky-500/15 dark:text-sky-300",
  Holiday: "text-violet-700 bg-violet-500/15 dark:text-violet-300",
};
export function Mark({ text, label }: { text: string; label?: string }) {
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[0.625rem] font-bold uppercase tracking-[0.08em] ${TONES[text] ?? "text-muted-foreground bg-muted"}`}>{label ?? text}</span>;
}

/** True in the tab HR / Super Admin opened with "View employee portal": the portal is read-only there. */
export const isViewOnly = (): boolean => typeof window !== "undefined" && sessionStorage.getItem("ep_view_as") != null;
export const viewOnlyInfo = (): { employeeName: string; viewer: string } | null => {
  try { const raw = typeof window !== "undefined" ? sessionStorage.getItem("ep_view_as") : null; return raw ? JSON.parse(raw) : null; } catch { return null; }
};
