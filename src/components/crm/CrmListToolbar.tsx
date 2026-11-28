import React, { useContext, useEffect, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, CornerUpLeft, RotateCcw, Search, X } from "lucide-react";
import { bookingSendBack } from "@/constants/crmStatuses";
import { cn } from "@/lib/utils";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export interface CrmStatusTab {
  key: string;
  label: string;
  count?: number;
  /** Tailwind bg class for the small status dot, e.g. "bg-foreground". */
  dot?: string;
}

interface Props {
  tabs: CrmStatusTab[];
  status: string;
  onStatus: (key: string) => void;
  searchValue: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  /** Extra filters (e.g. the Company/Project/Block selects). */
  children?: React.ReactNode;
}

/** One compact row: status chips with server counts · search · filters. */
export function CrmListToolbar({ tabs, status, onStatus, searchValue, onSearch, placeholder = "Search…", children }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-stretch flex-wrap bg-card" style={{ border: "1px solid hsl(var(--foreground))" }} role="group" aria-label="Filter by status">
        {tabs.map((t) => {
          const active = status === t.key;
          return (
            <button key={t.key} type="button" aria-pressed={active} onClick={() => onStatus(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors",
                active ? "bg-foreground text-card" : "bg-card text-muted-foreground hover:text-foreground hover:bg-primary/5",
              )} style={{ borderRight: "1px solid hsl(var(--foreground) / 0.15)" }}>
              {t.dot && <span className={cn("w-2 h-2", t.dot)} />}
              {t.label}
              {t.count !== undefined && <span className="tabular-nums opacity-70">{t.count}</span>}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={searchValue} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder}
            aria-label="Search"
            className="w-full sm:w-64 h-9 text-xs pl-7 pr-7 border border-foreground/40 focus:border-foreground bg-card text-foreground outline-none" />
          {searchValue && (
            <button type="button" onClick={() => onSearch("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {children && (
        <div className="w-full mt-1 flex justify-end">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Sent back / resubmitted ────────────────────────────────────────────────
// What a checker or approver sent back (the maker must update it) and what was
// corrected and sent in again (the checker must look again), read from what
// each flow already records (GET /api/crm/dashboard/sent-back). Read-only: it
// only points at the record. One slim line on the page (the counts and the
// latest reason); the entries open under it when wanted.
export const SENT_BACK_STATE = {
  SentBack: { label: "Sent back", note: "to update", tone: "stopped" as const },
  Resubmitted: { label: "Resubmitted", note: "to recheck", tone: "waiting" as const },
};
const SENT_BACK_KEY = ["crm-sent-back"];

export function useSentBack(enabled = true) {
  const qc = useQueryClient();
  // An approve / reject / resubmit anywhere refreshes it at once.
  useEffect(() => {
    const refresh = () => qc.invalidateQueries({ queryKey: SENT_BACK_KEY });
    window.addEventListener("approval-action", refresh);
    return () => window.removeEventListener("approval-action", refresh);
  }, [qc]);
  return useQuery({
    queryKey: SENT_BACK_KEY,
    queryFn: async () => {
      const r = await fetchWithAuth("/api/crm/dashboard/sent-back");
      if (!r.ok) return { rows: [], byPath: {}, sentBack: 0, resubmitted: 0, count: 0 };
      return r.json();
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** "today", "yesterday", "3 days ago", else the date. */
export function sinceLabel(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  const days = Math.floor((Date.now() - t.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// The sheet wrapper renders this on every page; outside the app's router and
// data provider (a test, an isolated screen) it simply shows nothing.
export function SentBackPanel({ chip = false }: { chip?: boolean }) {
  const inRouter = useInRouterContext();
  const hasQueryClient = !!useContext(QueryClientContext);
  return inRouter && hasQueryClient ? <SentBackPanelInner chip={chip} /> : null;
}

function SentBackPanelInner({ chip }: { chip: boolean }) {
  const { pathname } = useLocation();
  // Applications and Bookings show it on each row (status note + Next button) instead.
  const onPage = pathname.startsWith("/crm/") && !["/crm/dashboard", "/crm/applications", "/crm/bookings"].includes(pathname);
  const { data } = useSentBack(onPage);
  const [open, setOpen] = useState(false);
  if (!onPage || !data?.rows?.length) return null;
  const rows: any[] = data.rows.filter((r: any) => r.path === pathname || r.also === pathname);
  if (!rows.length) return null;
  const sentBack = rows.filter((r) => r.State === "SentBack").length;
  const resubmitted = rows.length - sentBack;
  const latest = rows[0];
  const entries = (
        <ul className="max-h-72 overflow-y-auto thin-scroll divide-y divide-border/70">
          {rows.map((r) => {
            const st = SENT_BACK_STATE[r.State as keyof typeof SENT_BACK_STATE];
            const isSentBack = r.State === "SentBack";
            return (
              <li key={`${r.Kind}-${r.RecordId}-${r.State}`} className="px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs hover:bg-muted/40 transition-colors">
                <span className={cn("w-[5.75rem] shrink-0 font-semibold", isSentBack ? "text-rose-400 [[data-theme]_&]:text-rose-700" : "text-amber-300 [[data-theme]_&]:text-amber-700")} title={st.note}>{st.label}</span>
                <span className="w-[16rem] max-w-full min-w-0 truncate shrink-0 font-medium text-foreground" title={`${r.RecordNo || `#${r.RecordId}`}${r.BookingNo && r.BookingNo !== r.RecordNo ? ` \u00b7 ${r.BookingNo}` : ""}`}>
                  {r.area}{r.Item ? ` \u00b7 ${r.Item}` : ""} <span className="text-muted-foreground font-normal tabular-nums">{r.BookingNo || r.RecordNo || `#${r.RecordId}`}</span>
                </span>
                <span className="flex-1 min-w-[10rem] truncate text-foreground/90" title={r.Reason || undefined}>{r.Reason ? `\u201c${r.Reason}\u201d` : <span className="text-muted-foreground">No reason given</span>}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{r.ByName || "\u2014"} \u00b7 {sinceLabel(r.At)}</span>
                <Link to={r.link} reloadDocument={r.path === pathname && !String(r.link || "").includes("?")} onClick={() => setOpen(false)} className="shrink-0 inline-flex items-center gap-1 font-semibold text-primary hover:underline">Open <ArrowRight size={11} /></Link>
              </li>
            );
          })}
        </ul>
  );
  if (chip) {
    return (
      <div className="relative">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold border transition-colors",
            "bg-rose-500/15 text-rose-200 border-rose-500/35 hover:bg-rose-500/25",
            "[[data-theme]_&]:bg-rose-50 [[data-theme]_&]:text-rose-700 [[data-theme]_&]:border-rose-300 [[data-theme]_&]:hover:bg-rose-100",
          )}>
          <CornerUpLeft size={13} />
          {[sentBack ? `${sentBack} sent back` : null, resubmitted ? `${resubmitted} resubmitted` : null].filter(Boolean).join(" \u00b7 ")}
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <>
            <button type="button" aria-label="Close" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-2 z-40 w-[48rem] max-w-[92vw] rounded-xl border border-border bg-card text-foreground shadow-xl overflow-hidden">
              <div className="px-3.5 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <CornerUpLeft size={13} className="text-rose-400 [[data-theme]_&]:text-rose-700" />
                  Returned &amp; resubmitted items ({rows.length})
                </span>
                <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">Close <X size={12} /></button>
              </div>
              {entries}
            </div>
          </>
        )}
      </div>
    );
  }
  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden" aria-label="Sent back and resubmitted entries">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full h-9 px-3 flex items-center gap-3 text-xs text-left hover:bg-muted/40">
        <CornerUpLeft size={13} className={cn("shrink-0", sentBack ? "text-destructive" : "text-muted-foreground")} />
        {sentBack > 0 && <span className="shrink-0"><b className="tabular-nums text-destructive">{sentBack}</b> sent back</span>}
        {resubmitted > 0 && <span className="shrink-0"><b className="tabular-nums">{resubmitted}</b> resubmitted</span>}
        {!open && latest.Reason && <span className="min-w-0 truncate text-muted-foreground">Latest: {`\u201c${latest.Reason}\u201d`}{latest.ByName ? ` from ${latest.ByName}` : ""}</span>}
        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-primary">{open ? "Hide" : "Review"} <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} /></span>
      </button>
      {open && <div className="border-t border-border">{entries}</div>}
    </section>
  );
}

/**
 * Each application's / booking's sent-back state (booking approval or data
 * review), keyed by its id — for a list's buttons. Sent back wins over
 * resubmitted when it has both.
 */
export type RowTurn = keyof typeof SENT_BACK_STATE | "Reapprove";
/** Each list row's turn from the sent-back rows (pure — useSentBackStates feeds it the server's rows). */
export function sentBackTurns(rows: any[], by: "ApplicationId" | "BookingId"): Map<number, RowTurn> {
  const m = new Map<number, RowTurn>();
  for (const r of rows || []) {
    if (r.Kind !== "booking" && r.Kind !== "review") continue;
    // Sent back to an approval stage: that approver's turn, not a correction —
    // a button only for someone who can approve it (r.CanApprove, from Approval
    // Setup); everyone else just reads the row's note ("with Marketing Head").
    const withApprover = r.State === "SentBack" && r.Kind === "booking" && !bookingSendBack(r.Stage, r.FromStage).preparerCorrects;
    if (withApprover && !r.CanApprove) continue;
    const turn: RowTurn = withApprover ? "Reapprove" : r.State;
    const had = m.get(r[by]);
    if (had !== "SentBack") m.set(r[by], had === "Reapprove" && turn === "Resubmitted" ? had : turn);
  }
  return m;
}
export function useSentBackStates(by: "ApplicationId" | "BookingId"): Map<number, RowTurn> {
  const { data } = useSentBack();
  return sentBackTurns((data?.rows || []) as any[], by);
}

/**
 * An application's or booking's own sent-back state (its booking approval or
 * data review), for its list row: the state and the entries behind it.
 */
export function useSentBackFor({ applicationId, bookingId }: { applicationId?: number | null; bookingId?: number | null }) {
  const { data } = useSentBack();
  const rows: any[] = (data?.rows || []).filter((r: any) =>
    (r.Kind === "booking" || r.Kind === "review") &&
    ((applicationId != null && r.ApplicationId === applicationId) || (bookingId != null && r.BookingId === bookingId)));
  if (!rows.length) return null;
  const state: keyof typeof SENT_BACK_STATE = rows.some((r) => r.State === "SentBack") ? "SentBack" : "Resubmitted";
  return { state, rows, first: rows.find((r) => r.State === state) || rows[0] };
}

/**
 * The note line under a row's status, in the same form as the lists' other
 * notes (small icon + one line): who sent it back and why, or that it is back
 * for a recheck. Every reason on hover.
 */
export function SentBackNote({ applicationId, bookingId }: { applicationId?: number | null; bookingId?: number | null }) {
  const sb = useSentBackFor({ applicationId, bookingId });
  if (!sb) return null;
  const items = sb.rows.filter((r) => r.Item).map((r) => r.Item);
  const reason = sb.first.Reason ? `“${sb.first.Reason}”` : "no reason given";
  const sentBack = sb.state === "SentBack";
  return (
    <span className={cn("flex items-start gap-1 text-[0.6875rem] leading-snug", sentBack ? "text-destructive" : "text-foreground")}
      title={sb.rows.map((r) => `${r.Item || r.area}: ${r.Reason || "no reason given"} (${r.ByName || "—"}, ${sinceLabel(r.At)})`).join("\n")}>
      {sentBack ? <CornerUpLeft size={10} className="mt-[2px] shrink-0" /> : <RotateCcw size={10} className="mt-[2px] shrink-0" />}
      <span className="line-clamp-2">
        {sentBack
          ? sb.first.Kind === "booking"
            ? `Sent back by ${bookingSendBack(sb.first.Stage, sb.first.FromStage).from}${sb.first.ByName ? ` (${sb.first.ByName})` : ""} — with ${bookingSendBack(sb.first.Stage, sb.first.FromStage).now}`
            : `Sent back${sb.first.ByName ? ` by ${sb.first.ByName}` : ""}`
          : "Resubmitted — recheck"}
        {items.length ? ` · ${items.join(", ")}` : ""} — {reason}
      </span>
    </span>
  );
}
