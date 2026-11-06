import { CrmStatus } from "@/constants/crmStatuses";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import {
  Phone, FileText, Home, MessageSquare, Wrench, ArrowLeft, RotateCcw, RefreshCw, Download,
  Receipt, Wallet, Users2, ChevronDown, ChevronRight, ChevronLeft, Mail, MapPin, CalendarClock, ExternalLink, Activity,
} from "lucide-react";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser,
 GridHighlights, GridMetric, GridRelated, GridStatusPill, gridListMeta, GridMiniTable, GridSavedViews, GridSearch, GridTabs, exportGrid, gridVisibleCols, useGridPrefs,
  GRID_BTN, GRID_CARD, GRID_LABEL, GRID_PAGE_SIZES, type GridCol,
} from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { round2 } from "@/lib/crmPriceQuote";
import { MONEY_STAGE, isOverdue } from "./payments/config";

const API = "/api/crm/customer-360";
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

// ── Customer list columns (also the Excel export's columns) ───────────────────
const GRID_COLS: GridCol<CustomerRow>[] = [
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

// ── Customer list ────────────────────────────────────────────────────────────
/** Prev / Next for the open customer, through the list as it is filtered and sorted (across pages). */
interface RecordNav { position: number; total: number; prev: (() => void) | null; next: (() => void) | null }

const CustomerList: React.FC<{ openId: number | null; onOpen: (id: number) => void; onNav: (nav: RecordNav | null) => void }> = ({ openId, onOpen, onNav }) => {
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: "all" });
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, GRID_COLS);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Ticked rows, kept across pages and filters until cleared.
  const [selected, setSelected] = useState<Map<string | number, CustomerRow>>(new Map());
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-customer-360-list", s.query],
    queryFn: () => fetchCustomerList(s.query),
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;

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

  const runExport = async () => {
    setExporting(true); setExportError(null);
    try {
      exportGrid(await fetchAllCustomers(s.query), gridVisibleCols(GRID_COLS, prefs), `customers-${s.status}`);
    } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };
  const exportSelected = () => exportGrid([...selected.values()], gridVisibleCols(GRID_COLS, prefs), `customers-selected-${selected.size}`);

  return (
    <div className={cn(GRID_CARD, "overflow-hidden")}>
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-base font-bold leading-tight">{VIEWS.find((v) => v.key === s.status)?.label ?? "All customers"}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{gridListMeta(total, GRID_COLS, s.sort, s.hasFilters)}</p>
      </div>
      <GridTabs label="Views" active={s.status as ViewKey} onChange={s.setStatus}
        tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, count: result ? result.views[v.key] ?? 0 : null }))} />

      {/* Totals across the current view and filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
        <GridMetric label="Customers" value={total.toLocaleString("en-IN")} />
        <GridMetric label="Live bookings" value={(result?.summary.activeBookings ?? 0).toLocaleString("en-IN")} />
        <GridMetric label="Received" value={fmt(result?.summary.totalPaid ?? 0)} />
        <GridMetric label="Outstanding" value={fmt(result?.summary.totalOutstanding ?? 0)} strong />
      </div>

      {selected.size > 0 && (
        <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
          <button type="button" className={GRID_BTN} onClick={exportSelected}><Download size={13} /> Export selected</button>
        </GridBulkBar>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
        <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search name, mobile, customer no." />
        <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
        {s.hasFilters && (
          <button type="button" onClick={s.reset} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-primary hover:underline">
            <RotateCcw size={12} /> Clear filters
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {exportError && <span className="text-xs text-destructive">{exportError}</span>}
          <button type="button" className={cn(GRID_BTN, "w-9 px-0")} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          </button>
          <GridSavedViews storageKey={VIEWS_KEY}
            current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize }}
            onApply={(v) => { setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]); s.apply(v); }} />
          <GridColumnChooser cols={GRID_COLS} prefs={prefs} onChange={setPrefs} />
          <button type="button" className={GRID_BTN} onClick={runExport} disabled={exporting || total === 0} title="Export to Excel">
            <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
          </button>
        </div>
      </div>

      <CrmGrid cols={GRID_COLS} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(c) => c.Id}
        loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
        sort={s.sort} onSort={s.toggleSort} onRowClick={(c) => onOpen(c.Id)} activeKey={openId}
        selected={selected} onSelect={setSelected}
        empty={s.hasFilters ? "No customer matches these filters." : "No customers in this view."}
        page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
    </div>
  );
};

const SubHead: React.FC<{ icon: React.ElementType; title: string; count?: number }> = ({ icon: Icon, title, count }) => (
  <div className="h-8 px-3 flex items-center gap-1.5 border-t border-border">
    <Icon size={12} className="text-muted-foreground" />
    <h4 className="text-xs font-semibold">{title}</h4>
    {count ? <span className="text-[0.6875rem] text-muted-foreground tabular-nums">({count})</span> : null}
  </div>
);

const Field: React.FC<{ l: string; v: React.ReactNode }> = ({ l, v }) => (
  <div className="min-w-0"><div className={GRID_LABEL}>{l}</div><div className="mt-0.5 text-xs truncate">{v}</div></div>
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
  const milestones = b.milestones || [];
  const coveredCount = milestones.filter((m: any) => m.MoneyStage === "Verified").length;
  const overdueCount = milestones.filter((m: any) => isOverdue(m)).length;
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
          <GridStatusPill status={b.Status} />
          {b.HasCancellation > 0 && <span className="text-[0.6875rem] font-semibold text-destructive">Cancellation pending</span>}
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/payments?bookingId=${b.Id}`); }} className={cn(GRID_BTN, "h-7")}>
              Payments <ExternalLink size={11} />
            </button>
            {/* Invoices are made on the booking's own Payment & Invoice tab: this links there. */}
            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(b.Id || b.BookingId ? `/crm/bookings?view=${b.Id || b.BookingId}` : `/crm/bookings?applicationId=${b.ApplicationId}`); }} className={cn(GRID_BTN, "h-7")}>
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
              {milestones.length - pendingCount}/{milestones.length} paid{coveredCount > 0 ? ` · ${coveredCount} ${MONEY_STAGE.Verified.label.toLowerCase()}` : ""}{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
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
          <GridMiniTable rows={milestones} rowKey={(m: any) => m.Id} empty="No payment plan on this booking" cols={[
            { header: "#", cell: (m: any) => <span className={cn(num, "text-muted-foreground")}>{m.MilestoneNo}</span> },
            { header: "Milestone", cell: (m: any) => m.MilestoneName },
            { header: "Due date", cell: (m: any) => <span className={num}>{dt(m.DueDate)}</span> },
            { header: "%", align: "right", cell: (m: any) => <span className={num}>{m.Percent != null ? `${m.Percent}%` : "—"}</span> },
            { header: "Amount", align: "right", cell: (m: any) => <span className={num}>{fmt(m.AmountDue)}</span> },
            // Paid = settled on the milestone; money held On Account against it (in milestone order) is shown under it,
            // so what the customer has paid is visible while it is held. The balance counts both.
            { header: "Paid", align: "right", cell: (m: any) => (
              <span className="inline-flex flex-col items-end leading-tight">
                <span className={num}>{fmt(m.AmountPaid)}</span>
                {Number(m.HeldOnAccount) > 0 && <span className={cn(num, "text-[0.6875rem] text-emerald-700 dark:text-emerald-300")} title={MONEY_STAGE.Verified.hint}>+{fmt(m.HeldOnAccount)} on account</span>}
              </span>
            ) },
            { header: "Balance", align: "right", cell: (m: any) => { const bal = Math.max(0, round2(Number(m.AmountDue || 0) - Number(m.AmountPaid || 0) - Number(m.HeldOnAccount || 0))); return <span className={cn(num, bal > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(bal)}</span>; } },
            { header: "Status", cell: (m: any) => {
              const stage = MONEY_STAGE[m.MoneyStage as string];
              if (stage) return <span title={stage.hint}><GridStatusPill status={stage.label} /></span>;
              if (isOverdue(m)) return <span className="text-destructive font-semibold">Overdue{Number(m.HeldOnAccount) > 0 ? " · part held" : ""}</span>;
              return <GridStatusPill status={m.Status} />;
            } },
          ]} />

          <SubHead icon={Receipt} title="Payment receipts" count={b.receipts?.length} />
          <GridMiniTable rows={b.receipts} rowKey={(r: any) => r.Id} empty="No payments received yet" cols={[
            { header: "Receipt", cell: (r: any) => <span className={cn(num, "font-medium")}>{r.ReceiptNo}</span> },
            { header: "Date", cell: (r: any) => <span className={num}>{dt(r.ReceivedDate)}</span> },
            { header: "Against", cell: (r: any) => r.MilestoneName || "—" },
            { header: "Mode", cell: (r: any) => r.PaymentMode || "—" },
            { header: "Bank", cell: (r: any) => <span className="text-muted-foreground">{r.DepositBankName || "—"}</span> },
            { header: "Amount", align: "right", cell: (r: any) => <span className={cn(num, "font-semibold")}>{fmt(r.Amount)}</span> },
          ]} />

          <SubHead icon={FileText} title="Invoices" count={b.invoices?.length} />
          <GridMiniTable rows={b.invoices} rowKey={(i: any) => i.Id} empty="No invoices generated yet" cols={[
            { header: "Invoice", cell: (i: any) => <span className={cn(num, "font-medium")}>{i.InvoiceNo}</span> },
            { header: "Date", cell: (i: any) => <span className={num}>{dt(i.InvoiceDate)}</span> },
            { header: "Type", cell: (i: any) => i.InvoiceType || "—" },
            { header: "Raised by", cell: (i: any) => <span className="text-muted-foreground">{i.CreatedByName || "—"}</span> },
            { header: "Status", cell: (i: any) => i.Status ? <GridStatusPill status={i.Status} /> : "—" },
            { header: "Amount", align: "right", cell: (i: any) => <span className={cn(num, "font-semibold")}>{fmt(i.Amount)}</span> },
          ]} />

          <SubHead icon={FileText} title="Credit notes" count={b.creditNotes?.length} />
          <GridMiniTable rows={b.creditNotes || []} rowKey={(n: any) => `cn-${n.Id}`} empty="No credit notes" cols={[
            { header: "Document", cell: (n: any) => <Link to={`/crm/credit-notes?id=${n.Id}`} className={cn(num, "font-medium text-primary hover:underline")}>{n.DocNo || (["Draft", "Pending", "Rejected"].includes(n.Status) ? "Awaiting approval" : "Certificate")}</Link> },
            { header: "Date", cell: (n: any) => <span className={num}>{dt(n.DocDate)}</span> },
            { header: "Kind", cell: (n: any) => n.Source === "Adjustment" ? `Invoice reduced${n.ReasonType ? ` · ${n.ReasonType}` : ""}` : n.DocType === "CreditNote" ? "Refund · on invoice" : "Refund · on advance" },
            { header: "Status", cell: (n: any) => <span className={cn("text-muted-foreground", n.Status === "Cancelled" && "line-through")}>{n.Status}{n.AgainstRef ? ` · ${n.AgainstRef}` : ""}</span> },
            { header: "Amount", align: "right", cell: (n: any) => <span className={cn(num, "font-semibold")}>{fmt(n.TotalAmount)}</span> },
          ]} />

          <SubHead icon={Wallet} title="On-account deposits" count={b.onAccount?.length} />
          <GridMiniTable rows={b.onAccount} rowKey={(oa: any) => oa.Id} empty="No on-account deposits" cols={[
            { header: "Receipt", cell: (oa: any) => <span className={cn(num, "font-medium")}>{oa.ReceiptNo}</span> },
            { header: "Date", cell: (oa: any) => <span className={num}>{dt(oa.ReceivedDate)}</span> },
            { header: "Bank", cell: (oa: any) => <span className="text-muted-foreground">{oa.DepositBankName || "—"}</span> },
            { header: "Deposited", align: "right", cell: (oa: any) => <span className={num}>{fmt(oa.Amount)}</span> },
            { header: "Applied", align: "right", cell: (oa: any) => <span className={num}>{fmt(oa.AppliedAmount)}</span> },
            { header: "Balance", align: "right", cell: (oa: any) => { const bal = round2(Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0)); return <span className={cn(num, bal > 0 ? "font-semibold" : "text-muted-foreground")}>{fmt(bal)}</span>; } },
          ]} />

          <SubHead icon={Users2} title="Broker settlement" count={b.brokerage?.length} />
          <GridMiniTable rows={b.brokerage} rowKey={(br: any) => br.Id} empty="No broker recorded for this booking" cols={[
            { header: "Broker", cell: (br: any) => <span>{br.BrokerName}{br.BrokerFirm ? <span className="text-muted-foreground"> ({br.BrokerFirm})</span> : null}</span> },
            { header: "Rate", cell: (br: any) => <span className={num}>{br.RateType === "Percentage" ? `${br.RateValue}%` : fmt(br.RateValue)}</span> },
            { header: "Status", cell: (br: any) => <GridStatusPill status={br.Status} /> },
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

  if (isLoading) return <div className={cn(GRID_CARD, "py-16 text-center text-muted-foreground text-sm")}>Loading…</div>;
  if (isError || !data) return <div className={cn(GRID_CARD, "py-16 text-center text-destructive text-sm")}>{(error as Error)?.message || "Could not load this customer's ledger"}</div>;

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
      <GridHighlights icon={Users2} object={`Customer · ${c.CustomerNo || "—"}`} title={c.CustomerName}
        sub={<span className="inline-flex flex-wrap gap-x-4 gap-y-1">
          {[c.Mobile, c.AltMobile].filter(Boolean).length > 0 && <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone size={11} />{[c.Mobile, c.AltMobile].filter(Boolean).join(" / ")}</span>}
          {c.Email && <span className="inline-flex items-center gap-1.5"><Mail size={11} />{c.Email}</span>}
          {(c.Address || place) && <span className="inline-flex items-center gap-1.5"><MapPin size={11} />{[c.Address, place].filter(Boolean).join(", ")}</span>}
        </span>}
        fields={[
          { label: "Total invoiced", value: fmt(sm.totalInvoiced) },
          { label: "Received", value: fmt(sm.totalPaid) },
          { label: "Outstanding", value: <span className="font-bold">{fmt(sm.totalOutstanding)}</span> },
          { label: "On-account balance", value: fmt(sm.totalOnAccountBalance) },
          { label: "Brokerage paid", value: fmt(sm.totalBrokeragePaid) },
          { label: "Brokerage due", value: fmt(sm.totalBrokerageDue) },
        ]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] items-start">
        <section className={cn(GRID_CARD, "overflow-hidden min-w-0")}>
          <GridTabs label="Customer record" tabs={tabs} active={tab} onChange={setTab}
            end={tab === "ledger" && bookings.length > 1 ? (
              <button type="button" onClick={() => setExpandedBookingId(null)} className="h-10 px-2 text-[0.6875rem] text-muted-foreground hover:text-foreground">Collapse all</button>
            ) : undefined} />

          {tab === "ledger" && (bookings.length === 0
            ? <div className="text-xs text-muted-foreground px-3 py-6 text-center">No bookings yet.</div>
            : bookings.map((b) => (
              <BookingLedger key={b.Id} b={b} expanded={expandedBookingId === b.Id || bookings.length === 1}
                onToggle={() => setExpandedBookingId((cur) => (cur === b.Id ? null : b.Id))} />
            )))}

          {tab === "applications" && (
            <GridMiniTable rows={data.applications} rowKey={(a: any) => a.Id} empty="No applications." cols={[
              { header: "Application", cell: (a: any) => <Link to={`/crm/applications?id=${a.Id}`} className={cn(num, "font-medium text-primary hover:underline")}>{a.ApplicationNo}</Link> },
              { header: "Project", cell: (a: any) => a.InterestedProject || "—" },
              { header: "Property", cell: (a: any) => [a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ") || "—" },
              { header: "Assigned to", cell: (a: any) => a.AssigneeName || "—" },
              { header: "Created", cell: (a: any) => <span className={num}>{dt(a.CreatedAt)}</span> },
              { header: "Status", cell: (a: any) => <GridStatusPill status={a.Status} /> },
            ]} />
          )}

          {tab === "leads" && (
            <GridMiniTable rows={data.leads} rowKey={(l: any) => l.Id} empty="No lead history." cols={[
              { header: "Lead", cell: (l: any) => <span className={cn(num, "font-medium")}>{l.LeadUid}</span> },
              { header: "Source", cell: (l: any) => l.SourceType || "—" },
              { header: "Classification", cell: (l: any) => l.Classification || "—" },
              { header: "Created", cell: (l: any) => <span className={num}>{dt(l.CreatedAt)}</span> },
              { header: "Status", cell: (l: any) => <GridStatusPill status={l.Status} /> },
            ]} />
          )}

          {tab === "service" && (
            <>
              <SubHead icon={Wrench} title="Service tickets" count={data.serviceTickets?.length} />
              <GridMiniTable rows={data.serviceTickets} rowKey={(t: any) => t.Id} empty="No service tickets." cols={[
                { header: "Ticket", cell: (t: any) => <span className={cn(num, "font-medium")}>{t.TicketNo}</span> },
                { header: "Category", cell: (t: any) => t.Category || "—" },
                { header: "Subject", cell: (t: any) => <span className="truncate block max-w-[20rem]">{t.Subject}</span> },
                { header: "Priority", cell: (t: any) => t.Priority || "—" },
                { header: "Raised", cell: (t: any) => <span className={num}>{dt(t.CreatedAt)}</span> },
                { header: "Status", cell: (t: any) => <GridStatusPill status={t.Status} /> },
              ]} />
              <SubHead icon={MessageSquare} title="Calls" count={data.calls?.length} />
              <GridMiniTable rows={data.calls} rowKey={(call: any) => call.Id} empty="No calls logged." cols={[
                { header: "When", cell: (call: any) => <span className={num}>{call.CallTime ? new Date(call.CallTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span> },
                { header: "Outcome", cell: (call: any) => call.Outcome || "—" },
                { header: "Classification", cell: (call: any) => call.Classification || "—" },
                { header: "Remarks", cell: (call: any) => <span className="truncate block max-w-[24rem] text-muted-foreground" title={call.Remarks || ""}>{call.Remarks || "—"}</span> },
              ]} />
            </>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-4">
          <GridRelated icon={Activity} title="Activity">
            <CustomerTimeline data={data} />
          </GridRelated>
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
      <Breadcrumbs items={selectedCustomerId != null ? ["Dashboard", "CRM", "Customer 360", "Record"] : ["Dashboard", "CRM", "Customer 360"]} />
      <CrmAppPage icon={Users2} section="CRM · After-sales" title="Customer 360"
        subtitle={selectedCustomerId != null ? undefined : "Every customer's journey, lead to after-sales, with their whole ledger: milestones, receipts, invoices, credit notes, on-account deposits and broker settlement."}
        actions={selectedCustomerId != null ? (
          <>
            <button type="button" onClick={backToList} className={GRID_BTN}><ArrowLeft size={13} /> All customers</button>
            {nav && (
              <div className="inline-flex items-center rounded-md border border-border bg-card h-8 overflow-hidden">
                <button type="button" onClick={() => nav.prev?.()} disabled={!nav.prev} aria-label="Previous customer" title="Previous customer"
                  className="h-full px-2 text-primary hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={14} /></button>
                <span className="px-2 text-xs tabular-nums text-muted-foreground border-x border-border h-full inline-flex items-center">
                  {nav.position.toLocaleString("en-IN")} of {nav.total.toLocaleString("en-IN")}
                </span>
                <button type="button" onClick={() => nav.next?.()} disabled={!nav.next} aria-label="Next customer" title="Next customer"
                  className="h-full px-2 text-primary hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={14} /></button>
              </div>
            )}
          </>
        ) : undefined}
      >
        {/* The list stays mounted while a customer is open, so its view, search, filters, sort and page survive the round
            trip, and it drives Prev / Next. */}
        <div hidden={selectedCustomerId != null}><CustomerList openId={selectedCustomerId} onOpen={openCustomer} onNav={setNav} /></div>
        {selectedCustomerId != null && <CustomerDetail key={selectedCustomerId} customerId={selectedCustomerId} />}
      </CrmAppPage>
    </>
  );
};

export default CrmCustomer360;
