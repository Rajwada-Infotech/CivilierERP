import React, { useContext, useEffect, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CornerUpLeft, RotateCcw, Search, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
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
// only points at the record. Drawn in the sheet's own language (ruled rows,
// small caps labels, the SheetMark square) so it reads as part of the page.
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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

// The sheet wrapper renders this on every page; outside the app's router and
// data provider (a test, an isolated screen) it simply shows nothing.
export function SentBackPanel() {
  const inRouter = useInRouterContext();
  const hasQueryClient = !!useContext(QueryClientContext);
  return inRouter && hasQueryClient ? <SentBackPanelInner /> : null;
}

function SentBackPanelInner() {
  const { pathname } = useLocation();
  // Applications and Bookings show it on each row (status note + Next button) instead.
  const onPage = pathname.startsWith("/crm/") && !["/crm/dashboard", "/crm/applications", "/crm/bookings"].includes(pathname);
  const { data } = useSentBack(onPage);
  const [all, setAll] = useState(false);
  if (!onPage || !data?.rows?.length) return null;
  const rows: any[] = data.rows.filter((r: any) => r.path === pathname || r.also === pathname);
  if (!rows.length) return null;
  const sentBack = rows.filter((r) => r.State === "SentBack").length;
  const resubmitted = rows.length - sentBack;
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <section className="bg-card border border-foreground" style={{ borderLeft: `3px solid hsl(var(--${sentBack ? "destructive" : "foreground"}))` }}
      aria-label="Sent back and resubmitted entries">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-4 py-2.5 border-b border-foreground/15">
        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">Needs attention</span>
        {sentBack > 0 && <span className="text-xs"><b className="font-heading tabular-nums text-destructive">{sentBack}</b> <span className="text-muted-foreground">sent back — to update</span></span>}
        {resubmitted > 0 && <span className="text-xs"><b className="font-heading tabular-nums">{resubmitted}</b> <span className="text-muted-foreground">resubmitted — to recheck</span></span>}
      </header>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-foreground/15">
              <th className={`px-4 py-1.5 text-left w-[8.5rem] ${LBL}`}>State</th>
              <th className={`px-2 py-1.5 text-left w-[15rem] ${LBL}`}>Entry</th>
              <th className={`px-2 py-1.5 text-left ${LBL}`}>Reason</th>
              <th className={`px-2 py-1.5 text-left w-[11rem] ${LBL}`}>Sent back by</th>
              <th className="px-4 py-1.5 w-[4.5rem]" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const st = SENT_BACK_STATE[r.State as keyof typeof SENT_BACK_STATE];
              return (
                <tr key={`${r.Kind}-${r.RecordId}-${r.State}`} className="border-b border-foreground/15 last:border-0 align-top hover:bg-primary/5">
                  <td className="px-4 py-2.5">
                    <SheetMark text={st.label} tone={st.tone} />
                    <div className="text-[0.6875rem] text-muted-foreground mt-0.5">{st.note}</div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-medium leading-snug">{r.area}{r.Item ? <span className="text-muted-foreground font-normal"> · {r.Item}</span> : null}</div>
                    <div className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground mt-0.5">{r.RecordNo || `#${r.RecordId}`}{r.BookingNo && r.BookingNo !== r.RecordNo ? ` · ${r.BookingNo}` : ""}</div>
                  </td>
                  <td className="px-2 py-2.5 leading-snug">{r.Reason ? `“${r.Reason}”` : <span className="text-muted-foreground">No reason given</span>}</td>
                  <td className="px-2 py-2.5">
                    <div className="truncate max-w-[11rem]" title={r.ByName || ""}>{r.ByName || "—"}</div>
                    <div className="text-[0.6875rem] text-muted-foreground mt-0.5">{sinceLabel(r.At)}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {/* Already on that page: reload it, since pages read their record from the address when they open. */}
                    <Link to={r.link} reloadDocument={r.path === pathname} className="inline-flex items-center gap-1 h-7 px-2.5 border border-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-foreground hover:text-card transition-colors">
                      Open <ArrowRight size={11} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 3 && (
        <button type="button" onClick={() => setAll((a) => !a)} className={`w-full px-4 py-2 text-left border-t border-foreground/15 hover:text-foreground ${LBL}`}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Each application's / booking's sent-back state (booking approval or data
 * review), keyed by its id — for a list's buttons. Sent back wins over
 * resubmitted when it has both.
 */
export function useSentBackStates(by: "ApplicationId" | "BookingId"): Map<number, keyof typeof SENT_BACK_STATE> {
  const { data } = useSentBack();
  const m = new Map<number, keyof typeof SENT_BACK_STATE>();
  for (const r of (data?.rows || []) as any[]) {
    if (r.Kind !== "booking" && r.Kind !== "review") continue;
    if (m.get(r[by]) !== "SentBack") m.set(r[by], r.State);
  }
  return m;
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
        {sentBack ? `Sent back${sb.first.ByName ? ` by ${sb.first.ByName}` : ""}` : "Resubmitted — recheck"}
        {items.length ? ` · ${items.join(", ")}` : ""} — {reason}
      </span>
    </span>
  );
}
