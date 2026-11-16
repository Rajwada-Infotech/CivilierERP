// Shared presentation pieces for HR & Payroll pages — display only, no data or behaviour.
// Drawn the way every other sheet page is drawn: ruled boxes, ink on paper, the sheet's four colours (ink, blue, red,
// graphite), figures in the heading face with tabular numbers.
import React from "react";
import { KEY_INK, TONE } from "@/components/sheet/sheetParts";

// ── Sheet styles for HR pages ────────────────────────────────────────────────────
export const HR_RULE = "1px solid hsl(var(--foreground))";
export const HR_LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HR_HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const HR_FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none rounded-none";
export const HR_NUM = "font-heading tabular-nums";

/** A ruled box on the sheet (was the glass card). */
export const hrCard = "bg-card border border-foreground rounded-none";

/** A row of summary figures, ruled like the sheet's stat rows. `tone` colours the figure. */
export function HrStatStrip({ items }: { items: { label: string; value: React.ReactNode; tone?: string; hint?: string }[] }) {
  const cols = items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 ${cols} bg-card`} style={{ border: HR_RULE }}>
      {items.map((it, i) => (
        <div key={it.label} className="px-4 py-3 min-w-0" style={{ borderLeft: i === 0 ? undefined : "1px solid hsl(var(--foreground) / 0.15)" }}>
          <p className={HR_LBL}>{it.label}</p>
          <p className={`${HR_NUM} text-xl font-bold leading-tight truncate mt-1.5`} style={{ color: it.tone }}>{it.value}</p>
          {it.hint && <p className="text-[0.6875rem] text-muted-foreground truncate mt-1">{it.hint}</p>}
        </div>
      ))}
    </div>
  );
}

/** Step heading that breaks a page into an ordered flow: the step's number in a square, the title in capitals. */
export function HrStepHead({ n, title, hint, right }: { n?: number; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="flex items-center gap-3 min-w-0">
        {n != null && (
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center border border-foreground text-[0.6875rem] font-bold text-foreground ${HR_NUM}`}>{n}</span>
        )}
        <div className="min-w-0">
          <p className={`${HR_HEAD} leading-tight`}>{title}</p>
          {hint && <p className="text-[0.6875rem] text-muted-foreground mt-0.5">{hint}</p>}
        </div>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/** Empty state: the icon in a ruled square, a line of text and an optional action. */
export function HrEmpty({ icon: Icon, title, text, action }: { icon: React.ElementType; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center border border-foreground text-foreground"><Icon size={20} /></span>
      <p className={HR_HEAD}>{title}</p>
      {text && <p className="text-xs text-muted-foreground max-w-sm">{text}</p>}
      {action}
    </div>
  );
}

/** Page-shaped loading placeholder (header strip + body). */
export function HrSkeleton({ rows = 1 }: { rows?: number }) {
  return (
    <div className="space-y-4 p-1">
      <div className="skel" style={{ height: 80 }} />
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel" style={{ height: 256 }} />)}
    </div>
  );
}

/** Error box in place of the plain red text line. */
export function HrError({ text }: { text: string }) {
  return <div className="m-6 border border-destructive bg-destructive/5 p-6 text-sm text-destructive">{text}</div>;
}

/** Initials in a ruled square. */
export function HrAvatar({ name, size = 32 }: { name?: string | null; size?: number }) {
  const ini = (name || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className={`inline-flex shrink-0 items-center justify-center border border-foreground font-bold text-foreground ${HR_NUM}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {ini}
    </span>
  );
}

/** The page's main action key (ink). Kept as a className + style pair for existing callers. */
export const hrPrimaryBtn = `${KEY_INK} h-9 px-4`;
export const hrPrimaryStyle: React.CSSProperties = {};

// ── Salary breakup (same shape the /salary-breakup, preview and payroll engines return) ──────────
// Earnings in ink, deductions in red, employer contributions in blue, informational in graphite.
const TYPE_TONE: Record<string, { bar: string; chip: string; label: string }> = {
  Earning: { bar: TONE.ink, chip: "border-foreground text-foreground", label: "Earning" },
  Deduction: { bar: TONE.red, chip: "border-destructive text-destructive", label: "Deduction" },
  "Employer Contribution": { bar: TONE.blue, chip: "border-primary text-primary", label: "Employer" },
  Informational: { bar: TONE.graphite, chip: "border-muted-foreground text-muted-foreground", label: "Info" },
};
export const hrTypeTone = (t?: string) => TYPE_TONE[t || ""] ?? TYPE_TONE.Informational;
const inr = (n: number) => "₹" + (n ?? 0).toLocaleString("en-IN");

export interface HrBreakupLine { DeductionAdditionId: number | string; HeadName: string; HeadType: string; Calculation?: string; Amount: number }
export interface HrBreakupTotals { GrossSalary: number; TotalEmployeeDeduction: number; NetSalary: number; TotalEmployerContribution: number; TotalCTC: number }

/** Total figures (Gross / Deduction / Net / Employer / CTC) + one row per component with its share of CTC. */
export function HrBreakup({ lines, totals }: { lines: HrBreakupLine[]; totals: HrBreakupTotals }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 bg-card" style={{ border: HR_RULE }}>
        {([
          ["Gross", totals.GrossSalary, TONE.ink],
          ["Employee deduction", totals.TotalEmployeeDeduction, TONE.red],
          ["Net salary", totals.NetSalary, TONE.ink],
          ["Employer contribution", totals.TotalEmployerContribution, TONE.blue],
          ["Total CTC", totals.TotalCTC, TONE.ink],
        ] as const).map(([l, v, c], i) => (
          <div key={l} className="px-3.5 py-2.5" style={{ borderLeft: i === 0 ? undefined : "1px solid hsl(var(--foreground) / 0.15)", background: l === "Total CTC" ? "hsl(var(--primary) / 0.06)" : undefined }}>
            <p className={HR_LBL}>{l}</p>
            <p className={`${HR_NUM} text-lg font-bold mt-1`} style={{ color: c }}>{inr(v)}</p>
          </div>
        ))}
      </div>
      <div className="bg-card divide-y divide-foreground/15 overflow-hidden" style={{ border: HR_RULE }}>
        {lines.map((l) => {
          const tone = hrTypeTone(l.HeadType);
          const pct = totals.TotalCTC ? Math.min(100, (Math.abs(l.Amount) / totals.TotalCTC) * 100) : 0;
          return (
            <div key={l.DeductionAdditionId} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="h-2 w-2 shrink-0" style={{ background: tone.bar }} />
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-foreground">{l.HeadName}</span>
                  {l.Calculation && <span className="ml-2 text-[0.6875rem] text-muted-foreground">{l.Calculation}</span>}
                </span>
                <span className={`hidden sm:inline-flex px-1.5 py-0.5 border font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] ${tone.chip}`}>{tone.label}</span>
                <span className={`w-28 text-right text-sm font-semibold ${HR_NUM}`}>{inr(l.Amount)}</span>
              </div>
              <div className="mt-1.5 ml-5 h-1 bg-foreground/10 overflow-hidden">
                <div className="h-full" style={{ width: `${pct}%`, background: tone.bar }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
