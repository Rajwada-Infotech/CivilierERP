// Shared presentation pieces for HR & Payroll pages — display only, no data or behaviour.
// Every page uses the same strip / step / empty / skeleton look so the module feels like one product.
import React from "react";
import { HR_PAYROLL_ACCENT as ACCENT, HR_GRADIENT } from "./HrPayrollShell";

export const hrCard = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";

/** A soft-tinted row of summary numbers. `tone` colours the number (defaults to foreground). */
export function HrStatStrip({ items }: { items: { label: string; value: React.ReactNode; tone?: string; hint?: string }[] }) {
  const cols = items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 ${cols} gap-2.5 rounded-2xl border p-3`} style={{ background: `${ACCENT}0a`, borderColor: `${ACCENT}2e` }}>
      {items.map((it) => (
        <div key={it.label} className="rounded-xl bg-card/80 border border-border px-3.5 py-2.5 shadow-sm min-w-0">
          <p className="text-xl font-heading font-bold tabular-nums leading-tight truncate" style={{ color: it.tone }}>{it.value}</p>
          <p className="text-[0.6875rem] text-muted-foreground truncate">{it.label}</p>
          {it.hint && <p className="text-[0.625rem] text-muted-foreground/80 truncate">{it.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Numbered step heading used to break a page into an ordered flow. */
export function HrStepHead({ n, title, hint, right }: { n?: number; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {n != null && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-sm" style={{ background: HR_GRADIENT }}>{n}</span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-heading font-semibold text-foreground leading-tight">{title}</p>
          {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Friendly empty state with the module's icon badge. */
export function HrEmpty({ icon: Icon, title, text, action }: { icon: React.ElementType; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: HR_GRADIENT }}><Icon size={22} /></span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {text && <p className="text-xs text-muted-foreground max-w-sm">{text}</p>}
      {action}
    </div>
  );
}

/** Page-shaped loading placeholder (header strip + body). */
export function HrSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-1">
      <div className="h-20 rounded-2xl bg-muted/60 animate-pulse" />
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-64 rounded-2xl bg-muted/40 animate-pulse" />)}
    </div>
  );
}

/** Error box in place of the plain red text line. */
export function HrError({ text }: { text: string }) {
  return <div className="m-6 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">{text}</div>;
}

/** Initials avatar in the module gradient. */
export function HrAvatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  const ini = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm" style={{ width: size, height: size, fontSize: size * 0.34, background: HR_GRADIENT }}>
      {ini}
    </span>
  );
}

/** The module's primary button look (gradient), for <button className={hrPrimaryBtn} style={hrPrimaryStyle}>. */
export const hrPrimaryBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-heading font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md disabled:opacity-40 disabled:hover:translate-y-0";
export const hrPrimaryStyle: React.CSSProperties = { background: HR_GRADIENT };

// ── Salary breakup (same shape the /salary-breakup, preview and payroll engines return) ──────────
const TYPE_TONE: Record<string, { bar: string; chip: string; label: string }> = {
  Earning: { bar: "#10b981", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", label: "Earning" },
  Deduction: { bar: "#ef4444", chip: "bg-red-500/10 text-red-600 dark:text-red-400", label: "Deduction" },
  "Employer Contribution": { bar: "#3b82f6", chip: "bg-blue-500/10 text-blue-600 dark:text-blue-400", label: "Employer" },
  Informational: { bar: "#94a3b8", chip: "bg-slate-500/10 text-slate-600 dark:text-slate-300", label: "Info" },
};
export const hrTypeTone = (t?: string) => TYPE_TONE[t || ""] ?? TYPE_TONE.Informational;
const inr = (n: number) => "₹" + (n ?? 0).toLocaleString("en-IN");

export interface HrBreakupLine { DeductionAdditionId: number | string; HeadName: string; HeadType: string; Calculation?: string; Amount: number }
export interface HrBreakupTotals { GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number; TotalEmployerContribution: number; TotalCTC: number }

/** Total tiles (Gross / Deduction / Net / Employer / CTC) + one row per component with its share of CTC. */
export function HrBreakup({ lines, totals }: { lines: HrBreakupLine[]; totals: HrBreakupTotals }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        {([
          ["Gross", totals.GrossSalary, "text-foreground"],
          ["Employee deduction", totals.TotalEmployeeDeduction, "text-red-500"],
          ["Net salary", totals.NetSalary, "text-emerald-600 dark:text-emerald-400"],
          ["Employer contribution", totals.TotalEmployerContribution, "text-blue-600 dark:text-blue-400"],
        ] as const).map(([l, v, c]) => (
          <div key={l} className="rounded-xl border border-border bg-background/50 px-3.5 py-2.5">
            <p className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">{l}</p>
            <p className={`text-lg font-heading font-bold tabular-nums ${c}`}>{inr(v)}</p>
          </div>
        ))}
        <div className="rounded-xl px-3.5 py-2.5 text-white shadow-sm col-span-2 lg:col-span-1" style={{ background: HR_GRADIENT }}>
          <p className="text-[0.625rem] uppercase tracking-wider text-white/80">Total CTC</p>
          <p className="text-lg font-heading font-bold tabular-nums">{inr(totals.TotalCTC)}</p>
        </div>
      </div>
      <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden">
        {lines.map((l) => {
          const tone = hrTypeTone(l.HeadType);
          const pct = totals.TotalCTC ? Math.min(100, (Math.abs(l.Amount) / totals.TotalCTC) * 100) : 0;
          return (
            <div key={l.DeductionAdditionId} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.bar }} />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{l.HeadName}</span>
                  {l.Calculation && <span className="ml-2 text-[0.6875rem] text-muted-foreground">{l.Calculation}</span>}
                </span>
                <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-full text-[0.625rem] font-semibold ${tone.chip}`}>{tone.label}</span>
                <span className="w-28 text-right text-sm font-semibold tabular-nums">{inr(l.Amount)}</span>
              </div>
              <div className="mt-1.5 ml-5 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone.bar }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
