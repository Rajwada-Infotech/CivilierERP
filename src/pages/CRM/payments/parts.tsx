// Payment Milestones' parts. The list's masthead and columns; the plan's ribbon, its money trail, its full schedule, and
// the deposits, Finance entries and price, every one shown on the page.
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CrmStatus } from "@/constants/crmStatuses";
import { translateError } from "@/lib/translateError";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Hourglass, MessageSquare, Percent, Send, Undo2, Wallet } from "lucide-react";
import { CrmRowMenu, GRID_CARD, GRID_SHEET_KEYS, GridDialog, GridMiniTable, GridRelated, GridStatusPill, GridToneMark, type GridCol } from "@/components/crm/CrmDataTable";
import { cn } from "@/lib/utils";
import { daysLate, fmt, fmtDate, fmtShort, isOverdue, milestoneFill, nextOpenMilestone, pct, MONEY_STAGE, RIBBON, TRAIL_STAGE, type LedgerRow, type LedgerSummary } from "./config";
import { reverseWaiver, waiverState } from "./config";

export const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
export const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
export const TONE_ROSE_TEXT = "text-rose-400 [[data-theme]_&]:text-rose-700";
export const TONE_SKY_TEXT = "text-sky-400 [[data-theme]_&]:text-sky-700";

const { KEY_INK, KEY_LINE, LBL, TEXTAREA } = GRID_SHEET_KEYS;
const SMALL_KEY = "h-7 px-2.5";
const dash = <span className="text-muted-foreground">—</span>;

// ── The ribbon ───────────────────────────────────────────────────────────────
/** A plan as one slim bar: each milestone a segment as wide as its amount, filled with the money against it. */
export function PlanRibbon({ plan, activeId, onPick, onDark }: { plan: any[]; activeId?: number | null; onPick: (m: any) => void; onDark?: boolean }) {
  // On the masthead's dark ground the empty parts sit back and the late money stands out.
  const lateCls = onDark ? BAND_DOT.overdue : RIBBON.overdue.cls;
  const openCls = onDark ? "bg-white/15" : RIBBON.open.cls;
  if (!plan.length) return null;
  return (
    <div className="flex h-2.5 gap-0.5 rounded-full overflow-hidden" role="group" aria-label="The payment plan: open a milestone">
      {plan.map((m) => {
        const f = milestoneFill(m);
        const late = isOverdue(m);
        const tip = [
          `${m.MilestoneNo}. ${m.MilestoneName}: ${fmt(m.AmountDue)}`,
          f.settled > 0 ? `${RIBBON.settled.label} ${fmt(f.settled)}` : null,
          f.held > 0 ? `${RIBBON.held.label} ${fmt(f.held)}` : null,
          f.finance > 0 ? `${RIBBON.finance.label} ${fmt(f.finance)}` : null,
          f.recorded > 0 ? `${RIBBON.recorded.label} ${fmt(f.recorded)}` : null,
          f.waived ? "Waived" : f.missing > 0 ? `${late ? "Overdue" : "Still to come"} ${fmt(f.missing)}` : null,
        ].filter(Boolean).join(" · ");
        return (
          <button key={m.Id} type="button" onClick={() => onPick(m)} title={tip} aria-label={tip} aria-pressed={activeId === m.Id}
            style={{ flex: `${Math.max(Number(m.AmountDue) || 0, 1)} 1 0`, minWidth: 6 }}
            className={cn("flex h-full outline-none focus-visible:ring-2 focus-visible:ring-primary hover:opacity-75", f.waived ? RIBBON.waived.cls : late ? lateCls : openCls, activeId === m.Id && (onDark ? "ring-2 ring-inset ring-white" : "ring-2 ring-inset ring-foreground"))}>
            {!f.waived && f.due > 0 && (
              <>
                {f.settled > 0 && <span className={RIBBON.settled.cls} style={{ width: `${(f.settled / f.due) * 100}%` }} />}
                {f.held > 0 && <span className={RIBBON.held.cls} style={{ width: `${(f.held / f.due) * 100}%` }} />}
                {f.finance > 0 && <span className={RIBBON.finance.cls} style={{ width: `${(f.finance / f.due) * 100}%` }} />}
                {f.recorded > 0 && <span className={RIBBON.recorded.cls} style={{ width: `${(f.recorded / f.due) * 100}%` }} />}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function RibbonLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
      {[RIBBON.settled, RIBBON.held, RIBBON.finance, RIBBON.recorded, RIBBON.overdue, RIBBON.open].map((k) => (
        <span key={k.label} className="inline-flex items-center gap-1"><span className={cn("w-2.5 h-2 rounded-[2px]", k.cls)} /> {k.label}</span>
      ))}
    </div>
  );
}

// ── The work queue ───────────────────────────────────────────────────────────
/** The page's masthead: what this is, the money that matters most in large type, the rest beside it. */
export function MoneyBand({ eyebrow, title, sub, status, actions, lead, leadNote, bar, figures, footer }: {
  eyebrow: string; title: React.ReactNode; sub?: React.ReactNode; status?: React.ReactNode; actions?: React.ReactNode;
  lead: string; leadNote: string; bar: React.ReactNode; footer?: React.ReactNode;
  figures: { label: string; dot?: string; value: string; note: string; exact?: string; alert?: boolean }[];
}) {
  return (
    <section className="rounded-xl bg-slate-900 text-white px-6 py-5" aria-label={eyebrow}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* The title block takes the room left beside the buttons (a long subtitle wraps), so the buttons stay top right. */}
        <div className="min-w-0 flex-1 basis-80">
          <div className="text-xs font-medium text-slate-400">{eyebrow}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {sub && <div className="mt-0.5 text-[0.8125rem] text-slate-400">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,2fr)] gap-x-10 gap-y-4 items-end">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[2rem] leading-none font-semibold tabular-nums tracking-tight whitespace-nowrap">{lead}</span>
            <span className="text-[0.8125rem] text-slate-400 tabular-nums">{leadNote}</span>
          </div>
          <div className="mt-3">{bar}</div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0 border-l border-white/10 pl-4" title={f.exact}>
              <dt className="flex items-center gap-1.5 text-xs text-slate-400">{f.dot && <span className={cn("w-2 h-2 rounded-full shrink-0", f.dot)} />}{f.label}</dt>
              <dd className={cn("mt-1 text-lg xl:text-xl font-semibold tabular-nums tracking-tight whitespace-nowrap", f.alert && "text-rose-300")}>{f.value}</dd>
              <dd className="mt-0.5 text-[0.6875rem] leading-snug text-slate-400 line-clamp-2" title={f.note}>{f.note}</dd>
            </div>
          ))}
        </dl>
      </div>
      {footer && <div className="mt-4 pt-3 border-t border-white/10 text-[0.8125rem] text-slate-300">{footer}</div>}
    </section>
  );
}

export const BAND_KEY = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-white/25 text-xs font-medium text-white hover:bg-white/10 disabled:opacity-50";
export const BAND_KEY_MAIN = "inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-white text-xs font-semibold text-slate-900 hover:bg-slate-100";

// The money's colours on the masthead's dark ground and on the rows' white one.
export const BAND_DOT = { collected: "bg-emerald-400", held: RIBBON.held.cls, finance: "bg-amber-300", recorded: RIBBON.recorded.cls, notDue: "bg-slate-500", overdue: "bg-rose-400" };
const ROW_FILL = { collected: "bg-emerald-500", finance: "bg-amber-400", overdue: "bg-rose-500" };

/** Every rupee received (plus overdue exposure) as one line against all that is due. */
export function CollectionBar({ due, collected, finance, recorded, overdue = 0, onDark, title }: { due: number; collected: number; finance: number; recorded: number; overdue?: number; onDark?: boolean; title?: string }) {
  let remaining = 100;
  const w = (n: number) => {
    const width = due > 0 ? Math.min(remaining, Math.max(0, (n / due) * 100)) : 0;
    remaining = Math.max(0, remaining - width);
    return `${width}%`;
  };
  const collectedWidth = w(collected);
  const financeWidth = w(finance);
  const recordedWidth = w(recorded);
  const overdueWidth = w(overdue);
  return (
    <span aria-hidden="true" className={cn("flex w-full rounded-full overflow-hidden", onDark ? "h-2.5 bg-white/15" : "h-1.5 bg-muted [[data-theme]_&]:bg-slate-200")} title={title}>
      {collected > 0 && <span className={onDark ? BAND_DOT.collected : "bg-emerald-500"} style={{ width: collectedWidth }} />}
      {finance > 0 && <span className={onDark ? BAND_DOT.finance : "bg-amber-400"} style={{ width: financeWidth }} />}
      {recorded > 0 && <span className={RIBBON.recorded.cls} style={{ width: recordedWidth }} />}
      {overdue > 0 && <span className={onDark ? BAND_DOT.overdue : RIBBON.late.cls} style={{ width: overdueWidth }} />}
    </span>
  );
}

/** A person's two initials. */
export function Initials({ name, small }: { name: string | null; small?: boolean }) {
  const parts = String(name || "?").trim().split(/\s+/);
  const text = `${parts[0]?.[0] || "?"}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
  return <span className={cn("shrink-0 rounded-full bg-primary/15 text-primary border border-primary/25 [[data-theme]_&]:bg-primary/10 font-semibold flex items-center justify-center", small ? "w-6 h-6 text-[0.625rem]" : "w-8 h-8 text-[0.6875rem]")}>{text}</span>;
}
/** Names come in as typed, often all capitals: on the list they read as names. */
export const asName = (s: string | null) => String(s || "").toLowerCase();
/** asName lower-cases for the CSS to capitalise; text that is not styled (dialog subtitles, exports) needs the capitals itself. */
export const personName = (s?: string | null) => asName(s ?? null).replace(/(^|[\s.&-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

export type StepState = "done" | "active" | "stopped" | "off";
/** A record's steps as one bar: green when done, amber in hand, red when stopped. Labelled under each step, or, for
 *  many steps, one caption naming where it stands. */
export function StepBar({ steps, onDark, caption }: { steps: { label: string; state: StepState }[]; onDark?: boolean; caption?: React.ReactNode }) {
  const fill: Record<StepState, string> = {
    done: onDark ? BAND_DOT.collected : "bg-emerald-500", active: onDark ? BAND_DOT.finance : "bg-amber-400", stopped: "bg-rose-500",
    off: onDark ? "bg-white/15" : "bg-muted border border-border/50 [[data-theme]_&]:bg-slate-200/80 [[data-theme]_&]:border-transparent",
  };
  const ink: Record<StepState, string> = {
    done: onDark ? "text-slate-200" : "text-foreground", active: onDark ? "text-white font-semibold" : "text-foreground font-semibold",
    stopped: onDark ? "text-rose-300 font-semibold" : "text-destructive font-semibold", off: onDark ? "text-slate-400" : "text-muted-foreground",
  };
  return (
    <span className="block w-full">
      <span className="grid gap-1 w-full" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <span key={s.label} className="min-w-0" title={`${s.label}: ${s.state === "off" ? "not started" : s.state}`}>
            <span className={cn("block rounded-full", onDark ? "h-2.5" : "h-1.5", fill[s.state])} />
            {caption === undefined && <span className={cn("mt-1 block text-[0.6875rem] truncate", ink[s.state])}>{s.label}</span>}
          </span>
        ))}
      </span>
      {caption !== undefined && <span className={cn("mt-1.5 block text-[0.6875rem] truncate", onDark ? "text-slate-200" : "text-muted-foreground")}>{caption}</span>}
    </span>
  );
}

/** The band's last line: what happens next, and the one button that does it. */
export function BandNext({ text, finished, action }: { text: string; finished?: boolean; action?: { label: string; run: () => void } | null }) {
  return (
    <span className="flex flex-wrap items-center justify-between gap-3">
      <span>{finished ? text : <>Next step: <strong className="font-semibold text-white">{text}</strong></>}</span>
      {action && <button type="button" onClick={action.run} className={BAND_KEY_MAIN}>{action.label} <ArrowRight size={13} /></button>}
    </span>
  );
}

/** The next step on a booking, in words, from its plan. */
function nextStep(r: LedgerRow) {
  if (r.Closed) return <GridStatusPill status={r.BookingStatus} />;
  if (!r.PlanCount) return <span className="text-muted-foreground">No schedule yet</span>;
  const m = nextOpenMilestone(r.plan || []);
  if (!m) {
    const pendingStages = [
      Number(r.WithFinance) > 0 ? `${fmtShort(r.WithFinance)} pending with Finance` : null,
      Number(r.Recorded) > 0 ? `${fmtShort(r.Recorded)} awaiting booking approval` : null,
    ].filter(Boolean);
    return <span className="text-muted-foreground">{pendingStages.length ? pendingStages.join(" · ") : "All covered"}</span>;
  }
  return <span>{m.MilestoneName} <span className="tabular-nums font-semibold">{fmt(milestoneFill(m).missing)}</span></span>;
}
// An ageing figure: a dash for nothing, so the eye goes to the money, and the later the money the stronger the ink.
const AGE_INK: Record<string, string> = {
  d30: "text-amber-300 [[data-theme]_&]:text-amber-700",
  d60: "text-orange-300 [[data-theme]_&]:text-orange-700",
  d90: "text-rose-400 [[data-theme]_&]:text-rose-600",
  d90p: "text-rose-400 [[data-theme]_&]:text-rose-700 font-semibold",
};
const money = (n: number, ink?: string) => (Number(n) > 0 ? <span className={cn("tabular-nums", ink)}>{fmt(n)}</span> : dash);
const notDue = (r: LedgerRow) => Math.max(0, Math.round((Number(r.ToCollect) - Number(r.OverdueAmount)) * 100) / 100);

// The rungs' keys are the server's (LEDGER_AGES in crmPayments.js).
const AGE_COLS: GridCol<LedgerRow>[] = [["d30", "1–30 days"], ["d60", "31–60 days"], ["d90", "61–90 days"], ["d90p", "Over 90 days"]].map(([key, label]) => ({
  id: `age_${key}`, label, align: "right" as const, sortKey: `A_${key}`, hiddenByDefault: true,
  cell: (r: LedgerRow) => money(r[`A_${key}` as keyof LedgerRow] as number, AGE_INK[key]),
  csv: (r: LedgerRow) => r[`A_${key}` as keyof LedgerRow] as number,
}));

function collectionTitle(r: LedgerRow) {
  return [`Total due ${fmt(r.TotalDue)}`, `${RIBBON.settled.label} ${fmt(r.Settled)}`, `${RIBBON.held.label} ${fmt(r.Held)}`, `${RIBBON.finance.label} ${fmt(r.WithFinance)}`, `${RIBBON.recorded.label} ${fmt(r.Recorded)}`, `Not yet due ${fmt(notDue(r))}`, `Overdue ${fmt(r.OverdueAmount)}`].join(" \u00b7 ");
}

export const LEDGER_COLS: GridCol<LedgerRow>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (r) => r.ApplicantName, cell: (r) => (
    <span className="flex items-center gap-3 py-1.5 min-w-0">
      <Initials name={r.ApplicantName} />
      <span className="min-w-0">
        <Link to={`/crm/payments?bookingId=${r.BookingId}`} onClick={(event) => event.stopPropagation()} aria-label={`Open payment milestones for ${r.ApplicantName}, booking ${r.BookingNo}`} className="block font-semibold text-primary capitalize truncate hover:underline focus-visible:underline" title={r.ApplicantName}>{asName(r.ApplicantName)}</Link>
        <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo} · {r.UnitNo}{r.ProjectName ? ` · ${r.ProjectName}` : ""}{r.Closed ? <span className="text-destructive"> · {r.BookingStatus}</span> : null}</span>
      </span>
    </span>
  ) },
  { id: "tracker", label: "Received", sortKey: "Collected", csv: (r) => Number(r.Collected) + Number(r.WithFinance) + Number(r.Recorded), cell: (r) => {
    const received = Number(r.Collected) + Number(r.WithFinance) + Number(r.Recorded);
    // A closed booking owes nothing, so there is no plan to measure against: only what actually came in.
    if (r.Closed) return (
      <span className="block min-w-[15rem] py-1.5 text-xs tabular-nums text-muted-foreground">
        {received > 0 ? <><span className="font-medium text-foreground">{fmtShort(received)}</span> received</> : "Nothing received"}
        <span className="block mt-0.5">Closed, no balance owed</span>
      </span>
    );
    return (
      <span className="block min-w-[15rem] py-1.5" title={collectionTitle(r)}>
        <CollectionBar due={Number(r.TotalDue)} collected={Number(r.Collected)} finance={Number(r.WithFinance)} recorded={Number(r.Recorded)} overdue={Number(r.OverdueAmount)} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground"><span className="font-medium text-foreground">{fmtShort(received)}</span> of {fmtShort(r.TotalDue)}</span>
          <span className="font-medium">{pct(received, r.TotalDue)}%</span>
        </span>
      </span>
    );
  } },
  { id: "verified", label: "Approved by Finance", align: "right", sortKey: "Collected", csv: (r) => r.Collected, cell: (r) => (Number(r.Collected) > 0 ? (
    <span className="inline-flex flex-col items-end leading-tight" title={`Adjusted ${fmt(r.Settled)} · On account ${fmt(r.Held)}`}>
      <span className="tabular-nums font-medium">{fmtShort(r.Collected)}</span>
      {Number(r.Held) > 0 && <span className="mt-0.5 text-[0.6875rem] text-teal-400 [[data-theme]_&]:text-teal-700 whitespace-nowrap tabular-nums">{fmtShort(r.Held)} on account</span>}
    </span>
  ) : dash) },
  { id: "pending", label: "Not yet approved", align: "right", csv: (r) => Number(r.WithFinance) + Number(r.Recorded), cell: (r) => {
    const n = Number(r.WithFinance) + Number(r.Recorded);
    if (!(n > 0)) return dash;
    // Named as on the summary header, so the same money reads the same everywhere.
    const parts = [{ amount: Number(r.WithFinance), label: RIBBON.finance.label }, { amount: Number(r.Recorded), label: RIBBON.recorded.label }].filter((x) => x.amount > 0);
    return (
      <span className="inline-flex flex-col items-end leading-tight" title={parts.map((x) => `${x.label} ${fmt(x.amount)}`).join(" · ")}>
        <span className={cn("tabular-nums font-medium", TONE_AMBER_TEXT)}>{fmtShort(n)}</span>
        {parts.map((x) => <span key={x.label} className="mt-0.5 text-xs text-muted-foreground whitespace-nowrap">{parts.length > 1 ? `${fmtShort(x.amount)} ` : ""}{x.label}</span>)}
      </span>
    );
  } },
  { id: "toCollect", label: "Balance", align: "right", sortKey: "ToCollect", csv: (r) => r.ToCollect, cell: (r) => (!r.Closed && Number(r.ToCollect) > 0 ? <span className="tabular-nums font-medium" title={fmt(r.ToCollect)}>{fmtShort(r.ToCollect)}</span> : dash) },
  { id: "overdue", label: "Overdue", align: "right", sortKey: "OverdueAmount", csv: (r) => r.OverdueAmount, cell: (r) => (!r.Closed && r.OverdueAmount > 0 ? (
    <span className="inline-flex flex-col items-end leading-tight" title={fmt(r.OverdueAmount)}>
      <span className={cn("tabular-nums font-semibold", TONE_ROSE_TEXT)}>{fmtShort(r.OverdueAmount)}</span>
      <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{r.DaysLate} day{r.DaysLate === 1 ? "" : "s"} late</span>
    </span>
  ) : dash) },
  { id: "owner", label: "Owner", sortKey: "AssignedToName", csv: (r) => r.AssignedToName, cell: (r) => (r.AssignedToName
    ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Initials name={r.AssignedToName} small /><span className="truncate">{r.AssignedToName}</span></span> : dash) },
  // Under Columns, for whoever needs them; the export writes them all.
  { id: "next", label: "Next milestone", hiddenByDefault: true, cell: nextStep },
  { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", cell: (r) => <span className="tabular-nums">{r.BookingNo}</span>, csv: (r) => r.BookingNo },
  { id: "unit", label: "Unit", hiddenByDefault: true, cell: (r) => r.UnitNo, csv: (r) => r.UnitNo },
  { id: "project", label: "Project", hiddenByDefault: true, cell: (r) => r.ProjectName || "—", csv: (r) => r.ProjectName },
  { id: "due", label: "Total due", align: "right", hiddenByDefault: true, sortKey: "TotalDue", cell: (r) => <span className="tabular-nums">{fmt(r.TotalDue)}</span>, csv: (r) => r.TotalDue },
  { id: "finance", label: "Pending with Finance", align: "right", hiddenByDefault: true, cell: (r) => money(r.WithFinance), csv: (r) => r.WithFinance },
  { id: "held", label: "On account", align: "right", hiddenByDefault: true, cell: (r) => money(r.Held), csv: (r) => r.Held },
  { id: "notDue", label: "Not yet due", align: "right", hiddenByDefault: true, sortKey: "NotDue", cell: (r) => money(notDue(r)), csv: notDue },
  ...AGE_COLS,
  { id: "days", label: "Oldest (days)", align: "right", hiddenByDefault: true, sortKey: "DaysLate", cell: (r) => (r.DaysLate > 0 ? <span className="tabular-nums">{r.DaysLate}</span> : dash), csv: (r) => r.DaysLate },
  { id: "mobile", label: "Mobile", hiddenByDefault: true, cell: (r) => <span className="tabular-nums">{r.Mobile || "—"}</span>, csv: (r) => r.Mobile },
];

// ── The plan ─────────────────────────────────────────────────────────────────
/** The token's state, as on the booking's own Payments tab: bounced, with Finance, not yet sent, or not yet receipted.
 *  Approved shows nowhere here: it's already in Collected. */
/** Booking queue card for phones: collection stages and balances without horizontal scrolling. */
export function LedgerMobileCard({ row, onOpen }: { row: LedgerRow; onOpen: () => void }) {
  const received = Number(row.Collected) + Number(row.WithFinance) + Number(row.Recorded);
  const withFinance = Number(row.WithFinance);
  const recorded = Number(row.Recorded);
  const accessibleSummary = row.Closed
    ? `${received > 0 ? `${fmt(received)} received` : "Nothing received"}; closed, no balance owed`
    : `${fmt(received)} received of ${fmt(row.TotalDue)} due; ${fmt(row.ToCollect)} to collect; ${row.OverdueAmount > 0 ? `${fmt(row.OverdueAmount)} overdue by ${row.DaysLate} days` : "nothing overdue"}; ${withFinance > 0 ? `${fmt(withFinance)} pending with Finance` : "nothing pending with Finance"}${recorded > 0 ? `; ${fmt(recorded)} awaiting booking approval` : ""}`;
  return (
    <article role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}
      aria-label={`Open payment milestones for ${row.ApplicantName}, booking ${row.BookingNo || "number unavailable"}. ${accessibleSummary}`}
      className={cn(GRID_CARD, "block w-full rounded-lg p-3.5 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold capitalize text-foreground" title={row.ApplicantName}>{asName(row.ApplicantName)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{row.BookingNo}{row.UnitNo ? ` · ${row.UnitNo}` : ""}{row.ProjectName ? ` · ${row.ProjectName}` : ""}</p>
        </div>
        <GridStatusPill status={row.BookingStatus} />
      </div>
      {row.Closed ? (
        <div className="mt-3 border-t border-border/70 pt-2 text-xs text-muted-foreground tabular-nums">
          {received > 0 ? <><strong className="text-foreground">{fmtShort(received)}</strong> received</> : "Nothing received"} · Closed, no balance owed
        </div>
      ) : (
        <>
          <div className="mt-3"><CollectionBar due={Number(row.TotalDue)} collected={Number(row.Collected)} finance={Number(row.WithFinance)} recorded={Number(row.Recorded)} overdue={Number(row.OverdueAmount)} /></div>
          <div className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
            <span className="text-muted-foreground"><strong className="text-foreground">{fmtShort(received)}</strong> of {fmtShort(row.TotalDue)}</span>
            <span className="font-medium">{pct(received, row.TotalDue)}%</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/70 pt-2.5 text-xs">
            <div><span className="block text-muted-foreground">Balance to collect</span><span className="mt-0.5 block font-semibold tabular-nums">{fmtShort(row.ToCollect)}</span></div>
            <div className="text-right"><span className="block text-muted-foreground">Overdue</span><span className={cn("mt-0.5 block font-semibold tabular-nums", row.OverdueAmount > 0 && TONE_ROSE_TEXT)}>{row.OverdueAmount > 0 ? `${fmtShort(row.OverdueAmount)} · ${row.DaysLate}d` : "—"}</span></div>
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
            <span>{withFinance > 0 ? `${fmtShort(withFinance)} pending with Finance` : "None pending with Finance"}</span>
            {recorded > 0 && <span>{fmtShort(recorded)} awaiting booking approval</span>}
            {row.AssignedToName && <span className="truncate">Owner: {row.AssignedToName}</span>}
          </div>
          {row.PlanCount > 0 && <p className="mt-2 border-t border-border/70 pt-2 text-xs">Next: {nextStep(row)}</p>}
        </>
      )}
    </article>
  );
}

export function TokenNote({ booking, bookingId, moneyReceipts }: { booking: any; bookingId?: string | number; moneyReceipts: any[] }) {
  if (!(Number(booking?.TokenValue) > 0)) return null;
  const receipt = moneyReceipts[0];
  const tokenAmt = Number(booking.TokenValue);
  const pmode = booking.PaymentMode || "—";
  const bookingLink = bookingId ? <Link to={`/crm/bookings?view=${bookingId}`} className="text-primary font-semibold underline underline-offset-2 ml-1.5">Check booking approval</Link> : null;
  let note: { red?: boolean; icon: React.ReactNode; title: string; text: React.ReactNode } | null = null;
  if (receipt?.Status === "Bounced") {
    note = { red: true, icon: <AlertTriangle size={13} />, title: `Token payment bounced: ${fmt(tokenAmt)}`, text: <>{receipt.BouncedReason ? `Reason: ${receipt.BouncedReason}. ` : ""}A new Money Receipt must be submitted.</> };
  } else if (receipt?.Status === CrmStatus.PENDING && receipt?.RPStatus === CrmStatus.PENDING) {
    note = { icon: <Hourglass size={13} />, title: `${fmt(receipt.Amount || tokenAmt)} pending with Finance`, text: <>Receipt {receipt.ReceiptNo} · {pmode} · sent to Finance. Counts as received once approved.</> };
  } else if (receipt?.Status === CrmStatus.PENDING && !receipt?.RPStatus) {
    note = { icon: <Clock size={13} />, title: `Token ${fmt(receipt.Amount || tokenAmt)} held pre-Finance (awaiting booking approval)`, text: <>Money Receipt {receipt.ReceiptNo} ({pmode}) is ready and hands off to Finance automatically when Booking Approval completes.{bookingLink}</> };
  } else if (!receipt) {
    note = { icon: <Clock size={13} />, title: `Booking token ${fmt(tokenAmt)} recorded via ${pmode} — awaiting booking approval`, text: <>Allocated across schedule milestones so payments stay transparent. A Money Receipt is sent to Finance automatically once this booking passes approval (no send action needed here).{bookingLink}</> };
  }
  if (!note) return null;
  return (
    <div className={cn("flex items-start gap-2.5 px-4 py-3 text-xs rounded-xl border", note.red ? "border-rose-500/35 bg-rose-500/10" : "border-border bg-card")}>
      <span className={cn("shrink-0 mt-0.5", note.red ? TONE_ROSE_TEXT : "text-primary")}>{note.icon}</span>
      <p><span className={cn("font-semibold", note.red && TONE_ROSE_TEXT)}>{note.title}.</span> <span className="text-muted-foreground">{note.text}</span></p>
    </div>
  );
}

/** Payment entries on a booking: those with Finance, or those Finance returned. */
export function EntryTable({ rows, returned }: { rows: any[]; returned?: boolean }) {
  return (
    <>
      <GridMiniTable rows={rows} rowKey={(e: any) => e.id} empty="None" cols={[
        { header: "Entry", cell: (e: any) => <span className="tabular-nums font-medium">{e.docNo || `#${e.id}`}</span> },
        { header: "For", cell: (e: any) => e.milestone || "On Account" },
        { header: "Received", cell: (e: any) => <span className="tabular-nums">{fmtDate(e.date)}</span> },
        { header: "Mode · ref", cell: (e: any) => <>{e.mode || "—"}{e.ref ? <span className="text-muted-foreground tabular-nums"> · {e.ref}</span> : null}</> },
        { header: returned ? "Rejected by · reason" : "Entered by", cell: (e: any) => <span className="text-muted-foreground">{returned
          ? `${e.returnedBy || "—"}${e.returnedAt ? ` · ${fmtDate(e.returnedAt)}` : ""}${e.reason ? `: ${e.reason}` : ""}`
          : `${e.enteredBy || "—"}${e.enteredAt ? ` · ${fmtDate(e.enteredAt)}` : ""}`}</span> },
        { header: "Amount", align: "right", cell: (e: any) => <span className={cn("tabular-nums font-semibold", returned && "line-through text-muted-foreground")}>{fmt(e.amount)}</span> },
      ]} />
      <p className="px-4 py-2 text-[0.6875rem] text-muted-foreground">
        {returned ? "Enter the payment again once it is corrected. The rejected entry stays here for the record."
          : "More payments can be entered while these are pending. Each counts as received once Finance approves it."}
      </p>
    </>
  );
}

export function PriceTable({ booking }: { booking: any }) {
  const lines = [
    { l: booking.IsPlotSale ? "Land value (no GST)" : "Unit value", v: booking.TotalValue },
    { l: "+ Unit GST", v: booking.UnitGstAmount, optional: true },
    { l: "+ Parking", v: booking.ParkingTotal, optional: true },
    { l: "+ Extra charges", v: booking.ExtraChargesTotal, optional: true },
    { l: "Grand total", v: booking.GrandTotal ?? booking.TotalValue, strong: true },
    { l: "Booking amount (milestone 1)", v: booking.BookingAmount, optional: true },
  ].filter((x) => !x.optional || Number(x.v) > 0);
  return (
    <dl className="w-full px-4 py-3 text-[0.8125rem]">
      {lines.map((x) => (
        <div key={x.l} className={cn("flex items-baseline justify-between gap-4 py-1.5", x.strong && "border-t border-border/70 mt-1.5 pt-2.5")}>
          <dt className={x.strong ? "font-semibold" : "text-muted-foreground"}>{x.l}</dt>
          <dd className={cn("tabular-nums", x.strong ? "font-bold text-foreground" : "font-medium")}>{fmt(Number(x.v) || 0)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every rupee of the booking, one line per payment: what came in, under which documents, and where it is now. */
export function MoneyTrail({ trail, totalDue }: { trail: any; totalDue: number }) {
  const rows: any[] = trail?.rows || [];
  const t = trail?.totals || {};
  const th = "h-8 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap bg-muted border-b border-border text-left";
  const td = "h-10 px-3 border-b border-border/70 align-middle tabular-nums";
  const amt = (n: number) => (Number(n) > 0 ? fmt(n) : dash);
  const differs = trail && trail.receiptAmount != null && trail.applicationToken > 0 && Math.abs(trail.receiptAmount - trail.applicationToken) > 0.009;
  if (!rows.length) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">No receipts on this booking yet.</div>;
  return (
    <>
      {differs && (
        <div className="px-4 py-2.5 border-b border-border text-xs flex items-center gap-2 bg-amber-500/10">
          <AlertTriangle size={13} className={cn("shrink-0", TONE_AMBER_TEXT)} />
          <span>Application amount <b className="tabular-nums">{fmt(trail.applicationToken)}</b>; Money Receipt amount <b className="tabular-nums">{fmt(trail.receiptAmount)}</b>. The Money Receipt amount is taken as received.</span>
        </div>
      )}
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-[0.8125rem] min-w-[1080px]">
          <thead>
            <tr>
              <th className={th}>Date</th><th className={th}>Documents</th><th className={th}>Mode · Ref. no.</th>
              <th className={cn(th, "text-right")}>Gross amount</th><th className={cn(th, "text-right")}>Adjusted</th><th className={cn(th, "text-right")}>On account</th><th className={cn(th, "text-right")}>Refunded (paid)</th><th className={cn(th, "text-right")}>Reserved / moved</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = TRAIL_STAGE[r.stage];
              const refunded = Number(r.refunded) || 0;
              const otherOut = Number(r.otherOut) || 0;
              const statusText = r.stage === "out"
                ? refunded > 0 && otherOut < 0.01 ? "Refunded (paid)" : refunded > 0 ? "Part refunded" : "Reserved / moved"
                : r.stage === "split" && refunded > 0 ? "Part adjusted · refund paid" : st?.label || r.stage;
              const dead = r.stage === "returned" || r.stage === "bounced" || r.stage === "adjustment";
              return (
                <tr key={r.id} className={cn("hover:bg-muted/40", dead && "text-muted-foreground")}>
                  <td className={cn(td, "whitespace-nowrap")}>{r.date ? fmtDate(r.date) : dash}</td>
                  <td className={td}>{r.docs?.length ? r.docs.join(" → ") : r.note}{r.milestone ? <span className="ml-2 text-xs text-muted-foreground">{r.milestone}</span> : null}</td>
                  <td className={td}>{r.mode || "—"}{r.ref ? <span className="text-muted-foreground"> · {r.ref}</span> : null}</td>
                  <td className={cn(td, "text-right font-semibold", dead && "font-normal", dead && r.stage !== "adjustment" && "line-through")}>{fmt(r.amount)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.settled)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.held)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.refunded)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.otherOut)}</td>
                  <td className={td} title={[st?.hint, r.reservedRefund > 0 ? `${fmt(r.reservedRefund)} reserved for a pending refund` : null, r.docs?.length ? r.note : null].filter(Boolean).join(" · ")}><GridToneMark text={statusText} tone={st?.tone ?? "waiting"} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted font-semibold tabular-nums">
              <td className="h-9 px-3 border-t border-border" colSpan={3}>Gross receipts counted (excludes rejected/bounced; before refunds or transfers)</td>
              <td className="h-9 px-3 border-t border-border text-right">{fmt(t.received)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.settled)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.held)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.refunded)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.otherOut)}</td>
              <td className="h-9 px-3 border-t border-border text-xs font-medium text-muted-foreground whitespace-nowrap">
                {[Number(t.finance) > 0 ? `${fmt(t.finance)} pending with Finance` : null, Number(t.recorded) > 0 ? `${fmt(t.recorded)} awaiting booking approval` : null].filter(Boolean).join(" · ")}
              </td>
            </tr>
            <tr className="bg-muted/60">
              <td className="px-3 py-2 border-t border-border text-xs text-muted-foreground" colSpan={9}>
                <span className="font-semibold text-foreground">Currently credited to this booking: {fmt((Number(t.settled) || 0) + (Number(t.held) || 0))}</span>
                {` = ${fmt(t.settled)} adjusted + ${fmt(t.held)} still on account. `}
                {`${fmt(t.refunded)} has actually been refunded. ${fmt(t.otherOut)} is reserved or moved out. `}
                {`Current billable amount: ${fmt(totalDue)}.`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** What a waiver did to the price, and any verified money beyond what is still billable. Both pages' band footers. */
export function WaiverNotes({ agreed, waived, net, excess, bookingId }: { agreed: number; waived: number; net: number; excess: number; bookingId: number | string }) {
  if (!(waived > 0) && !(excess > 0)) return null;
  return (
    <span className="block mt-1 text-slate-300 space-y-0.5">
      {waived > 0 && <span className="block">Agreed price {fmt(agreed)}, less {fmt(waived)} waived: {fmt(net)} to be billed.</span>}
      {excess > 0 && <span className="block text-amber-200">{fmt(excess)} on account is more than is still billable. <Link to={`/crm/refunds?newForBooking=${bookingId}`} className="underline underline-offset-2 hover:text-white">Refund or adjust it</Link>.</span>}
    </span>
  );
}

/** Every waiver on a booking: who asked, who decided, why, and reversing one. On both the plan and the invoices page. */
export function WaiverSection({ waivers, canEdit, onChanged }: { waivers: any[]; canEdit: boolean; onChanged: () => void }) {
  const [reversing, setReversing] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!waivers?.length) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await reverseWaiver(reversing.Id, reason.trim());
      toast.success("Reversal sent for approval");
      setReversing(null); setReason("");
      onChanged();
    } catch (e: any) { toast.error(translateError(e.message)); } finally { setBusy(false); }
  };
  return (
    <GridRelated icon={Percent} title="Waivers" count={waivers.length}>
      <GridMiniTable rows={waivers} rowKey={(w: any) => w.Id} empty="No waivers." cols={[
        { header: "Milestone", cell: (w: any) => <span className="font-medium"><span className="text-muted-foreground tabular-nums mr-1.5">{w.MilestoneNo}</span>{w.MilestoneName}</span> },
        { header: "Taxable value", align: "right", cell: (w: any) => <span className="tabular-nums">{fmt(w.TaxableValue)}</span> },
        { header: "GST", align: "right", cell: (w: any) => <span className="tabular-nums">{fmt(w.GstAmount)}</span> },
        { header: "Amount", align: "right", cell: (w: any) => <span className="tabular-nums font-semibold">{fmt(w.Amount)}</span> },
        { header: "Reason", cell: (w: any) => <span className="block max-w-[20rem] whitespace-normal text-xs" title={w.Reason}>{w.Reason}{w.RejectionNote ? <span className={cn("block", TONE_ROSE_TEXT)}>Rejected: {w.RejectionNote}</span> : null}{w.ReversalReason ? <span className="block text-muted-foreground">Reversal: {w.ReversalReason}{w.ReversalRejectionNote ? ` (rejected: ${w.ReversalRejectionNote})` : ""}</span> : null}</span> },
        { header: "Asked by", cell: (w: any) => <span className="text-xs text-muted-foreground">{w.RequestedByName || "—"} · {fmtDate(w.RequestedAt)}</span> },
        { header: "Decided by", cell: (w: any) => <span className="text-xs text-muted-foreground">{w.DecidedAt ? `${w.DecidedByName || "—"} · ${fmtDate(w.DecidedAt)}` : "—"}</span> },
        { header: "Status", cell: (w: any) => { const st = waiverState(w); return <GridToneMark text={st.label} tone={st.tone} />; } },
        { header: "Actions", cell: (w: any) => (!canEdit || !waiverState(w).reversible ? null
          : w.ReversalBlock ? <span className="block max-w-[14rem] whitespace-normal text-xs text-muted-foreground">{w.ReversalBlock}</span>
          : <button type="button" onClick={() => { setReversing(w); setReason(""); }} aria-label={`Reverse waiver for ${w.MilestoneName || "milestone"}`} className={cn(KEY_LINE, SMALL_KEY)}><Undo2 size={12} /> Reverse</button>) },
      ]} />
      {reversing && (
        <GridDialog
          open
          onClose={() => { if (!busy) setReversing(null); }}
          icon={Undo2}
          title="Reverse this waiver?"
          description={`${reversing.MilestoneName}: ${fmt(reversing.Amount)} becomes due again once the reversal is approved.`}
          width="max-w-lg"
          footer={
            <>
              <button type="button" onClick={() => setReversing(null)} disabled={busy} className={cn(KEY_LINE, "h-9 px-4")}>Cancel</button>
              <button type="button" onClick={submit} disabled={busy || reason.trim().length < 10} title={reason.trim().length < 10 ? "Say why: at least 10 characters" : undefined} className={cn(KEY_INK, "h-9 px-4")}>{busy ? "Sending…" : "Send for approval"}</button>
            </>
          }
        >
          <div>
            <label className={cn("block mb-1.5", LBL)} htmlFor="waiver-reversal-reason">Reason *</label>
            <textarea id="waiver-reversal-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus placeholder="Say why this waiver is being reversed (at least 10 characters)…" className={TEXTAREA} />
          </div>
        </GridDialog>
      )}
    </GridRelated>
  );
}

// Deposits that aren't usable money: never counted, never applied.
const UNAVAILABLE = ["Bounced", "Held", "Void", "Cancelled", "Refunded"];

export function OnAccountPanel({ onAccountData, loading, error, onRetry, notFullyPaid, fundsOnHand, requiredAmount, fullPaymentShortfall, inVerification = 0, milestones, canManuallyApply, canEdit, onApply }: {
  loading: boolean; error: string | null; onRetry: () => void;
  onAccountData: any; notFullyPaid: boolean; fundsOnHand: number; requiredAmount: number; inVerification?: number;
  fullPaymentShortfall: number; milestones: any[]; canManuallyApply: boolean; canEdit: boolean; onApply: (payment: any) => void;
}) {
  if (loading || error) return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-4 text-sm">
      {loading ? <span role="status" className="text-muted-foreground">Loading deposit balances…</span> : <span role="alert" className={TONE_ROSE_TEXT}>Could not load deposit balances: {error}</span>}
      {!loading && <button type="button" onClick={onRetry} className="font-semibold text-primary underline underline-offset-2">Retry</button>}
    </div>
  );
  const hasOutstanding = milestones.some((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && Number(m.AmountDue) > Number(m.AmountPaid || 0));
  const usableLeft = (onAccountData?.payments || []).some((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) > Number(p.AppliedAmount || 0));
  const availBal = Number(onAccountData?.availableBalance || 0);
  const clearedPct = requiredAmount > 0 ? Math.min(100, Math.round((fundsOnHand / requiredAmount) * 100)) : 0;
  const pendingPct = requiredAmount > 0 ? Math.min(100 - clearedPct, Math.round((inVerification / requiredAmount) * 100)) : 0;
  return (
    <>
      <div className="px-4 py-3 border-b border-border/70 bg-muted/15 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">Available unapplied:</span>{" "}
              <strong className="font-bold tabular-nums text-foreground">{fmt(availBal)}</strong>
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums text-muted-foreground">
              Total cleared towards booking:{" "}
              <strong className={cn("font-semibold", notFullyPaid ? TONE_AMBER_TEXT : TONE_EMERALD_TEXT)}>{fmt(fundsOnHand)}</strong>{" "}
              of {fmt(requiredAmount)} ({clearedPct}%)
            </span>
          </div>
          {notFullyPaid ? (
            <span className={cn("font-semibold tabular-nums", TONE_AMBER_TEXT)}>
              {fmt(fullPaymentShortfall)} shortfall to auto-adjust
              {inVerification > 0 ? ` (${fmt(Math.min(inVerification, fullPaymentShortfall))} pending Finance)` : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400 [[data-theme]_&]:text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0" />
              <span>
                100% funded — adjusts on{" "}
                <Link to="/crm/demands" className="text-primary underline underline-offset-2">demanded</Link> milestones
              </span>
            </span>
          )}
        </div>
        {requiredAmount > 0 && (
          <div className="h-1.5 w-full rounded-full bg-muted [[data-theme]_&]:bg-slate-200 overflow-hidden flex" title={`Cleared ${fmt(fundsOnHand)} · Pending with Finance ${fmt(inVerification)} · Required ${fmt(requiredAmount)}`}>
            {clearedPct > 0 && <span className="h-full bg-emerald-500 [[data-theme]_&]:bg-emerald-600" style={{ width: `${clearedPct}%` }} />}
            {pendingPct > 0 && <span className="h-full bg-amber-400" style={{ width: `${pendingPct}%` }} />}
          </div>
        )}
        {milestones.length > 0 && !hasOutstanding && usableLeft && (
          <p className="text-[0.6875rem] text-muted-foreground">No milestone balance is outstanding; the unapplied remainder stays on account.</p>
        )}
      </div>
      <GridMiniTable rows={onAccountData?.payments || []} rowKey={(p: any) => p.Id} empty="No on-account deposits" cols={[
        { header: "Receipt", cell: (p: any) => <span className="tabular-nums font-medium">{p.ReceiptNo}</span> },
        { header: "Received", cell: (p: any) => <span className="tabular-nums">{fmtDate(p.ReceivedDate)}</span> },
        { header: "Mode", cell: (p: any) => p.PaymentMode || "—" },
        { header: "Deposited", align: "right", cell: (p: any) => <span className="tabular-nums">{fmt(p.Amount)}</span> },
        { header: "Remaining", align: "right", cell: (p: any) => {
          if (UNAVAILABLE.includes(p.Status)) return dash;
          return <span className="tabular-nums font-semibold">{fmt(Number(p.Amount) - Number(p.AppliedAmount || 0))}</span>;
        } },
        { header: "Status", cell: (p: any) => {
          const out = UNAVAILABLE.includes(p.Status);
          return <GridToneMark text={out ? p.Status : p.Status === "Applied" ? "Applied" : p.Status === "PartiallyApplied" ? "Partial" : "Unapplied"} tone={out ? "stopped" : p.Status === "Applied" ? "done" : "waiting"} />;
        } },
        { header: "", cell: (p: any) => {
          const remaining = UNAVAILABLE.includes(p.Status) ? 0 : Number(p.Amount) - Number(p.AppliedAmount || 0);
          const canApply = canEdit && remaining > 0 && p.Status !== "Applied" && canManuallyApply && hasOutstanding;
          return canApply ? <button type="button" onClick={() => onApply(p)} aria-label={`Apply deposit ${p.ReceiptNo || "on account"} manually`} title="This deposit should apply itself once its milestone is eligible: use this only as a manual fallback" className={cn(KEY_LINE, SMALL_KEY)}>Apply manually</button> : null;
        } },
      ]} />
    </>
  );
}

/** The money against a milestone, in words on one line. */
export function moneyWords(m: any) {
  const f = milestoneFill(m);
  if (f.waived) return <span className="text-muted-foreground">Waived</span>;
  const bits = [
    f.settled > 0 ? <span key="s" className={TONE_EMERALD_TEXT}>{fmt(f.settled)} adjusted</span> : null,
    f.held > 0 ? <span key="h" className="text-teal-300 [[data-theme]_&]:text-teal-700" title={MONEY_STAGE.Verified.hint}>{fmt(f.held)} on account</span> : null,
    f.finance > 0 ? <span key="f" className={TONE_AMBER_TEXT} title={MONEY_STAGE.InVerification.hint}>{fmt(f.finance)} pending with Finance</span> : null,
    f.recorded > 0 ? <span key="r" className={TONE_SKY_TEXT} title={MONEY_STAGE.Recorded.hint}>{fmt(f.recorded)} token (booking approval)</span> : null,
  ].filter(Boolean);
  if (!bits.length) return dash;
  return <span className="tabular-nums inline-flex flex-wrap gap-x-2">{bits}</span>;
}

/** What is recorded on a milestone besides its money: all of it shown under its name. */
function milestoneDetails(m: any) {
  const lines: [string, React.ReactNode][] = [];
  if (m.DemandStatus === "Demanded" || m.DemandStatus === CrmStatus.PAID) lines.push(["Demand", `${m.DemandStatus === "Demanded" ? `Raised${m.DemandNo ? ` · ${m.DemandNo}` : ""}` : m.DemandStatus}${m.DemandRaisedOn ? ` · ${fmtDate(m.DemandRaisedOn)}` : ""}`]);
  if (m.Percent != null) lines.push(["Share of value", `${Number(m.Percent)}%`]);
  if (m.PaidDate) lines.push(["Paid on", fmtDate(m.PaidDate)]);
  if (m.PaymentMode) lines.push(["Mode", m.PaymentMode]);
  if (m.DepositBankName) lines.push(["Deposit bank", m.DepositBankName]);
  if (m.TransactionRef) lines.push(["Reference", m.TransactionRef]);
  if (m.ResponsibleDepartment) lines.push(["Department", m.ResponsibleDepartment]);
  if (m.RequiredDocuments) lines.push(["Documents", m.RequiredDocuments]);
  if (Number(m.PendingVerificationAmount) > 0) lines.push(["Entry pending with Finance", fmt(m.PendingVerificationAmount)]);
  return lines;
}

export function MilestoneTable({ milestones, canEdit, closed = false, onAccountData, onAccountBalance, notFullyPaid, fullPaymentShortfall, nextMilestone, canManuallyApply, activeId, pendingWaivers, onPay, onApply, onWaive, onRemarks, onRaiseDemand, onUndoDemand, onInspectWallet }: {
  milestones: any[]; canEdit: boolean;
  /** The booking is closed (cancelled, unit changed …): its schedule is history, nothing on it is due or overdue. */
  closed?: boolean; onAccountData: any; onAccountBalance: number; notFullyPaid: boolean; fullPaymentShortfall: number;
  nextMilestone: any; canManuallyApply: boolean; activeId: number | null; pendingWaivers?: Set<number>;
  onPay: (m: any) => void; onApply: (payment: any, m: any) => void; onWaive: (m: any) => void; onRemarks: (m: any) => void;
  onRaiseDemand?: (m: any) => void; onUndoDemand?: (m: any) => void; onInspectWallet?: () => void;
}) {
  const th = "h-8 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap bg-muted border-b border-border text-left";
  const td = "h-10 px-3 border-b border-border/70 align-middle";
  const passive = cn("inline-flex items-center h-7 px-2.5 rounded-md border border-amber-500/35 bg-amber-500/10 text-[0.6875rem] font-medium transition hover:bg-amber-500/20", TONE_AMBER_TEXT);
  // One main action on the page: paying the milestone money is missing on next.
  const nextOpenId = nextOpenMilestone(milestones)?.Id;
  const totalScheduled = milestones.reduce((n, m) => n + (m.Status === "Waived" ? 0 : Number(m.AmountDue) || 0), 0);
  const totalCleared = milestones.reduce((n, m) => { const f = milestoneFill(m); return n + (f.waived ? 0 : f.settled + f.held); }, 0);
  const totalPipeline = milestones.reduce((n, m) => { const f = milestoneFill(m); return n + (f.waived ? 0 : f.finance + f.recorded); }, 0);
  const totalRemaining = milestones.reduce((n, m) => n + (milestoneFill(m).waived ? 0 : milestoneFill(m).missing), 0);
  const renderActions = (m: any, covered: boolean, missing: number, pmt: any) => {
    const noBalanceLeft = covered || missing <= 0;
    const menuItems = [
      { label: "Record additional payment", icon: Wallet, onClick: () => onPay(m), hidden: !noBalanceLeft || covered },
      { label: "Raise payment demand", icon: Send, onClick: () => onRaiseDemand!(m), hidden: covered || m.DemandStatus !== CrmStatus.PENDING || !onRaiseDemand },
      { label: "Undo demand", icon: Undo2, onClick: () => onUndoDemand!(m), hidden: covered || m.DemandStatus !== CrmStatus.DEMANDED || Number(m.AmountPaid || 0) > 0 || !onUndoDemand },
      { label: "Request waiver", icon: Percent, onClick: () => onWaive(m), hidden: noBalanceLeft || !!pendingWaivers?.has(m.Id) },
      { label: "View remarks", icon: MessageSquare, onClick: () => onRemarks(m), hidden: !m.Remarks },
    ];
    return (
      <>
        {!noBalanceLeft && (
          <button type="button" onClick={() => onPay(m)} aria-label={`Record payment for ${m.MilestoneName}`} className={cn(m.Id === nextOpenId ? KEY_INK : KEY_LINE, SMALL_KEY)}>Pay</button>
        )}
        {pmt && (notFullyPaid ? (
          onInspectWallet ? (
            <button type="button" onClick={onInspectWallet} title={`On-account deposits auto-adjust once full booking due is approved (${fmt(fullPaymentShortfall)} shortfall). Click to open On-Account Wallet.`} className={passive}>
              Held · Auto
            </button>
          ) : (
            <span title={`Adjusted automatically once the full booking amount is received: a further ${fmt(fullPaymentShortfall)} is needed`} className={passive}>Auto</span>
          )
        ) : !canManuallyApply ? (
          onRaiseDemand ? (
            <button type="button" onClick={() => onRaiseDemand(m)} title="Raise this milestone's Demand now so held On-Account funds can adjust automatically" className={cn(KEY_LINE, SMALL_KEY, "border-amber-500/40", TONE_AMBER_TEXT)}>
              Raise demand
            </button>
          ) : (
            <span title="Raise the Demand before applying on-account money to this milestone" className={passive}>Raise demand</span>
          )
        ) : (
          <button type="button" onClick={() => onApply(pmt, m)} aria-label={`Apply on-account money to ${m.MilestoneName}`} title="The full booking amount is received, so this should adjust automatically: use this only if it has not" className={cn(KEY_LINE, SMALL_KEY)}>Apply</button>
        ))}
        {covered && <span className="text-[0.6875rem] font-medium text-muted-foreground mr-1">Covered</span>}
        <CrmRowMenu items={menuItems} />
      </>
    );
  };
  return (
    <>
    <div className="divide-y divide-border md:hidden">
      {milestones.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">No milestones on this booking.</p> : milestones.map((m) => {
        const overdue = !closed && isOverdue(m);
        const lateDays = overdue ? daysLate(m) : 0;
        const f = milestoneFill(m);
        const stage = MONEY_STAGE[m.MoneyStage as string] || null;
        const covered = m.MoneyStage === "Verified";
        const scheduledLater = !overdue && !stage && m.Status === CrmStatus.PENDING && m.DemandStatus !== "Demanded" && daysLate(m) < 0;
        const status = closed && m.Status !== CrmStatus.PAID ? "Closed"
          : stage ? stage.label
          : overdue ? (f.held + f.finance + f.recorded > 0 ? "Overdue · part received" : "Overdue")
          : scheduledLater ? "Upcoming"
          : m.DemandStatus === "Demanded" ? "Demanded"
          : m.Status === CrmStatus.PENDING ? "Due" : m.Status;
        const tone = pendingWaivers?.has(m.Id) ? "waiting" : closed || scheduledLater ? "draft" : overdue ? "stopped" : stage?.tone ?? "waiting";
        const open = !closed && m.Status !== CrmStatus.PAID && m.Status !== "Waived";
        const pmt = onAccountBalance > 0 && m.Id === nextMilestone?.Id
          ? onAccountData?.payments?.find((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) - Number(p.AppliedAmount || 0) > 0)
          : null;
        const noAmount = Number(m.AmountDue) === 0 && Number(m.AmountPaid || 0) === 0 && m.Status === CrmStatus.PAID;
        const shown = activeId === m.Id;
        const details = milestoneDetails(m);
        return (
          <article key={m.Id} id={`milestone-${m.Id}`} className={cn("p-3 space-y-2.5", shown && "bg-primary/5 ring-1 ring-inset ring-primary/30")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="font-medium text-sm leading-snug"><span className="text-muted-foreground tabular-nums mr-1.5">{m.MilestoneNo}.</span>{m.MilestoneName}
                  {m.Remarks && <button type="button" onClick={() => onRemarks(m)} title={m.Remarks} aria-label={`Read remarks for ${m.MilestoneName}`} className="ml-1.5 align-middle text-muted-foreground hover:text-foreground inline-flex"><MessageSquare size={12} /></button>}
                </h4>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Due {fmtDate(m.DueDate)}
                  {lateDays > 0 && <span className={cn("ml-2 font-semibold tabular-nums", TONE_ROSE_TEXT)}>{lateDays}d overdue</span>}
                </p>
              </div>
              <span title={stage?.hint}>{m.Status === "Waived" ? <GridStatusPill status="Waived" /> : <GridToneMark text={pendingWaivers?.has(m.Id) ? "Waiver awaiting approval" : status} tone={tone} />}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><span className="block text-muted-foreground">Amount due</span><span className="font-semibold tabular-nums">{noAmount ? "No amount due" : fmt(m.AmountDue)}</span></div>
              <div className="text-right"><span className="block text-muted-foreground">Balance</span><span className={cn("font-semibold tabular-nums", !closed && !f.waived && f.missing > 0 && "text-foreground")}>{closed || f.waived || f.missing <= 0 ? "—" : fmt(f.missing)}</span></div>
              <div className="col-span-2"><span className="block text-muted-foreground mb-0.5">Received against it</span>{moneyWords(m)}</div>
            </div>
            {details.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">{details.map(([label, value]) => <span key={label}>{label}: <span className="text-foreground/80 tabular-nums">{value}</span></span>)}</div>}
            {canEdit && open && <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">{renderActions(m, covered, f.missing, pmt)}</div>}
          </article>
        );
      })}
      {milestones.length > 0 && <div className="flex justify-between gap-4 bg-muted px-3 py-2.5 text-xs font-semibold">
        <span>Total</span><span className="text-right tabular-nums">{fmt(totalScheduled)}<span className="ml-2 text-muted-foreground font-normal">{closed ? "—" : `${fmt(totalRemaining)} remaining`}</span></span>
      </div>}
    </div>
    <div className="hidden overflow-x-auto thin-scroll md:block">
      <table className="w-full text-[0.8125rem] min-w-[820px]">
        <thead>
          <tr>
            <th className={th}>Milestone</th><th className={th}>Due date</th>
            <th className={cn(th, "text-right")}>Amount</th><th className={th}>Received against it</th>
            <th className={cn(th, "text-right")}>Balance</th><th className={th}>Status</th><th className={th} aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {milestones.length === 0 ? (
            <tr><td colSpan={7} className={cn(td, "py-10 text-center text-muted-foreground")}>No milestones on this booking.</td></tr>
          ) : milestones.map((m) => {
            const overdue = !closed && isOverdue(m);
            const lateDays = overdue ? daysLate(m) : 0;
            const f = milestoneFill(m);
            // The server's money stage (MONEY_STAGE): verified money On Account covers it (no Pay / Waive, which
            // would read as owed / forgiven), or an entry for it is with Finance.
            const stage = MONEY_STAGE[m.MoneyStage as string] || null;
            const covered = m.MoneyStage === "Verified";
            const scheduledLater = !overdue && !stage && m.Status === CrmStatus.PENDING && m.DemandStatus !== "Demanded" && daysLate(m) < 0;
            const status = closed && m.Status !== CrmStatus.PAID ? "Closed"
              : stage ? stage.label
              : overdue ? (f.held + f.finance + f.recorded > 0 ? "Overdue · part received" : "Overdue")
              : scheduledLater ? "Upcoming"
              : m.DemandStatus === "Demanded" ? "Demanded"
              : m.Status === CrmStatus.PENDING ? "Due" : m.Status;
            const tone = pendingWaivers?.has(m.Id) ? "waiting" : closed || scheduledLater ? "draft" : overdue ? "stopped" : stage?.tone ?? "waiting";
            const open = !closed && m.Status !== CrmStatus.PAID && m.Status !== "Waived";
            const pmt = onAccountBalance > 0 && m.Id === nextMilestone?.Id
              ? onAccountData?.payments?.find((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) - Number(p.AppliedAmount || 0) > 0)
              : null;
            const noAmount = Number(m.AmountDue) === 0 && Number(m.AmountPaid || 0) === 0 && m.Status === CrmStatus.PAID;
            const shown = activeId === m.Id;
            const details = milestoneDetails(m);
            return (
              <React.Fragment key={m.Id}>
                <tr id={`milestone-desktop-${m.Id}`} className={cn("hover:bg-muted/40", shown && "bg-primary/5")}>
                  <td className={td}>
                    <div className="font-medium py-1">
                      <span className="text-muted-foreground tabular-nums mr-1.5">{m.MilestoneNo}</span>{m.MilestoneName}
                      {m.Remarks && <button type="button" onClick={() => onRemarks(m)} title={m.Remarks} aria-label="Read the payment remarks" className="ml-1.5 align-middle text-muted-foreground hover:text-foreground inline-flex"><MessageSquare size={11} /></button>}
                    </div>
                    {details.length > 0 && (
                      <div className="pb-1 text-[0.6875rem] leading-snug text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 max-w-[34rem]">
                        {details.map(([l, v]) => <span key={l}>{l}: <span className="text-foreground/80 tabular-nums">{v}</span></span>)}
                      </div>
                    )}
                  </td>
                  <td className={cn(td, "text-xs tabular-nums whitespace-nowrap")}>
                    <span className="text-muted-foreground">{fmtDate(m.DueDate)}</span>
                    {lateDays > 0 && <span className={cn("block text-[0.6875rem] font-semibold", TONE_ROSE_TEXT)}>{lateDays}d overdue</span>}
                  </td>
                  <td className={cn(td, "text-right tabular-nums whitespace-nowrap font-medium")}>{noAmount ? <span className="text-xs font-normal text-muted-foreground">No amount due</span> : fmt(m.AmountDue)}</td>
                  <td className={cn(td, "text-xs")}>{moneyWords(m)}</td>
                  <td className={cn(td, "text-right tabular-nums whitespace-nowrap", f.missing > 0 && "font-semibold")}>{closed || f.waived || f.missing <= 0 ? dash : fmt(f.missing)}</td>
                  <td className={td} title={stage?.hint}>{m.Status === "Waived" ? <GridStatusPill status="Waived" /> : <GridToneMark text={pendingWaivers?.has(m.Id) ? "Waiver awaiting approval" : status} tone={tone} />}</td>
                  <td className={cn(td, "whitespace-nowrap")}>
                    {canEdit && open && <div className="flex items-center justify-end gap-1.5">{renderActions(m, covered, f.missing, pmt)}</div>}
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
        {milestones.length > 0 && (
          <tfoot>
            <tr className="bg-muted font-semibold">
              <td className="h-9 px-3 border-t border-border" colSpan={2}>Total</td>
              <td className="h-9 px-3 border-t border-border text-right tabular-nums">{fmt(totalScheduled)}</td>
              <td className="h-9 px-3 border-t border-border text-xs font-medium tabular-nums">
                {totalCleared > 0 && <span className={TONE_EMERALD_TEXT}>{fmt(totalCleared)} cleared</span>}
                {totalPipeline > 0 && <span className={cn("ml-2", TONE_AMBER_TEXT)}>{fmt(totalPipeline)} pending</span>}
              </td>
              <td className="h-9 px-3 border-t border-border text-right tabular-nums">{closed ? dash : fmt(totalRemaining)}</td>
              <td className="h-9 px-3 border-t border-border" colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
    </>
  );
}
