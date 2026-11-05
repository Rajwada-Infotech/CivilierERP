import { CrmStatus } from "@/constants/crmStatuses";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { exportToCsv } from "@/lib/export";
import { cn } from "@/lib/utils";
import {
  Phone, FileText, Home, MessageSquare, Wrench, ArrowLeft, Search, X, RotateCcw, RefreshCw, Download, Columns3,
  Receipt, Wallet, Users2, ChevronDown, ChevronRight, ChevronLeft, ChevronsLeft, ChevronsRight, Mail, MapPin,
  CalendarClock, ExternalLink, Activity, ArrowUp, ArrowDown, ArrowUpDown, Check, Bookmark, Trash2,
} from "lucide-react";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SheetShell } from "@/components/sheet/Sheet";
import { StatusBadge } from "@/components/StatusBadge";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { round2 } from "@/lib/crmPriceQuote";

const API = "/api/crm/customer-360";
const PAGE_SIZES = [25, 50, 100, 200] as const;
const PREFS_KEY = "crm-customer-360-grid";
const VIEWS_KEY = "crm-customer-360-saved-views";

interface Unit { ProjectName: string | null; UnitNo: string | null }
interface CustomerRow {
  Id: number; CustomerNo: string | null; CustomerName: string | null; Mobile: string | null;
  City: string | null; State: string | null; CreatedAt: string | null; ApplicationCount: number; ActiveBookingCount: number;
  TotalPaid: number; TotalOutstanding: number; Units?: Unit[];
}
type ViewKey = "all" | "due" | "clear" | "nobooking";
interface ListResult {
  rows: CustomerRow[]; total: number; views: Record<ViewKey, number>;
  summary: { totalPaid: number; totalOutstanding: number; activeBookings: number };
}

// The saved views; the server's C360_VIEWS (routes/crmCustomer360.js) holds what each one keeps.
const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "all", label: "All customers" },
  { key: "due", label: "Has outstanding" },
  { key: "clear", label: "Fully paid" },
  { key: "nobooking", label: "No live booking" },
];

async function fetchCustomerList(q: CrmListQuery): Promise<ListResult> {
  // A failed load used to read as "No customers found".
  const r = await fetchWithAuth(`${API}?${listParams(q, "all")}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the customers (${r.status}).`);
  return {
    rows: data.rows || [], total: data.total || 0,
    views: data.views || { all: 0, due: 0, clear: 0, nobooking: 0 },
    summary: data.summary || { totalPaid: 0, totalOutstanding: 0, activeBookings: 0 },
  };
}
async function fetchAllCustomers(q: CrmListQuery): Promise<CustomerRow[]> {
  const p = listParams(q, "all");
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => ([]));
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the customers (${r.status}).`);
  return data;
}
async function fetchCustomer360(customerId: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${customerId}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Could not load this customer's ledger");
  return data;
}

const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const dt = (v: any) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const num = "tabular-nums";
const unitLabel = (u: Unit) => [u.ProjectName, u.UnitNo].filter(Boolean).join(" · ") || "—";
const isOverdue = (m: any, today: Date) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < today;

// Grid look, one place: thin grey rules, a tinted header, compact rows.
// Solid header (rows scroll under it, so it must not be see-through); normal case: Sheet.tsx leaves a sheet-grid table's header to the page.
const TH = "h-8 px-3 text-[0.6875rem] font-semibold normal-case tracking-normal text-muted-foreground whitespace-nowrap bg-muted border-b border-border";
const TD = "h-9 px-3 border-b border-border/70 align-middle";
const BTN = "inline-flex items-center gap-1.5 h-8 px-2.5 text-xs border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed";
const LABEL = "text-[0.6875rem] text-muted-foreground";

// ── Customer list columns (also the Excel export's columns) ───────────────────
interface GridCol {
  id: string; label: string; sortKey?: string; align?: "right"; locked?: boolean; hiddenByDefault?: boolean;
  cell: (c: CustomerRow) => React.ReactNode;
  csv: (c: CustomerRow) => unknown;
}
const GRID_COLS: GridCol[] = [
  {
    id: "name", label: "Customer", sortKey: "CustomerName", locked: true,
    cell: (c) => <span className="font-medium text-primary hover:underline truncate block max-w-[18rem]">{c.CustomerName || "—"}</span>,
    csv: (c) => c.CustomerName,
  },
  { id: "no", label: "Customer no.", sortKey: "CustomerNo", cell: (c) => <span className={`${num} text-muted-foreground`}>{c.CustomerNo || "—"}</span>, csv: (c) => c.CustomerNo },
  { id: "mobile", label: "Mobile", cell: (c) => <span className={num}>{c.Mobile || "—"}</span>, csv: (c) => c.Mobile },
  { id: "city", label: "City", sortKey: "City", cell: (c) => [c.City, c.State].filter(Boolean).join(", ") || "—", csv: (c) => [c.City, c.State].filter(Boolean).join(", ") },
  {
    id: "units", label: "Units",
    cell: (c) => {
      const units = c.Units || [];
      if (!units.length) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="truncate block max-w-[16rem]" title={units.map(unitLabel).join("\n")}>
          {unitLabel(units[0])}{units.length > 1 && <span className="text-muted-foreground"> +{units.length - 1}</span>}
        </span>
      );
    },
    csv: (c) => (c.Units || []).map(unitLabel).join("; "),
  },
  { id: "apps", label: "Applications", sortKey: "ApplicationCount", align: "right", cell: (c) => <span className={num}>{c.ApplicationCount ?? 0}</span>, csv: (c) => c.ApplicationCount },
  { id: "bookings", label: "Live bookings", sortKey: "ActiveBookingCount", align: "right", cell: (c) => <span className={num}>{c.ActiveBookingCount ?? 0}</span>, csv: (c) => c.ActiveBookingCount },
  { id: "paid", label: "Received", sortKey: "TotalPaid", align: "right", cell: (c) => <span className={num}>{fmt(c.TotalPaid)}</span>, csv: (c) => c.TotalPaid },
  {
    id: "due", label: "Outstanding", sortKey: "TotalOutstanding", align: "right",
    cell: (c) => <span className={cn(num, Number(c.TotalOutstanding) > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(c.TotalOutstanding)}</span>,
    csv: (c) => c.TotalOutstanding,
  },
  { id: "created", label: "Created", sortKey: "CreatedAt", hiddenByDefault: true, cell: (c) => <span className={num}>{dt(c.CreatedAt)}</span>, csv: (c) => dt(c.CreatedAt) },
];
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };
const MIN_COL_WIDTH = 64;

// ── The viewer's own grid layout and saved views, kept in this browser only ──
interface GridPrefs { order: string[]; hidden: string[]; widths: Record<string, number> }
const DEFAULT_PREFS: GridPrefs = {
  order: GRID_COLS.map((c) => c.id),
  hidden: GRID_COLS.filter((c) => c.hiddenByDefault).map((c) => c.id),
  widths: {},
};
function readStore<T>(key: string, fallback: T): T {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v ?? fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not kept: fine */ }
}
function useGridPrefs(): [GridPrefs, (p: GridPrefs) => void] {
  const [prefs, setPrefs] = useState<GridPrefs>(() => {
    const saved = readStore<Partial<GridPrefs>>(PREFS_KEY, {});
    const known = (ids: unknown) => (Array.isArray(ids) ? ids.filter((id) => GRID_COLS.some((c) => c.id === id)) : null);
    const order = known(saved.order) ?? DEFAULT_PREFS.order;
    // a column added since the layout was saved goes on the end
    for (const c of GRID_COLS) if (!order.includes(c.id)) order.push(c.id);
    return { order, hidden: known(saved.hidden) ?? DEFAULT_PREFS.hidden, widths: saved.widths && typeof saved.widths === "object" ? saved.widths : {} };
  });
  const save = (p: GridPrefs) => { setPrefs(p); writeStore(PREFS_KEY, p); };
  return [prefs, save];
}

/** A small menu that closes on an outside click or Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}
const MENU = "absolute right-0 top-9 z-30 bg-card border border-border shadow-lg py-1";
const MENU_HEAD = "px-3 py-1.5 text-[0.6875rem] font-semibold text-muted-foreground";

const ColumnChooser: React.FC<{ prefs: GridPrefs; onChange: (p: GridPrefs) => void }> = ({ prefs, onChange }) => {
  const { open, setOpen, ref } = usePopover();
  const byId = (id: string) => GRID_COLS.find((c) => c.id === id)!;
  const toggle = (id: string) => onChange({ ...prefs, hidden: prefs.hidden.includes(id) ? prefs.hidden.filter((x) => x !== id) : [...prefs.hidden, id] });
  const move = (i: number, by: -1 | 1) => {
    const order = [...prefs.order];
    [order[i], order[i + by]] = [order[i + by], order[i]];
    onChange({ ...prefs, order });
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className={BTN} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Columns3 size={13} /> Columns
      </button>
      {open && (
        <div role="menu" className={cn(MENU, "w-64")}>
          <div className={MENU_HEAD}>Show and order columns</div>
          {prefs.order.map((id, i) => {
            const c = byId(id);
            const on = c.locked || !prefs.hidden.includes(id);
            return (
              <div key={id} className="flex items-center gap-1 pr-2 hover:bg-muted">
                <button type="button" role="menuitemcheckbox" aria-checked={on} disabled={c.locked} onClick={() => toggle(id)}
                  className="flex-1 flex items-center gap-2 px-3 h-8 text-xs text-left disabled:opacity-60">
                  <span className={cn("w-3.5 h-3.5 border flex items-center justify-center", on ? "bg-primary border-primary text-primary-foreground" : "border-border")}>
                    {on && <Check size={10} />}
                  </span>
                  {c.label}
                </button>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.label} up`}
                  className="h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25"><ArrowUp size={12} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === prefs.order.length - 1} aria-label={`Move ${c.label} down`}
                  className="h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-25"><ArrowDown size={12} /></button>
              </div>
            );
          })}
          <div className="border-t border-border mt-1 pt-1">
            <button type="button" onClick={() => onChange(DEFAULT_PREFS)} className="w-full px-3 h-8 text-xs text-left text-muted-foreground hover:bg-muted">
              Reset columns, order and widths
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface SavedView { name: string; status: string; search: string; cpb: CrmCompanyProjectBlockValue; sort: CrmSort; pageSize: number }

const SavedViews: React.FC<{ current: Omit<SavedView, "name">; onApply: (v: SavedView) => void }> = ({ current, onApply }) => {
  const { open, setOpen, ref } = usePopover();
  const [views, setViews] = useState<SavedView[]>(() => {
    const v = readStore<SavedView[]>(VIEWS_KEY, []);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string") : [];
  });
  const [name, setName] = useState("");
  const keep = (next: SavedView[]) => { setViews(next); writeStore(VIEWS_KEY, next); };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    keep([...views.filter((v) => v.name !== n), { name: n, ...current }].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className={BTN} onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        <Bookmark size={13} /> My views{views.length ? <span className="tabular-nums text-muted-foreground">{views.length}</span> : null}
      </button>
      {open && (
        <div role="menu" className={cn(MENU, "w-72")}>
          <div className={MENU_HEAD}>Saved views</div>
          {views.length === 0 && <div className="px-3 pb-2 text-xs text-muted-foreground">None yet. Set the view, filters and sort, then save them here.</div>}
          {views.map((v) => (
            <div key={v.name} className="flex items-center hover:bg-muted">
              <button type="button" role="menuitem" onClick={() => { onApply(v); setOpen(false); }} className="flex-1 min-w-0 px-3 h-8 text-xs text-left truncate">{v.name}</button>
              <button type="button" onClick={() => keep(views.filter((x) => x.name !== v.name))} aria-label={`Delete view ${v.name}`}
                className="h-8 w-8 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
            </div>
          ))}
          <form className="border-t border-border mt-1 p-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="View name" maxLength={60}
              className="flex-1 min-w-0 h-8 px-2 text-xs border border-border focus:border-primary bg-card text-foreground outline-none" />
            <button type="submit" disabled={!name.trim()} className={BTN}>Save</button>
          </form>
          <div className="px-3 pb-2 text-[0.625rem] text-muted-foreground">Saved in this browser only.</div>
        </div>
      )}
    </div>
  );
};

const SortHead: React.FC<{ col: GridCol; sort: CrmSort; onSort: (k: string) => void }> = ({ col, sort, onSort }) => {
  if (!col.sortKey) return <>{col.label}</>;
  const active = sort.key === col.sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(col.sortKey!)} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground", col.align === "right" && "flex-row-reverse")}>
      {col.label}<Icon size={11} className={active ? "" : "opacity-40"} />
    </button>
  );
};

const GridFooter: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize: (n: number) => void }> = ({ page, pageSize, total, onPage, onPageSize }) => {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground border-t border-border bg-muted/30">
      <label className="inline-flex items-center gap-2">
        Rows per page
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-7 border border-border bg-card px-1.5 text-xs text-foreground">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="flex items-center gap-1">
        <span className={`${num} mr-2`}>{from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}</span>
        <button type="button" className={cn(BTN, "h-7 px-1.5")} onClick={() => onPage(1)} disabled={page <= 1} aria-label="First page"><ChevronsLeft size={13} /></button>
        <button type="button" className={cn(BTN, "h-7 px-1.5")} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={13} /></button>
        <span className={`${num} px-2`}>Page {page} of {last}</span>
        <button type="button" className={cn(BTN, "h-7 px-1.5")} onClick={() => onPage(page + 1)} disabled={page >= last} aria-label="Next page"><ChevronRight size={13} /></button>
        <button type="button" className={cn(BTN, "h-7 px-1.5")} onClick={() => onPage(last)} disabled={page >= last} aria-label="Last page"><ChevronsRight size={13} /></button>
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: React.ReactNode; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="px-4 py-2.5 min-w-0">
    <div className={LABEL}>{label}</div>
    <div className={cn("mt-0.5 text-[0.9375rem] tabular-nums truncate", strong ? "font-bold" : "font-semibold")}>{value}</div>
  </div>
);

// ── Customer list ────────────────────────────────────────────────────────────
/** Prev / Next for the open customer, through the list as it is filtered and sorted (across pages). */
interface RecordNav { position: number; total: number; prev: (() => void) | null; next: (() => void) | null }

const CustomerList: React.FC<{ openId: number | null; onOpen: (id: number) => void; onNav: (nav: RecordNav | null) => void }> = ({ openId, onOpen, onNav }) => {
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: "all" });
  const [prefs, setPrefs] = useGridPrefs();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-customer-360-list", s.query],
    queryFn: () => fetchCustomerList(s.query),
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const cols = prefs.order.map((id) => GRID_COLS.find((c) => c.id === id)!).filter((c) => c.locked || !prefs.hidden.includes(c.id));

  // Prev / Next: inside the page it opens the neighbour row; past either end it turns the page and opens
  // that page's first (or last) row once it has loaded.
  const pending = useRef<"first" | "last" | null>(null);
  useEffect(() => {
    if (!pending.current || isFetching || !data?.rows.length) return;
    const row = pending.current === "first" ? data.rows[0] : data.rows[data.rows.length - 1];
    pending.current = null;
    onOpen(row.Id);
  }, [data, isFetching, onOpen]);
  const idx = openId != null ? rows.findIndex((r) => r.Id === openId) : -1;
  useEffect(() => {
    if (idx < 0) { onNav(null); return; }
    const position = (s.page - 1) * pageSize + idx + 1;
    onNav({
      position, total,
      prev: position > 1 ? () => { if (idx > 0) onOpen(rows[idx - 1].Id); else { pending.current = "last"; s.setPage(s.page - 1); } } : null,
      next: position < total ? () => { if (idx < rows.length - 1) onOpen(rows[idx + 1].Id); else { pending.current = "first"; s.setPage(s.page + 1); } } : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, rows, total, s.page, pageSize]);

  // Column widths: drag the right edge of a header; double-click it to go back to automatic.
  const startResize = (e: React.MouseEvent, id: string) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    const startX = e.clientX, startW = th.getBoundingClientRect().width;
    let widths = prefs.widths;
    const move = (ev: MouseEvent) => {
      widths = { ...prefs.widths, [id]: Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX)) };
      setPrefs({ ...prefs, widths });
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  const autoWidth = (id: string) => { const { [id]: _gone, ...widths } = prefs.widths; setPrefs({ ...prefs, widths }); };
  const widthStyle = (id: string): React.CSSProperties | undefined => {
    const w = prefs.widths[id];
    return w ? { width: w, minWidth: w, maxWidth: w } : undefined;
  };

  const runExport = async () => {
    setExporting(true); setExportError(null);
    try {
      const all = await fetchAllCustomers(s.query);
      exportToCsv(all as any, cols.map((c) => ({ header: c.label, accessor: (r: any) => c.csv(r) })), `customers-${s.status}`);
    } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };

  return (
    <div className="bg-card border border-border">
      {/* Views */}
      <div className="flex items-end gap-1 px-3 border-b border-border overflow-x-auto" role="tablist" aria-label="Views">
        {VIEWS.map((v) => {
          const active = s.status === v.key;
          return (
            <button key={v.key} type="button" role="tab" aria-selected={active} onClick={() => s.setStatus(v.key)}
              className={cn("relative h-10 px-3 text-xs whitespace-nowrap inline-flex items-center gap-1.5 -mb-px border-b-2",
                active ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {v.label}
              <span className={cn("tabular-nums px-1.5 py-px text-[0.625rem] rounded-sm", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                {result ? (result.views[v.key] ?? 0).toLocaleString("en-IN") : "…"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Totals across the current view and filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border bg-muted/20">
        <Metric label="Customers" value={total.toLocaleString("en-IN")} />
        <Metric label="Live bookings" value={(result?.summary.activeBookings ?? 0).toLocaleString("en-IN")} />
        <Metric label="Received" value={fmt(result?.summary.totalPaid ?? 0)} />
        <Metric label="Outstanding" value={fmt(result?.summary.totalOutstanding ?? 0)} strong />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <div className="relative w-full sm:w-72">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={s.searchInput} onChange={(e) => s.setSearchInput(e.target.value)} aria-label="Search customers"
            placeholder="Search name, mobile, customer no."
            className="w-full h-8 pl-8 pr-7 text-xs border border-border focus:border-primary focus:ring-1 focus:ring-primary bg-card text-foreground outline-none" />
          {s.searchInput && (
            <button type="button" onClick={() => s.setSearchInput("")} aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"><X size={12} /></button>
          )}
        </div>
        <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
        {s.hasFilters && (
          <button type="button" onClick={s.reset} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw size={12} /> Clear
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {exportError && <span className="text-xs text-destructive">{exportError}</span>}
          <button type="button" className={BTN} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
          <SavedViews
            current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize }}
            onApply={(v) => { setPageSize(PAGE_SIZES.includes(v.pageSize as any) ? v.pageSize : PAGE_SIZES[0]); s.apply(v); }} />
          <ColumnChooser prefs={prefs} onChange={setPrefs} />
          <button type="button" className={BTN} onClick={runExport} disabled={exporting || total === 0}>
            <Download size={13} /> {exporting ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className={cn("overflow-auto max-h-[calc(100vh-22rem)] min-h-[16rem] transition-opacity", isFetching && result && "opacity-60")}>
        <table className="sheet-grid w-full text-xs border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
            <tr>
              <th scope="col" className={cn(TH, "w-10 text-right")}>#</th>
              {cols.map((c) => (
                <th key={c.id} scope="col" style={widthStyle(c.id)} className={cn(TH, "relative", c.align === "right" ? "text-right" : "text-left")}
                  aria-sort={c.sortKey && s.sort.key === c.sortKey ? (s.sort.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <SortHead col={c} sort={s.sort} onSort={s.toggleSort} />
                  <span role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} title="Drag to resize · double-click for automatic"
                    onMouseDown={(e) => startResize(e, c.id)} onDoubleClick={() => autoWidth(c.id)} onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && !result ? (
              Array.from({ length: 10 }).map((_, r) => (
                <tr key={r}>
                  <td className={TD} />
                  {cols.map((c, i) => <td key={c.id} className={TD}><div className="h-2.5 bg-muted animate-pulse" style={{ width: `${45 + ((r + i) % 4) * 12}%` }} /></td>)}
                </tr>
              ))
            ) : error ? (
              <tr><td colSpan={cols.length + 1} className="py-12 text-center text-sm text-destructive">
                {(error as Error).message} <button type="button" onClick={() => refetch()} className="underline ml-1">Retry</button>
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + 1} className="py-12 text-center text-sm text-muted-foreground">
                {s.hasFilters ? "No customer matches these filters." : "No customers in this view."}
              </td></tr>
            ) : rows.map((c, i) => (
              <tr key={c.Id} tabIndex={0} onClick={() => onOpen(c.Id)}
                onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.Id); }}
                className={cn("cursor-pointer even:bg-muted/20 hover:bg-primary/5 focus:outline-none focus-visible:bg-primary/10", c.Id === openId && "bg-primary/10")}>
                <td className={cn(TD, "text-right text-muted-foreground tabular-nums")}>{(s.page - 1) * pageSize + i + 1}</td>
                {cols.map((col) => (
                  <td key={col.id} style={widthStyle(col.id)} className={cn(TD, "whitespace-nowrap overflow-hidden text-ellipsis", col.align === "right" && "text-right")}>{col.cell(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <GridFooter page={s.page} pageSize={pageSize} total={total} onPage={s.setPage}
        onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
    </div>
  );
};

// ── Record page: small table used by every ledger / history list ─────────────
interface MiniCol<T> { header: string; cell: (row: T) => React.ReactNode; align?: "right" }
function MiniTable<T>({ cols, rows, rowKey, empty }: { cols: MiniCol<T>[]; rows: T[] | undefined; rowKey: (r: T) => string | number; empty: string }) {
  if (!rows || rows.length === 0) return <div className="text-xs text-muted-foreground px-3 py-3">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="sheet-grid w-full text-xs border-separate border-spacing-0">
        <thead>
          <tr>{cols.map((c) => <th key={c.header} scope="col" className={cn(TH, "h-7", c.align === "right" ? "text-right" : "text-left")}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="even:bg-muted/20 hover:bg-primary/5">
              {cols.map((c) => <td key={c.header} className={cn(TD, "h-8 whitespace-nowrap", c.align === "right" && "text-right")}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Card: React.FC<{ icon: React.ElementType; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }> = ({ icon: Icon, title, count, action, children }) => (
  <section className="bg-card border border-border">
    <header className="h-10 px-3 flex items-center gap-2 border-b border-border">
      <Icon size={14} className="text-muted-foreground" />
      <h3 className="text-[0.8125rem] font-semibold">{title}</h3>
      {count != null && <span className="text-[0.6875rem] tabular-nums px-1.5 bg-muted text-muted-foreground">{count}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </header>
    {children}
  </section>
);

const SubHead: React.FC<{ icon: React.ElementType; title: string; count?: number }> = ({ icon: Icon, title, count }) => (
  <div className="h-8 px-3 flex items-center gap-1.5 border-t border-border">
    <Icon size={12} className="text-muted-foreground" />
    <h4 className="text-xs font-semibold">{title}</h4>
    {count ? <span className="text-[0.6875rem] text-muted-foreground tabular-nums">({count})</span> : null}
  </div>
);

const Field: React.FC<{ l: string; v: React.ReactNode }> = ({ l, v }) => (
  <div className="min-w-0"><div className={LABEL}>{l}</div><div className="mt-0.5 text-xs truncate">{v}</div></div>
);

// ── Activity timeline ────────────────────────────────────────────────────────
const CustomerTimeline: React.FC<{ data: any }> = ({ data }) => {
  const [showAll, setShowAll] = useState(false);
  const events: any[] = [];
  (data.calls || []).forEach((c: any) => {
    if (c.CallTime) events.push({ id: `call-${c.Id}`, date: new Date(c.CallTime), type: "Call", title: c.Outcome, desc: c.Remarks, icon: Phone });
  });
  (data.serviceTickets || []).forEach((t: any) => {
    if (t.CreatedAt) events.push({ id: `ticket-${t.Id}`, date: new Date(t.CreatedAt), type: "Ticket", title: `[${t.TicketNo}] ${t.Category}`, desc: t.Subject, icon: Wrench });
  });
  (data.bookings || []).forEach((b: any) => {
    if (b.CreatedAt) events.push({ id: `bk-${b.Id}`, date: new Date(b.CreatedAt), type: "Booking", title: `Booking ${b.BookingNo}`, desc: `${b.ProjectName} · ${b.UnitNo}`, icon: Home });
    (b.receipts || []).forEach((r: any) => {
      if (r.ReceivedDate) events.push({ id: `rc-${r.Id}`, date: new Date(r.ReceivedDate), type: "Receipt", title: `Receipt ${r.ReceiptNo}`, desc: `${fmt(r.Amount)} via ${r.PaymentMode || "transfer"}`, icon: Receipt });
    });
    (b.invoices || []).forEach((i: any) => {
      if (i.InvoiceDate) events.push({ id: `inv-${i.Id}`, date: new Date(i.InvoiceDate), type: "Invoice", title: `Invoice ${i.InvoiceNo}`, desc: `${fmt(i.Amount)} for ${i.InvoiceType}`, icon: FileText });
    });
    if (b.HasCancellation > 0 && b.UpdatedAt) {
      events.push({ id: `cx-${b.Id}`, date: new Date(b.UpdatedAt), type: "Cancellation", title: "Booking cancelled", desc: `Booking ${b.BookingNo} cancelled`, icon: Wrench, red: true });
    }
  });
  events.sort((a, b) => b.date.getTime() - a.date.getTime());

  if (events.length === 0) return <div className="text-xs text-muted-foreground px-3 py-3">No activity yet.</div>;
  const LIMIT = 15;
  const shown = showAll ? events : events.slice(0, LIMIT);
  return (
    <div className="px-3 py-3">
      <ol className="relative ml-3 border-l border-border space-y-3.5">
        {shown.map((ev) => {
          const Icon = ev.icon;
          return (
            <li key={ev.id} className="relative pl-5">
              <span className={cn("absolute -left-3 top-0 flex h-6 w-6 items-center justify-center rounded-full border bg-card",
                ev.red ? "border-destructive text-destructive" : "border-border text-muted-foreground")}>
                <Icon size={11} />
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("text-xs font-medium truncate", ev.red && "text-destructive")}>{ev.title || ev.type}</span>
                <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0">{dt(ev.date)}</span>
              </div>
              <div className="text-[0.6875rem] text-muted-foreground">{ev.type}{ev.desc ? ` · ${ev.desc}` : ""}</div>
            </li>
          );
        })}
      </ol>
      {events.length > LIMIT && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-xs text-primary hover:underline">
          {showAll ? "Show fewer" : `Show all ${events.length}`}
        </button>
      )}
    </div>
  );
};

// ── One booking with its ledger ──────────────────────────────────────────────
const BookingLedger: React.FC<{ b: any; expanded: boolean; onToggle: () => void }> = ({ b, expanded, onToggle }) => {
  const navigate = useNavigate();
  const today = new Date();
  const milestones = b.milestones || [];
  const overdueCount = milestones.filter((m: any) => isOverdue(m, today)).length;
  const pendingCount = milestones.filter((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived").length;
  const ledgerCount = (b.receipts?.length || 0) + (b.invoices?.length || 0) + (b.onAccount?.length || 0) + (b.brokerage?.length || 0) + (b.creditNotes?.length || 0);

  return (
    <div className="border-b border-border last:border-0">
      {/* A <button> can't hold the nested Payments / Booking buttons, so the header is a div with the same keyboard behaviour wired on by hand. */}
      <div role="button" tabIndex={0} aria-expanded={expanded} onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="px-3 py-2.5 hover:bg-muted/40 cursor-pointer focus:outline-none focus-visible:bg-primary/5">
        <div className="flex items-center gap-2 flex-wrap">
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
          <span className="text-[0.8125rem] font-semibold">{b.ProjectName || "—"} · {b.UnitNo}</span>
          <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{b.BookingNo}{b.ApplicationNo ? ` · ${b.ApplicationNo}` : ""}</span>
          <StatusBadge status={b.Status} />
          {b.HasCancellation > 0 && <span className="text-[0.6875rem] font-semibold text-destructive">Cancellation pending</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/payments?bookingId=${b.Id}`); }} className={cn(BTN, "h-7")}>
              Payments <ExternalLink size={11} />
            </button>
            {/* Invoices are made on the booking's own Payment & Invoice tab: this links there. */}
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(b.Id || b.BookingId ? `/crm/bookings?view=${b.Id || b.BookingId}` : `/crm/bookings?applicationId=${b.ApplicationId}`); }} className={cn(BTN, "h-7")}>
              Open booking <ExternalLink size={11} />
            </button>
          </div>
        </div>
        <div className="mt-2.5 ml-6 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-x-4 gap-y-2">
          <Field l="Value" v={<span className={num}>{fmt(b.GrandTotal ?? b.TotalValue)}</span>} />
          <Field l="Received" v={<span className={num}>{fmt(b.TotalPaid)}</span>} />
          <Field l="Outstanding" v={<span className={cn(num, "font-semibold")}>{fmt(b.TotalOutstanding)}</span>} />
          <Field l="Booked on" v={<span className={num}>{dt(b.BookingDate)}</span>} />
          <Field l="Milestones" v={milestones.length ? (
            <span className={cn(num, overdueCount > 0 && "text-destructive font-semibold")}>
              {milestones.length - pendingCount}/{milestones.length} paid{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
            </span>) : "—"} />
          <Field l="Agreement" v={b.AgreementStatus || "—"} />
          <Field l="Legal" v={b.LegalMilestoneStatus || "—"} />
          <Field l="Pre-possession" v={b.PrePossessionStatus || "—"} />
          <Field l="Handover" v={b.HandoverStatus || "—"} />
          <Field l="NOC" v={b.NocTotalCount > 0 ? <span className={num}>{b.NocTotalCount - b.NocPendingCount}/{b.NocTotalCount} issued</span> : "—"} />
        </div>
        {!expanded && (
          <div className="mt-2 ml-6 text-[0.6875rem] text-muted-foreground">
            {ledgerCount > 0 ? `${ledgerCount} ledger record${ledgerCount === 1 ? "" : "s"}. Open to view.` : "No ledger records yet"}
          </div>
        )}
      </div>

      {expanded && (
        <div className="pb-1 bg-muted/10">
          <SubHead icon={CalendarClock} title="Payment milestones" count={milestones.length} />
          <MiniTable rows={milestones} rowKey={(m: any) => m.Id} empty="No payment plan on this booking" cols={[
            { header: "#", cell: (m: any) => <span className={cn(num, "text-muted-foreground")}>{m.MilestoneNo}</span> },
            { header: "Milestone", cell: (m: any) => m.MilestoneName },
            { header: "Due date", cell: (m: any) => <span className={num}>{dt(m.DueDate)}</span> },
            { header: "%", align: "right", cell: (m: any) => <span className={num}>{m.Percent != null ? `${m.Percent}%` : "—"}</span> },
            { header: "Amount", align: "right", cell: (m: any) => <span className={num}>{fmt(m.AmountDue)}</span> },
            { header: "Paid", align: "right", cell: (m: any) => <span className={num}>{fmt(m.AmountPaid)}</span> },
            { header: "Balance", align: "right", cell: (m: any) => { const bal = round2(Number(m.AmountDue || 0) - Number(m.AmountPaid || 0)); return <span className={cn(num, bal > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(bal)}</span>; } },
            { header: "Status", cell: (m: any) => isOverdue(m, today) ? <span className="text-destructive font-semibold">Overdue</span> : <StatusBadge status={m.Status} /> },
          ]} />

          <SubHead icon={Receipt} title="Payment receipts" count={b.receipts?.length} />
          <MiniTable rows={b.receipts} rowKey={(r: any) => r.Id} empty="No payments received yet" cols={[
            { header: "Receipt", cell: (r: any) => <span className={cn(num, "font-medium")}>{r.ReceiptNo}</span> },
            { header: "Date", cell: (r: any) => <span className={num}>{dt(r.ReceivedDate)}</span> },
            { header: "Against", cell: (r: any) => r.MilestoneName || "—" },
            { header: "Mode", cell: (r: any) => r.PaymentMode || "—" },
            { header: "Bank", cell: (r: any) => <span className="text-muted-foreground">{r.DepositBankName || "—"}</span> },
            { header: "Amount", align: "right", cell: (r: any) => <span className={cn(num, "font-semibold")}>{fmt(r.Amount)}</span> },
          ]} />

          <SubHead icon={FileText} title="Invoices" count={b.invoices?.length} />
          <MiniTable rows={b.invoices} rowKey={(i: any) => i.Id} empty="No invoices generated yet" cols={[
            { header: "Invoice", cell: (i: any) => <span className={cn(num, "font-medium")}>{i.InvoiceNo}</span> },
            { header: "Date", cell: (i: any) => <span className={num}>{dt(i.InvoiceDate)}</span> },
            { header: "Type", cell: (i: any) => i.InvoiceType || "—" },
            { header: "Raised by", cell: (i: any) => <span className="text-muted-foreground">{i.CreatedByName || "—"}</span> },
            { header: "Status", cell: (i: any) => i.Status ? <StatusBadge status={i.Status} /> : "—" },
            { header: "Amount", align: "right", cell: (i: any) => <span className={cn(num, "font-semibold")}>{fmt(i.Amount)}</span> },
          ]} />

          <SubHead icon={FileText} title="Credit notes" count={b.creditNotes?.length} />
          <MiniTable rows={b.creditNotes || []} rowKey={(n: any) => `cn-${n.Id}`} empty="No credit notes" cols={[
            { header: "Document", cell: (n: any) => <Link to={`/crm/credit-notes?id=${n.Id}`} className={cn(num, "font-medium text-primary hover:underline")}>{n.DocNo || (["Draft", "Pending", "Rejected"].includes(n.Status) ? "Awaiting approval" : "Certificate")}</Link> },
            { header: "Date", cell: (n: any) => <span className={num}>{dt(n.DocDate)}</span> },
            { header: "Kind", cell: (n: any) => n.Source === "Adjustment" ? `Invoice reduced${n.ReasonType ? ` · ${n.ReasonType}` : ""}` : n.DocType === "CreditNote" ? "Refund · on invoice" : "Refund · on advance" },
            { header: "Status", cell: (n: any) => <span className={cn("text-muted-foreground", n.Status === "Cancelled" && "line-through")}>{n.Status}{n.AgainstRef ? ` · ${n.AgainstRef}` : ""}</span> },
            { header: "Amount", align: "right", cell: (n: any) => <span className={cn(num, "font-semibold")}>{fmt(n.TotalAmount)}</span> },
          ]} />

          <SubHead icon={Wallet} title="On-account deposits" count={b.onAccount?.length} />
          <MiniTable rows={b.onAccount} rowKey={(oa: any) => oa.Id} empty="No on-account deposits" cols={[
            { header: "Receipt", cell: (oa: any) => <span className={cn(num, "font-medium")}>{oa.ReceiptNo}</span> },
            { header: "Date", cell: (oa: any) => <span className={num}>{dt(oa.ReceivedDate)}</span> },
            { header: "Bank", cell: (oa: any) => <span className="text-muted-foreground">{oa.DepositBankName || "—"}</span> },
            { header: "Deposited", align: "right", cell: (oa: any) => <span className={num}>{fmt(oa.Amount)}</span> },
            { header: "Applied", align: "right", cell: (oa: any) => <span className={num}>{fmt(oa.AppliedAmount)}</span> },
            { header: "Balance", align: "right", cell: (oa: any) => { const bal = round2(Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0)); return <span className={cn(num, bal > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(bal)}</span>; } },
          ]} />

          <SubHead icon={Users2} title="Broker settlement" count={b.brokerage?.length} />
          <MiniTable rows={b.brokerage} rowKey={(br: any) => br.Id} empty="No broker recorded for this booking" cols={[
            { header: "Broker", cell: (br: any) => <span>{br.BrokerName}{br.BrokerFirm ? <span className="text-muted-foreground"> ({br.BrokerFirm})</span> : null}</span> },
            { header: "Rate", cell: (br: any) => <span className={num}>{br.RateType === "Percentage" ? `${br.RateValue}%` : fmt(br.RateValue)}</span> },
            { header: "Status", cell: (br: any) => <StatusBadge status={br.Status} /> },
            { header: "Brokerage", align: "right", cell: (br: any) => <span className={num}>{fmt(br.ComputedAmount)}</span> },
            { header: "Paid", align: "right", cell: (br: any) => <span className={num}>{fmt(br.TotalPaid)}</span> },
            { header: "Due", align: "right", cell: (br: any) => { const bal = Math.max(0, round2(Number(br.ComputedAmount || 0) - Number(br.TotalPaid || 0))); return <span className={cn(num, bal > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(bal)}</span>; } },
          ]} />
        </div>
      )}
    </div>
  );
};

// ── Record page ──────────────────────────────────────────────────────────────
const RECORD_TABS = ["ledger", "applications", "leads", "service"] as const;
type TabKey = typeof RECORD_TABS[number];

const CustomerDetail: React.FC<{ customerId: number }> = ({ customerId }) => {
  // The open tab lives in the address (?tab=) too, so a shared link opens on the same tab.
  const [tab, setTab] = useUrlParam<TabKey>("tab", "ledger", RECORD_TABS);
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(null);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-customer-360", customerId],
    queryFn: () => fetchCustomer360(customerId),
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading) return <div className="bg-card border border-border py-16 text-center text-muted-foreground text-sm">Loading…</div>;
  if (isError || !data) return <div className="bg-card border border-border py-16 text-center text-destructive text-sm">{(error as Error)?.message || "Could not load this customer's ledger"}</div>;

  const c = data.customer || {};
  const place = [c.City, c.State, c.Pincode].filter(Boolean).join(", ");
  const bookings: any[] = data.bookings || [];
  const sm = data.summary || {};
  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "ledger", label: "Bookings & ledger", count: bookings.length },
    { key: "applications", label: "Applications", count: data.applications?.length ?? 0 },
    { key: "leads", label: "Lead history", count: data.leads?.length ?? 0 },
    { key: "service", label: "Service & calls", count: (data.serviceTickets?.length ?? 0) + (data.calls?.length ?? 0) },
  ];

  return (
    <div className="space-y-4">
      {/* Highlights */}
      <section className="bg-card border border-border">
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
            {(c.CustomerName || "?").trim().split(/\s+/).slice(0, 2).map((w: string) => w[0]).join("").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-lg font-semibold leading-tight">{c.CustomerName}</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{c.CustomerNo}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              {[c.Mobile, c.AltMobile].filter(Boolean).length > 0 && <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone size={11} />{[c.Mobile, c.AltMobile].filter(Boolean).join(" / ")}</span>}
              {c.Email && <span className="inline-flex items-center gap-1.5"><Mail size={11} />{c.Email}</span>}
              {(c.Address || place) && <span className="inline-flex items-center gap-1.5"><MapPin size={11} />{[c.Address, place].filter(Boolean).join(", ")}</span>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 divide-x divide-border border-t border-border bg-muted/20">
          <Metric label="Total invoiced" value={fmt(sm.totalInvoiced)} />
          <Metric label="Received" value={fmt(sm.totalPaid)} />
          <Metric label="Outstanding" value={fmt(sm.totalOutstanding)} strong />
          <Metric label="On-account balance" value={fmt(sm.totalOnAccountBalance)} />
          <Metric label="Brokerage paid" value={fmt(sm.totalBrokeragePaid)} />
          <Metric label="Brokerage due" value={fmt(sm.totalBrokerageDue)} />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] items-start">
        <section className="bg-card border border-border min-w-0">
          <div className="flex items-end gap-1 px-3 border-b border-border overflow-x-auto" role="tablist" aria-label="Customer record">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={cn("h-10 px-3 text-xs whitespace-nowrap inline-flex items-center gap-1.5 -mb-px border-b-2",
                  tab === t.key ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}<span className="tabular-nums px-1.5 text-[0.625rem] bg-muted text-muted-foreground">{t.count}</span>
              </button>
            ))}
            {tab === "ledger" && bookings.length > 1 && (
              <button type="button" onClick={() => setExpandedBookingId(null)} className="ml-auto h-10 px-2 text-[0.6875rem] text-muted-foreground hover:text-foreground">Collapse all</button>
            )}
          </div>

          {tab === "ledger" && (bookings.length === 0
            ? <div className="text-xs text-muted-foreground px-3 py-6 text-center">No bookings yet.</div>
            : bookings.map((b) => (
              <BookingLedger key={b.Id} b={b} expanded={expandedBookingId === b.Id || bookings.length === 1}
                onToggle={() => setExpandedBookingId((cur) => (cur === b.Id ? null : b.Id))} />
            )))}

          {tab === "applications" && (
            <MiniTable rows={data.applications} rowKey={(a: any) => a.Id} empty="No applications." cols={[
              { header: "Application", cell: (a: any) => <Link to={`/crm/applications?id=${a.Id}`} className={cn(num, "font-medium text-primary hover:underline")}>{a.ApplicationNo}</Link> },
              { header: "Project", cell: (a: any) => a.InterestedProject || "—" },
              { header: "Property", cell: (a: any) => [a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ") || "—" },
              { header: "Assigned to", cell: (a: any) => a.AssigneeName || "—" },
              { header: "Created", cell: (a: any) => <span className={num}>{dt(a.CreatedAt)}</span> },
              { header: "Status", cell: (a: any) => <StatusBadge status={a.Status} /> },
            ]} />
          )}

          {tab === "leads" && (
            <MiniTable rows={data.leads} rowKey={(l: any) => l.Id} empty="No lead history." cols={[
              { header: "Lead", cell: (l: any) => <span className={cn(num, "font-medium")}>{l.LeadUid}</span> },
              { header: "Source", cell: (l: any) => l.SourceType || "—" },
              { header: "Classification", cell: (l: any) => l.Classification || "—" },
              { header: "Created", cell: (l: any) => <span className={num}>{dt(l.CreatedAt)}</span> },
              { header: "Status", cell: (l: any) => <StatusBadge status={l.Status} /> },
            ]} />
          )}

          {tab === "service" && (
            <>
              <SubHead icon={Wrench} title="Service tickets" count={data.serviceTickets?.length} />
              <MiniTable rows={data.serviceTickets} rowKey={(t: any) => t.Id} empty="No service tickets." cols={[
                { header: "Ticket", cell: (t: any) => <span className={cn(num, "font-medium")}>{t.TicketNo}</span> },
                { header: "Category", cell: (t: any) => t.Category || "—" },
                { header: "Subject", cell: (t: any) => <span className="truncate block max-w-[20rem]">{t.Subject}</span> },
                { header: "Priority", cell: (t: any) => t.Priority || "—" },
                { header: "Raised", cell: (t: any) => <span className={num}>{dt(t.CreatedAt)}</span> },
                { header: "Status", cell: (t: any) => <StatusBadge status={t.Status} /> },
              ]} />
              <SubHead icon={MessageSquare} title="Calls" count={data.calls?.length} />
              <MiniTable rows={data.calls} rowKey={(call: any) => call.Id} empty="No calls logged." cols={[
                { header: "When", cell: (call: any) => <span className={num}>{call.CallTime ? new Date(call.CallTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span> },
                { header: "Outcome", cell: (call: any) => call.Outcome || "—" },
                { header: "Classification", cell: (call: any) => call.Classification || "—" },
                { header: "Remarks", cell: (call: any) => <span className="truncate block max-w-[24rem] text-muted-foreground" title={call.Remarks || ""}>{call.Remarks || "—"}</span> },
              ]} />
            </>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <Card icon={Activity} title="Activity">
            <CustomerTimeline data={data} />
          </Card>
        </aside>
      </div>
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
const CrmCustomer360: React.FC = () => {
  usePageRights("crm-customer-360");
  // The open customer lives in the address (?id=), so a refresh or a shared link lands on them.
  const [idParam, setIdParam] = useUrlParam("id");
  const [, setTabParam] = useUrlParam("tab");
  const selectedCustomerId = Number(idParam) > 0 ? Number(idParam) : null;
  const [nav, setNav] = useState<RecordNav | null>(null);
  const openCustomer = useCallback((id: number) => setIdParam(String(id)), [setIdParam]);
  const backToList = () => { setIdParam(""); setTabParam(""); };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Customer 360"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Customer 360"
        subtitle="Every customer's journey, lead to after-sales, with their whole ledger: milestones, receipts, invoices, credit notes, on-account deposits and broker settlement."
        action={selectedCustomerId != null ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={backToList} className={cn(BTN, "h-9 px-3")}><ArrowLeft size={13} /> All customers</button>
            {nav && (
              <div className="inline-flex items-center border border-border bg-card h-9">
                <button type="button" onClick={() => nav.prev?.()} disabled={!nav.prev} aria-label="Previous customer" title="Previous customer"
                  className="h-full px-2 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={14} /></button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground border-x border-border h-full inline-flex items-center">
                  {nav.position.toLocaleString("en-IN")} of {nav.total.toLocaleString("en-IN")}
                </span>
                <button type="button" onClick={() => nav.next?.()} disabled={!nav.next} aria-label="Next customer" title="Next customer"
                  className="h-full px-2 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={14} /></button>
              </div>
            )}
          </div>
        ) : undefined}
      >
        {/* The list stays mounted while a customer is open, so its view, search, filters, sort and page survive the round
            trip, and it drives Prev / Next. */}
        <div hidden={selectedCustomerId != null}><CustomerList openId={selectedCustomerId} onOpen={openCustomer} onNav={setNav} /></div>
        {selectedCustomerId != null && <CustomerDetail key={selectedCustomerId} customerId={selectedCustomerId} />}
      </SheetShell>
    </>
  );
};

export default CrmCustomer360;
