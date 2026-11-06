// Payment Milestones' parts. The list's masthead and columns; the plan's ribbon, its money trail, its full schedule, and
// the deposits, Finance entries and price, every one shown on the page.
import React from "react";
import { CrmStatus } from "@/constants/crmStatuses";
import { AlertTriangle, CheckCircle2, Clock, Hourglass, MessageSquare } from "lucide-react";
import { GRID_CARD, GRID_SHEET_KEYS, GridMiniTable, GridStatusPill, GridToneMark, type GridCol } from "@/components/crm/CrmDataTable";
import { cn } from "@/lib/utils";
import { fmt, fmtDate, fmtShort, isOverdue, milestoneFill, nextOpenMilestone, pct, MONEY_STAGE, RIBBON, TRAIL_STAGE, type LedgerRow, type LedgerSummary } from "./config";

const { KEY_INK, KEY_LINE } = GRID_SHEET_KEYS;
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
          <button key={m.Id} type="button" onClick={() => onPick(m)} title={tip} aria-label={tip}
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
      {[RIBBON.settled, RIBBON.held, RIBBON.finance, RIBBON.overdue, RIBBON.open].map((k) => (
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
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400">{eyebrow}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {sub && <div className="mt-0.5 text-[0.8125rem] text-slate-400">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,2fr)] gap-x-10 gap-y-4 items-end">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-[2rem] leading-none font-semibold tabular-nums tracking-tight">{lead}</span>
            <span className="text-[0.8125rem] text-slate-400 tabular-nums">{leadNote}</span>
          </div>
          <div className="mt-3">{bar}</div>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3">
          {figures.map((f) => (
            <div key={f.label} className="min-w-0 border-l border-white/10 pl-4" title={f.exact}>
              <dt className="flex items-center gap-1.5 text-xs text-slate-400">{f.dot && <span className={cn("w-2 h-2 rounded-full shrink-0", f.dot)} />}{f.label}</dt>
              <dd className={cn("mt-1 text-xl font-semibold tabular-nums tracking-tight", f.alert && "text-rose-300")}>{f.value}</dd>
              <dd className="mt-0.5 text-[0.6875rem] text-slate-400 truncate">{f.note}</dd>
            </div>
          ))}
        </dl>
      </div>
      {footer && <div className="mt-4 pt-3 border-t border-white/10 text-[0.8125rem] text-slate-300">{footer}</div>}
    </section>
  );
}

// The money's colours on the masthead's dark ground and on the rows' white one.
export const BAND_DOT = { collected: "bg-emerald-400", held: RIBBON.held.cls, finance: "bg-amber-300", recorded: RIBBON.recorded.cls, notDue: "bg-slate-500", overdue: "bg-rose-400" };
const ROW_FILL = { collected: "bg-emerald-500", finance: "bg-amber-400", overdue: "bg-rose-500" };

/** Every rupee received as one line against all that is due: verified by Finance, with Finance, not yet with Finance. */
export function CollectionBar({ due, collected, finance, recorded, onDark, title }: { due: number; collected: number; finance: number; recorded: number; onDark?: boolean; title?: string }) {
  const w = (n: number) => `${due > 0 ? Math.min(100, (n / due) * 100) : 0}%`;
  return (
    <span className={cn("flex w-full rounded-full overflow-hidden", onDark ? "h-2.5 bg-white/15" : "h-1.5 bg-slate-200 dark:bg-slate-700")} title={title}>
      {collected > 0 && <span className={onDark ? BAND_DOT.collected : "bg-emerald-500"} style={{ width: w(collected), minWidth: 3 }} />}
      {finance > 0 && <span className={onDark ? BAND_DOT.finance : "bg-amber-400"} style={{ width: w(finance), minWidth: 3 }} />}
      {recorded > 0 && <span className={RIBBON.recorded.cls} style={{ width: w(recorded), minWidth: 3 }} />}
    </span>
  );
}

/** A person's two initials. */
function Initials({ name, small }: { name: string | null; small?: boolean }) {
  const parts = String(name || "?").trim().split(/\s+/);
  const text = `${parts[0]?.[0] || "?"}${parts.length > 1 ? parts[parts.length - 1][0] : ""}`.toUpperCase();
  return <span className={cn("shrink-0 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 font-semibold flex items-center justify-center", small ? "w-6 h-6 text-[0.625rem]" : "w-8 h-8 text-[0.6875rem]")}>{text}</span>;
}
/** Names come in as typed, often all capitals: on the list they read as names. */
const asName = (s: string | null) => String(s || "").toLowerCase();

/** The next step on a booking, in words, from its plan. */
function nextStep(r: LedgerRow) {
  if (r.Closed) return <GridStatusPill status={r.BookingStatus} />;
  if (!r.PlanCount) return <span className="text-muted-foreground">No schedule yet</span>;
  const m = nextOpenMilestone(r.plan || []);
  if (!m) return <span className="text-muted-foreground">{r.WithFinance > 0 || r.Recorded > 0 ? "Pending with Finance" : "All covered"}</span>;
  return <span>{m.MilestoneName} <span className="tabular-nums font-semibold">{fmt(milestoneFill(m).missing)}</span></span>;
}
// An ageing figure: a dash for nothing, so the eye goes to the money, and the later the money the stronger the ink.
const AGE_INK: Record<string, string> = {
  d30: "text-amber-700 dark:text-amber-300", d60: "text-orange-700 dark:text-orange-300",
  d90: "text-rose-600 dark:text-rose-300", d90p: "text-rose-700 dark:text-rose-300 font-semibold",
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
        <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo} · {r.UnitNo}{r.ProjectName ? ` · ${r.ProjectName}` : ""}{r.Closed ? <span className="text-destructive"> · {r.BookingStatus}</span> : null}</span>
      </span>
    </span>
  ) },
  { id: "tracker", label: "Received", sortKey: "Collected", csv: (r) => Number(r.Collected) + Number(r.WithFinance) + Number(r.Recorded), cell: (r) => {
    const received = Number(r.Collected) + Number(r.WithFinance) + Number(r.Recorded);
    return (
      <span className="block min-w-[15rem] py-1.5" title={collectionTitle(r)}>
        <CollectionBar due={Number(r.TotalDue)} collected={Number(r.Collected)} finance={Number(r.WithFinance)} recorded={Number(r.Recorded)} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs tabular-nums">
          <span className="text-muted-foreground"><span className="font-medium text-foreground">{fmtShort(received)}</span> of {fmtShort(r.TotalDue)}</span>
          <span className="font-medium">{pct(received, r.TotalDue)}%</span>
        </span>
      </span>
    );
  } },
  { id: "verified", label: "Approved by Finance", align: "right", sortKey: "Collected", csv: (r) => r.Collected, cell: (r) => (Number(r.Collected) > 0 ? <span className="tabular-nums" title={fmt(r.Collected)}>{fmtShort(r.Collected)}</span> : dash) },
  { id: "pending", label: "Pending approval", align: "right", csv: (r) => Number(r.WithFinance) + Number(r.Recorded), cell: (r) => {
    const n = Number(r.WithFinance) + Number(r.Recorded);
    return n > 0 ? <span className="tabular-nums text-amber-700 dark:text-amber-300" title={`${RIBBON.finance.label} ${fmt(r.WithFinance)} · ${RIBBON.recorded.label} ${fmt(r.Recorded)}`}>{fmtShort(n)}</span> : dash;
  } },
  { id: "toCollect", label: "Balance", align: "right", sortKey: "ToCollect", csv: (r) => r.ToCollect, cell: (r) => (!r.Closed && Number(r.ToCollect) > 0 ? <span className="tabular-nums font-medium" title={fmt(r.ToCollect)}>{fmtShort(r.ToCollect)}</span> : dash) },
  { id: "overdue", label: "Overdue", align: "right", sortKey: "OverdueAmount", csv: (r) => r.OverdueAmount, cell: (r) => (!r.Closed && r.OverdueAmount > 0 ? (
    <span className="inline-flex flex-col items-end leading-tight" title={fmt(r.OverdueAmount)}>
      <span className="tabular-nums font-semibold text-destructive">{fmtShort(r.OverdueAmount)}</span>
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
export function TokenNote({ booking, moneyReceipts }: { booking: any; moneyReceipts: any[] }) {
  if (!(Number(booking?.TokenValue) > 0)) return null;
  const receipt = moneyReceipts[0];
  const tokenAmt = Number(booking.TokenValue);
  const pmode = booking.PaymentMode || "—";
  let note: { red?: boolean; icon: React.ReactNode; title: string; text: React.ReactNode } | null = null;
  if (receipt?.Status === "Bounced") {
    note = { red: true, icon: <AlertTriangle size={13} />, title: `Token payment bounced: ${fmt(tokenAmt)}`, text: <>{receipt.BouncedReason ? `Reason: ${receipt.BouncedReason}. ` : ""}A new Money Receipt must be submitted.</> };
  } else if (receipt?.Status === CrmStatus.PENDING && receipt?.RPStatus === CrmStatus.PENDING) {
    note = { icon: <Hourglass size={13} />, title: `${fmt(receipt.Amount || tokenAmt)} pending with Finance`, text: <>Receipt {receipt.ReceiptNo} · {pmode} · sent to Finance. It counts as received once approved.</> };
  } else if (receipt?.Status === CrmStatus.PENDING && !receipt?.RPStatus) {
    note = { icon: <Clock size={13} />, title: `${fmt(receipt.Amount || tokenAmt)} on hold: Money Receipt not sent to Finance`, text: <>Receipt {receipt.ReceiptNo} · {pmode} · created, not sent to Finance yet.</> };
  } else if (!receipt) {
    note = { icon: <Clock size={13} />, title: `Token ${fmt(tokenAmt)} on hold, via ${pmode}`, text: <>A Money Receipt is made when the booking is sent for approval. It counts as received once Finance approves it.</> };
  }
  if (!note) return null;
  return (
    <div className={cn("flex items-start gap-2.5 px-3 py-2 text-xs rounded-md border", note.red ? "border-destructive/40 bg-destructive/5" : "border-border bg-card")}>
      <span className={cn("shrink-0 mt-0.5", note.red && "text-destructive")}>{note.icon}</span>
      <p><span className={cn("font-semibold", note.red && "text-destructive")}>{note.title}.</span> <span className="text-muted-foreground">{note.text}</span></p>
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
    <dl className="max-w-md px-4 py-2 text-[0.8125rem]">
      {lines.map((x) => (
        <div key={x.l} className={cn("flex items-baseline justify-between gap-3 py-1", x.strong && "border-t border-border/70 mt-1 pt-2")}>
          <dt className={x.strong ? "font-semibold" : "text-muted-foreground"}>{x.l}</dt>
          <dd className={cn("tabular-nums", x.strong ? "font-bold" : "font-medium")}>{fmt(Number(x.v) || 0)}</dd>
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
        <div className="px-4 py-2 border-b border-border text-xs flex items-center gap-2 bg-amber-500/5">
          <AlertTriangle size={13} className="shrink-0 text-amber-600" />
          <span>Application amount <b className="tabular-nums">{fmt(trail.applicationToken)}</b>; Money Receipt amount <b className="tabular-nums">{fmt(trail.receiptAmount)}</b>. The Money Receipt amount is taken as received.</span>
        </div>
      )}
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-[0.8125rem] min-w-[900px]">
          <thead>
            <tr>
              <th className={th}>Date</th><th className={th}>Documents</th><th className={th}>Mode · Ref. no.</th>
              <th className={cn(th, "text-right")}>Amount</th><th className={cn(th, "text-right")}>Adjusted</th><th className={cn(th, "text-right")}>On account</th><th className={cn(th, "text-right")}>Refunded / reserved</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = TRAIL_STAGE[r.stage];
              const dead = r.stage === "returned" || r.stage === "bounced" || r.stage === "adjustment";
              return (
                <tr key={r.id} className={cn("hover:bg-muted/40", dead && "text-muted-foreground")}>
                  <td className={cn(td, "whitespace-nowrap")}>{r.date ? fmtDate(r.date) : dash}</td>
                  <td className={td}>{r.docs?.length ? r.docs.join(" → ") : r.note}{r.milestone ? <span className="ml-2 text-xs text-muted-foreground">{r.milestone}</span> : null}</td>
                  <td className={td}>{r.mode || "—"}{r.ref ? <span className="text-muted-foreground"> · {r.ref}</span> : null}</td>
                  <td className={cn(td, "text-right font-semibold", dead && "font-normal", dead && r.stage !== "adjustment" && "line-through")}>{fmt(r.amount)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.settled)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.held)}</td>
                  <td className={cn(td, "text-right")}>{amt(r.out)}</td>
                  <td className={td} title={[st?.hint, r.docs?.length ? r.note : null].filter(Boolean).join(" · ")}><GridToneMark text={st?.label || r.stage} tone={st?.tone ?? "waiting"} /></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-muted font-semibold tabular-nums">
              <td className="h-9 px-3 border-t border-border" colSpan={3}>Total received, against {fmt(totalDue)} due</td>
              <td className="h-9 px-3 border-t border-border text-right">{fmt(t.received)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.settled)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.held)}</td>
              <td className="h-9 px-3 border-t border-border text-right">{amt(t.out)}</td>
              <td className="h-9 px-3 border-t border-border text-xs font-medium text-muted-foreground whitespace-nowrap">
                {[Number(t.finance) > 0 ? `${fmt(t.finance)} pending with Finance` : null, Number(t.recorded) > 0 ? `${fmt(t.recorded)} not sent to Finance` : null].filter(Boolean).join(" · ")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// Deposits that aren't usable money: never counted, never applied.
const UNAVAILABLE = ["Bounced", "Held", "Void", "Cancelled", "Refunded"];

export function OnAccountPanel({ onAccountData, notFullyPaid, fundsOnHand, requiredAmount, fullPaymentShortfall, inVerification = 0, milestones, canManuallyApply, canEdit, onApply }: {
  onAccountData: any; notFullyPaid: boolean; fundsOnHand: number; requiredAmount: number; inVerification?: number;
  fullPaymentShortfall: number; milestones: any[]; canManuallyApply: boolean; canEdit: boolean; onApply: (payment: any) => void;
}) {
  const hasOutstanding = milestones.some((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived" && Number(m.AmountDue) > Number(m.AmountPaid || 0));
  const usableLeft = (onAccountData?.payments || []).some((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) > Number(p.AppliedAmount || 0));
  return (
    <>
      <p className="px-4 py-2 text-xs text-muted-foreground border-b border-border/70">
        {notFullyPaid ? (
          <>{fmt(fundsOnHand)} of {fmt(requiredAmount)} approved by Finance. A further {fmt(fullPaymentShortfall)} is needed before these deposits are adjusted to the milestones{inVerification > 0 ? ` (${fmt(Math.min(inVerification, fullPaymentShortfall))} of it is pending with Finance)` : ""}.</>
        ) : <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={12} /> Full booking amount received. Deposits are adjusted to the milestones automatically, in order.</span>}
        {milestones.length > 0 && !hasOutstanding && usableLeft && " No milestone balance is outstanding; the remainder stays on account."}
      </p>
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
          return canApply ? <button type="button" onClick={() => onApply(p)} title="This deposit should apply itself once its milestone is eligible: use this only as a manual fallback" className={cn(KEY_LINE, SMALL_KEY)}>Apply manually</button> : null;
        } },
      ]} />
    </>
  );
}

/** The money against a milestone, in words on one line. */
function moneyWords(m: any) {
  const f = milestoneFill(m);
  if (f.waived) return <span className="text-muted-foreground">Waived</span>;
  const bits = [
    f.settled > 0 ? <span key="s">{fmt(f.settled)} adjusted</span> : null,
    f.held > 0 ? <span key="h" className="text-teal-700 dark:text-teal-300" title={MONEY_STAGE.Verified.hint}>{fmt(f.held)} on account</span> : null,
    f.finance > 0 ? <span key="f" className="text-amber-700 dark:text-amber-300" title={MONEY_STAGE.InVerification.hint}>{fmt(f.finance)} pending with Finance</span> : null,
    f.recorded > 0 ? <span key="r" className="text-sky-700 dark:text-sky-300" title={MONEY_STAGE.Recorded.hint}>{fmt(f.recorded)} not sent to Finance</span> : null,
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

export function MilestoneTable({ milestones, canEdit, onAccountData, onAccountBalance, notFullyPaid, fullPaymentShortfall, nextMilestone, canManuallyApply, activeId, onPay, onApply, onWaive, onRemarks }: {
  milestones: any[]; canEdit: boolean; onAccountData: any; onAccountBalance: number; notFullyPaid: boolean; fullPaymentShortfall: number;
  nextMilestone: any; canManuallyApply: boolean; activeId: number | null;
  onPay: (m: any) => void; onApply: (payment: any, m: any) => void; onWaive: (m: any) => void; onRemarks: (m: any) => void;
}) {
  const th = "h-8 px-3 text-xs font-semibold text-muted-foreground whitespace-nowrap bg-muted border-b border-border text-left";
  const td = "h-10 px-3 border-b border-border/70 align-middle";
  const passive = "inline-flex items-center h-7 px-2.5 rounded-md border border-border text-xs text-muted-foreground cursor-help";
  // One main action on the page: paying the milestone money is missing on next.
  const nextOpenId = nextOpenMilestone(milestones)?.Id;
  return (
    <div className="overflow-x-auto thin-scroll">
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
            const overdue = isOverdue(m);
            const f = milestoneFill(m);
            // The server's money stage (MONEY_STAGE): verified money On Account covers it (no Pay / Waive, which
            // would read as owed / forgiven), or an entry for it is with Finance.
            const stage = MONEY_STAGE[m.MoneyStage as string] || null;
            const covered = m.MoneyStage === "Verified";
            const status = stage ? stage.label : overdue ? (f.held + f.finance + f.recorded > 0 ? "Overdue · part received" : "Overdue") : m.Status === CrmStatus.PENDING ? "Due" : m.Status;
            const open = m.Status !== CrmStatus.PAID && m.Status !== "Waived";
            const pmt = onAccountBalance > 0 && m.Id === nextMilestone?.Id
              ? onAccountData?.payments?.find((p: any) => !UNAVAILABLE.includes(p.Status) && Number(p.Amount) - Number(p.AppliedAmount || 0) > 0)
              : null;
            const noAmount = Number(m.AmountDue) === 0 && Number(m.AmountPaid || 0) === 0 && m.Status === CrmStatus.PAID;
            const shown = activeId === m.Id;
            const details = milestoneDetails(m);
            return (
              <React.Fragment key={m.Id}>
                <tr id={`milestone-${m.Id}`} className={cn("hover:bg-muted/40", shown && "bg-primary/5")}>
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
                  <td className={cn(td, "text-xs tabular-nums whitespace-nowrap text-muted-foreground")}>{fmtDate(m.DueDate)}</td>
                  <td className={cn(td, "text-right tabular-nums whitespace-nowrap font-medium")}>{noAmount ? <span className="text-xs font-normal text-muted-foreground">No amount due</span> : fmt(m.AmountDue)}</td>
                  <td className={cn(td, "text-xs")}>{moneyWords(m)}</td>
                  <td className={cn(td, "text-right tabular-nums whitespace-nowrap", f.missing > 0 && "font-semibold")}>{f.waived || f.missing <= 0 ? dash : fmt(f.missing)}</td>
                  <td className={td} title={stage?.hint}>{m.Status === "Waived" ? <GridStatusPill status="Waived" /> : <GridToneMark text={status} tone={overdue ? "stopped" : stage?.tone ?? "waiting"} />}</td>
                  <td className={cn(td, "whitespace-nowrap")}>
                    {canEdit && open && (
                      <div className="flex items-center justify-end gap-1.5">
                        {!covered && <button type="button" onClick={() => onPay(m)} className={cn(m.Id === nextOpenId ? KEY_INK : KEY_LINE, SMALL_KEY)}>Pay</button>}
                        {pmt && (notFullyPaid
                          ? <span title={`Adjusted automatically once the full booking amount is received: a further ${fmt(fullPaymentShortfall)} is needed`} className={passive}>Auto</span>
                          : !canManuallyApply
                          ? <span title="Raise the Demand before applying on-account money to this milestone" className={passive}>Raise demand</span>
                          : <button type="button" onClick={() => onApply(pmt, m)} title="The full booking amount is received, so this should adjust automatically: use this only if it has not" className={cn(KEY_LINE, SMALL_KEY)}>Apply</button>)}
                        {!covered && <button type="button" onClick={() => onWaive(m)} className={cn(KEY_LINE, SMALL_KEY)}>Waive</button>}
                      </div>
                    )}
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
              <td className="h-9 px-3 border-t border-border text-right tabular-nums">{fmt(milestones.reduce((n, m) => n + (m.Status === "Waived" ? 0 : Number(m.AmountDue) || 0), 0))}</td>
              <td className="h-9 px-3 border-t border-border" />
              <td className="h-9 px-3 border-t border-border text-right tabular-nums">{fmt(milestones.reduce((n, m) => n + (milestoneFill(m).waived ? 0 : milestoneFill(m).missing), 0))}</td>
              <td className="h-9 px-3 border-t border-border" colSpan={2} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
