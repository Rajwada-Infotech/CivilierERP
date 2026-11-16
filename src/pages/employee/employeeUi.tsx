// Small shared pieces for the Employee Portal pages: page heading, ruled card, stat tile, empty/error notes, formatters.
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

export const labelCls = "text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-muted-foreground";
export const fieldCls = "w-full h-10 px-3 bg-background border border-foreground/30 text-sm text-foreground outline-none focus:border-foreground disabled:opacity-60";
export const keyInk = "inline-flex items-center justify-center gap-1.5 h-9 px-4 bg-foreground text-background text-xs font-bold uppercase tracking-[0.12em] disabled:opacity-50";
export const keyLine = "inline-flex items-center justify-center gap-1.5 h-9 px-4 border border-foreground/40 text-foreground text-xs font-bold uppercase tracking-[0.12em] hover:bg-muted/50 disabled:opacity-50";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div>
        <p className={labelCls}>Employee Portal</p>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, right, children, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-foreground/30 bg-card ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-foreground/30">
          <h2 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="border border-foreground/30 bg-card p-4">
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
  return <div className="px-4 py-6"><div className="h-4 w-40 bg-muted animate-pulse" /></div>;
}

const TONES: Record<string, string> = {
  Approved: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  Present: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
  Pending: "text-amber-600 dark:text-amber-400 border-amber-500/40",
  "Half Day": "text-amber-600 dark:text-amber-400 border-amber-500/40",
  Rejected: "text-red-600 dark:text-red-400 border-red-500/40",
  Absent: "text-red-600 dark:text-red-400 border-red-500/40",
  "On Leave": "text-sky-600 dark:text-sky-400 border-sky-500/40",
  Holiday: "text-violet-600 dark:text-violet-400 border-violet-500/40",
};
export function Mark({ text, label }: { text: string; label?: string }) {
  return <span className={`inline-block px-2 py-0.5 border text-[0.625rem] font-bold uppercase tracking-[0.12em] ${TONES[text] ?? "text-muted-foreground border-foreground/30"}`}>{label ?? text}</span>;
}
