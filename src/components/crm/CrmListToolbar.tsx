import React, { useContext, useEffect, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { QueryClientContext, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CornerUpLeft, RotateCcw, Search, X } from "lucide-react";
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
// each flow already records (GET /api/crm/dashboard/sent-back). Shown at the
// top of every CRM page for that page's entries, and all of them on the CRM
// dashboard. Read-only: it only points at the record.
export const SENT_BACK_STATE = {
  SentBack: { label: "Sent back — to update", short: "Sent back", icon: CornerUpLeft, cls: "text-destructive border-destructive/50" },
  Resubmitted: { label: "Resubmitted — to recheck", short: "Resubmitted", icon: RotateCcw, cls: "text-foreground border-foreground/50" },
} as const;
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

/**
 * The mark on a list row (an application or a booking) that has something sent
 * back or resubmitted: which state, what, and the reason, from the same rows.
 */
export function SentBackMark({ applicationId, bookingId }: { applicationId?: number | null; bookingId?: number | null }) {
  const { data } = useSentBack();
  const mine: any[] = (data?.rows || []).filter((r: any) =>
    (r.Kind === "booking" || r.Kind === "review") &&
    ((applicationId != null && r.ApplicationId === applicationId) || (bookingId != null && r.BookingId === bookingId)));
  if (!mine.length) return null;
  const state = mine.some((r) => r.State === "SentBack") ? "SentBack" : "Resubmitted";
  const st = SENT_BACK_STATE[state];
  const first = mine.find((r) => r.State === state) || mine[0];
  const items = mine.filter((r) => r.Item).map((r) => r.Item);
  return (
    <div className={cn("mt-1 border-l-2 pl-1.5 text-[0.625rem] leading-snug whitespace-normal", state === "SentBack" ? "border-destructive" : "border-foreground")}
      title={mine.map((r) => `${r.Item || r.area}: ${r.Reason || "no reason given"}`).join("\n")}>
      <span className={cn("inline-flex items-center gap-1 font-heading font-semibold uppercase tracking-wide", state === "SentBack" ? "text-destructive" : "")}>
        <st.icon size={10} /> {st.label}
      </span>
      <div className="text-muted-foreground line-clamp-2">
        {items.length ? `${items.join(", ")} — ` : ""}{first.Reason || "No reason given"}
      </div>
    </div>
  );
}

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

// The sheet wrapper renders this on every page; outside the app's router and
// data provider (a test, an isolated screen) it simply shows nothing.
export function SentBackPanel() {
  const inRouter = useInRouterContext();
  const hasQueryClient = !!useContext(QueryClientContext);
  return inRouter && hasQueryClient ? <SentBackPanelInner /> : null;
}

function SentBackPanelInner() {
  const { pathname } = useLocation();
  const onCrm = pathname.startsWith("/crm/");
  const { data } = useSentBack(onCrm);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  if (!onCrm || !data?.rows?.length) return null;
  const everything = pathname === "/crm/dashboard";
  const rows: any[] = everything ? data.rows : data.rows.filter((r: any) => r.path === pathname || r.also === pathname);
  if (!rows.length) return null;
  const sentBack = rows.filter((r) => r.State === "SentBack").length;
  const resubmitted = rows.length - sentBack;
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <div className="border border-destructive/40 bg-card text-sm" role="region" aria-label="Sent back and resubmitted entries">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left">
        {sentBack > 0 && <span className="inline-flex items-center gap-1.5 font-heading font-semibold text-destructive"><CornerUpLeft size={13} /> {SENT_BACK_STATE.SentBack.label} · {sentBack}</span>}
        {resubmitted > 0 && <span className="inline-flex items-center gap-1.5 font-heading font-semibold"><RotateCcw size={13} /> {SENT_BACK_STATE.Resubmitted.label} · {resubmitted}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-border overflow-x-auto thin-scroll">
          <table className="w-full text-xs min-w-[720px]">
            <tbody>
              {shown.map((r) => {
                const st = SENT_BACK_STATE[r.State as keyof typeof SENT_BACK_STATE];
                return (
                  <tr key={`${r.Kind}-${r.RecordId}-${r.State}`} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-3 py-2 whitespace-nowrap"><span className={cn("inline-flex items-center gap-1 border px-1.5 py-0.5 font-heading text-[0.625rem] font-semibold uppercase tracking-wide", st.cls)}><st.icon size={10} /> {st.short}</span></td>
                    <td className="px-2 py-2">
                      <div className="font-medium">{r.area}{r.Item ? ` · ${r.Item}` : ""}</div>
                      <div className="text-muted-foreground tabular-nums">{r.RecordNo || `#${r.RecordId}`}{r.BookingNo && r.BookingNo !== r.RecordNo ? ` · ${r.BookingNo}` : ""}</div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground max-w-[22rem]">{r.Reason || "No reason given"}</td>
                    <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">{r.ByName || "—"}{r.At ? ` · ${when(r.At)}` : ""}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{/* Already on that page: reload it, since pages read their record from the address when they open. */}
                      <Link to={r.link} reloadDocument={r.path === pathname} className="inline-flex items-center gap-1 font-semibold hover:underline">Open <ArrowRight size={11} /></Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <button type="button" onClick={() => setAll(true)} className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border-t border-border">Show all {rows.length}</button>
          )}
        </div>
      )}
    </div>
  );
}
