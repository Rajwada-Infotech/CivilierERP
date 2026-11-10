import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { cn } from "@/lib/utils";
import { translateError } from "@/lib/translateError";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridColumnChooser, GridDateFilter, GridMiniTable, GridSavedViews, GridSearch, GridTabs,
  resolveGridDateRange, useGridPrefs, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, type CrmSort } from "@/hooks/useCrmListState";
import { useUrlParam } from "@/hooks/useUrlParam";
import { FileDown, Plus, RefreshCw } from "lucide-react";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { API, DeadlineNote, KIND, NoteMark, REQ_LABEL, TABS, day, getJson, inr, kindOf, type KindCounts, type Tab } from "./creditNotes/config";
import { NewCreditNoteDialog } from "./creditNotes/NewCreditNoteDialog";
import { DetailDialog } from "./creditNotes/DetailDialog";
import { exportCreditNotesXlsx } from "./creditNotes/exportXlsx";

const PREFS_KEY = "crm-credit-notes-cols-v1";
const VIEWS_KEY = "crm-credit-notes-views";
const DEFAULT_SORT: CrmSort = { key: "", dir: "desc" };
const THIS_FY: GridDateRange = { preset: "fy", from: "", to: "" };
const dash = <span className="text-muted-foreground">—</span>;
const struck = (n: any) => kindOf(n) === "cancelled";

const NOTE_COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "CustomerName", csv: (n) => n.CustomerName, cell: (n) => (
    <span className="flex items-center gap-3 py-1.5 min-w-0">
      <Initials name={n.CustomerName} />
      <span className="min-w-0">
        <span className={cn("block font-semibold capitalize truncate", struck(n) ? "text-muted-foreground" : "text-foreground")} title={n.CustomerName}>{asName(n.CustomerName) || "—"}</span>
        <span className="block text-xs text-muted-foreground tabular-nums truncate">{n.BookingNo} · {n.Property}{n.ProjectName ? ` · ${n.ProjectName}` : ""}</span>
      </span>
    </span>
  ) },
  { id: "doc", label: "Document", sortKey: "DocDate", csv: (n) => n.DocNo, cell: (n) => {
    const kind = kindOf(n);
    return (
      <span className="inline-flex flex-col leading-tight">
        <span className={cn("tabular-nums font-semibold", struck(n) ? "line-through text-muted-foreground" : "text-foreground")}>{n.DocNo || (kind === "request" ? REQ_LABEL[n.Status] : "Certificate")}</span>
        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{day(n.DocDate)} · {KIND[kind].short}</span>
      </span>
    );
  } },
  { id: "against", label: "Against", sortKey: "AgainstRef", csv: (n) => n.AgainstRef || n.RefundNo, cell: (n) => (
    <span className="inline-flex flex-col leading-tight min-w-0">
      <span className="tabular-nums truncate max-w-[11rem]" title={n.AgainstRef || n.RefundNo}>{n.AgainstRef || n.RefundNo || "—"}</span>
      {n.AgainstDate && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{day(n.AgainstDate)}</span>}
    </span>
  ) },
  { id: "taxable", label: "Taxable value", align: "right", sortKey: "TaxableValue", csv: (n) => n.TaxableValue, cell: (n) => <span className="tabular-nums">{inr(n.TaxableValue)}</span> },
  { id: "gst", label: "GST", align: "right", sortKey: "GstAmount", csv: (n) => n.GstAmount, cell: (n) => (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="tabular-nums">{inr(n.GstAmount)}</span>
      {n.GstRate != null && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{Number(n.GstRate)}%</span>}
    </span>
  ) },
  { id: "total", label: "Amount", align: "right", sortKey: "TotalAmount", csv: (n) => n.TotalAmount, cell: (n) => <span className={cn("tabular-nums font-semibold", struck(n) && "line-through font-normal text-muted-foreground")}>{inr(n.TotalAmount)}</span> },
  { id: "state", label: "Status", sortKey: "Status", csv: (n) => n.Status, cell: (n) => (
    <span className="block leading-tight">
      <NoteMark n={n} />
      <DeadlineNote n={n} />
      {n.CancelApprovalStatus === "Pending" && <span className="block mt-1 text-xs font-semibold text-destructive">Cancellation asked</span>}
    </span>
  ) },
  { id: "refund", label: "Refund", hiddenByDefault: true, csv: (n) => n.RefundNo, cell: (n) => <span className="tabular-nums">{n.RefundNo || "—"}</span> },
  { id: "project", label: "Project", hiddenByDefault: true, csv: (n) => n.ProjectName, cell: (n) => n.ProjectName || "—" },
  { id: "company", label: "Company", hiddenByDefault: true, csv: (n) => n.CompanyName, cell: (n) => n.CompanyName || "—" },
  { id: "gstin", label: "Customer GSTIN", hiddenByDefault: true, csv: (n) => n.CustomerGst, cell: (n) => <span className="tabular-nums">{n.CustomerGst || "—"}</span> },
  { id: "deadline", label: "Declare by", hiddenByDefault: true, csv: (n) => n.DeadlineDate, cell: (n) => (n.DeadlineDate ? <span className="tabular-nums">{day(n.DeadlineDate)}</span> : dash) },
  { id: "remarks", label: "Remarks", hiddenByDefault: true, csv: (n) => n.Remarks, cell: (n) => n.Remarks || "—" },
];

/** Paid refunds that carried GST but have no live credit note: issue (or re-issue) one. */
function PendingList({ pending, isLoading, error, canEdit, onIssued }: {
  pending: any[]; isLoading: boolean; error: unknown; canEdit: boolean; onIssued: (firstId?: number) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const issue = async (refundId: number, re: boolean) => {
    setBusy(refundId);
    try {
      const out = await getJson(`${API}/${refundId}/gst-notes${re ? "/reissue" : ""}`, { method: "POST" });
      toast.success("Credit note issued");
      onIssued(Array.isArray(out) ? out.find((x: any) => x.Status !== "Cancelled")?.Id : undefined);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); }
  };
  if (error) return <p className="px-4 py-10 text-center text-sm text-destructive">{translateError((error as Error).message)}</p>;
  if (isLoading) return <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading paid refunds…</p>;
  return (
    <>
      <p className="px-4 py-2.5 text-xs text-muted-foreground border-b border-border">Paid refunds on bookings charged GST, with no live credit note: paid before credit notes existed, or their credit note was cancelled.</p>
      <GridMiniTable rows={pending} rowKey={(r: any) => r.RefundId} empty="Every paid refund that carried GST has its credit note." cols={[
        { header: "Customer", cell: (r: any) => <span className="font-medium capitalize">{asName(r.CustomerName)}<span className="block text-xs font-normal text-muted-foreground normal-case">{r.Property}{r.ProjectName ? ` · ${r.ProjectName}` : ""}</span></span> },
        { header: "Refund", cell: (r: any) => <span className="tabular-nums">{r.RefundNo}<span className="block text-xs text-muted-foreground">Paid {day(r.PaidAt)}{r.CancelledCount ? " · earlier credit note cancelled" : ""}</span></span> },
        { header: "Amount paid", align: "right", cell: (r: any) => <span className="tabular-nums font-semibold">{inr(r.NetAmount)}</span> },
        { header: "Actions", cell: (r: any) => (canEdit ? <button type="button" onClick={() => issue(r.RefundId, !!r.CancelledCount)} disabled={busy === r.RefundId} className={cn(GRID_SHEET_KEYS.KEY_INK, "h-7 px-2.5")}>{busy === r.RefundId ? "Issuing…" : r.CancelledCount ? "Re-issue" : "Issue credit note"}</button> : null) },
      ]} />
    </>
  );
}

const CrmCreditNotes: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-refunds");
  const [sp, setSp] = useSearchParams();
  const [selectedId, setSelectedId] = useState<number | null>(sp.get("id") ? Number(sp.get("id")) : null);
  // In the address, so a refresh or a shared link keeps it.
  const [tab, setTabRaw] = useUrlParam<Tab>("tab", "all", TABS.map(([t]) => t));
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT });
  const [dates, setDatesRaw] = useState<GridDateRange>(THIS_FY);
  const setTab = (t: Tab) => { setTabRaw(t); list.setPage(1); };
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, NOTE_COLS);
  const { from, to } = resolveGridDateRange(dates);
  const q = list.query;

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(q.page), pageSize: String(q.pageSize) });
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (tab !== "all" && tab !== "pending") p.set("status", tab);
    if (q.search) p.set("search", q.search);
    if (q.companyId) p.set("companyId", q.companyId);
    if (q.projectId) p.set("projectId", q.projectId);
    if (q.blockId) p.set("blockId", q.blockId);
    if (q.sortKey) { p.set("sortKey", q.sortKey); p.set("sortDir", q.sortDir); }
    return p;
  }, [q, from, to, tab]);
  // One page of the documents, with the counts per kind for the same filters (the tabs and figures).
  const { data, isLoading, error, isFetching, refetch } = useQuery<{ rows: any[]; total: number; kindCounts?: KindCounts }>({
    queryKey: ["crm-gst-notes", params.toString()],
    queryFn: async () => {
      const res = await getJson(`${API}/gst-notes?${params}`);
      return Array.isArray(res) ? { rows: res, total: res.length } : res;
    },
  });
  const result = useSticky(data);
  const kc = result?.kindCounts || {};

  const pendingQ = useQuery<any[]>({ queryKey: ["crm-credit-notes-pending"], queryFn: () => getJson(`${API}/gst-notes/pending`) });
  const pending = pendingQ.data ?? [];
  const reload = () => { for (const k of ["crm-gst-notes", "crm-credit-notes-pending", "crm-credit-note"]) qc.invalidateQueries({ queryKey: [k] }); };

  // ?refundId= opens that refund's first live credit note
  const refundParam = sp.get("refundId");
  const { data: refundNotes } = useQuery<any[]>({
    queryKey: ["crm-refund-gst-notes", refundParam],
    queryFn: () => getJson(`${API}/${refundParam}/gst-notes`),
    enabled: !!refundParam,
  });
  useEffect(() => {
    if (!refundParam || !refundNotes) return;
    const first = refundNotes.find((x: any) => x.Status !== "Cancelled") || refundNotes[0];
    setSp((p) => { p.delete("refundId"); if (first) p.set("id", String(first.Id)); return p; }, { replace: true });
    if (first) setSelectedId(first.Id);
    else setTabRaw("pending");
  }, [refundParam, refundNotes, setSp]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = (x: keyof KindCounts) => kc[x] ?? { count: 0, gst: 0, amount: 0, dueSoon: 0 };
  const allCount = Object.values(kc).reduce((s, x) => s + (x?.count ?? 0), 0);
  const dueSoon = k("invoice").dueSoon;
  const tabCount = (t: Tab) => (t === "pending" ? pending.length : t === "all" ? allCount : k(t as keyof KindCounts).count);
  const live = k("invoice").amount + k("advance").amount + k("barred").amount;
  const liveGst = k("invoice").gst + k("advance").gst + k("barred").gst;

  const exportXlsx = async () => {
    setExporting(true);
    try { await exportCreditNotesXlsx(from, to, { companyId: q.companyId, projectId: q.projectId, blockId: q.blockId }); }
    catch (e: any) { toast.error(translateError(e.message || "Couldn't make the Excel")); }
    finally { setExporting(false); }
  };
  const isFy = dates.preset === THIS_FY.preset;
  const hasFilters = list.hasFilters || !isFy;
  const clearFilters = () => { list.reset(); setDatesRaw(THIS_FY); };
  const notes = [
    dueSoon ? `${dueSoon} credit note${dueSoon === 1 ? "" : "s"} must be declared within 30 days.` : null,
    k("request").count ? `${k("request").count} awaiting approval, ${inr(k("request").amount)}, not counted above.` : null,
    k("cancelled").count ? `${k("cancelled").count} cancelled and kept on record.` : null,
  ].filter(Boolean).join(" ");

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Credit Notes"]} />
      <MoneyBand eyebrow="CRM · Finance" title="Credit Notes" sub={`GST documents for money given back, ${from ? day(from) : "from the start"} to ${to ? day(to) : "today"}.`}
        actions={<>
          <button type="button" onClick={exportXlsx} disabled={exporting || !allCount} className={BAND_KEY}><FileDown size={13} /> {exporting ? "Preparing…" : "Excel for GST return"}</button>
          {rights.canCreate && <button type="button" onClick={() => setCreating(true)} className={BAND_KEY_MAIN}><Plus size={13} /> New credit note</button>}
          <button type="button" onClick={() => { refetch(); pendingQ.refetch(); }} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(live)} leadNote={result ? `in issued documents · GST ${inr(liveGst)}` : ""}
        bar={<CollectionBar onDark due={live} collected={k("invoice").amount} finance={k("advance").amount} recorded={k("barred").amount} title={`On invoices ${inr(k("invoice").amount)} · On advances ${inr(k("advance").amount)} · Past deadline ${inr(k("barred").amount)}`} />}
        figures={[
          { label: "On invoices", dot: BAND_DOT.collected, value: fmtShort(k("invoice").amount), note: `GST ${inr(k("invoice").gst)} · ${k("invoice").count} note${k("invoice").count === 1 ? "" : "s"}`, exact: inr(k("invoice").amount) },
          { label: "On advances", dot: BAND_DOT.finance, value: fmtShort(k("advance").amount), note: `GST ${inr(k("advance").gst)} · ${k("advance").count} voucher${k("advance").count === 1 ? "" : "s"}`, exact: inr(k("advance").amount) },
          { label: "Past deadline", dot: BAND_DOT.recorded, value: fmtShort(k("barred").amount), note: `GST ${inr(k("barred").gst)} · ${k("barred").count} certificate${k("barred").count === 1 ? "" : "s"}`, exact: inr(k("barred").amount) },
          { label: "To issue", dot: BAND_DOT.overdue, value: String(pending.length), note: pending.length ? "Paid refunds with no credit note" : "All issued", alert: pending.length > 0 },
        ]}
        footer={notes || undefined} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<Tab> label="Credit notes" active={tab} onChange={setTab} tabs={TABS.filter(([t]) => t !== "request" || tabCount(t) > 0 || tab === t).map(([t, l]) => ({ key: t, label: l, count: result || t === "pending" ? tabCount(t) : null }))} />
        {tab === "pending" ? (
          <PendingList pending={pending} isLoading={pendingQ.isLoading} error={pendingQ.error} canEdit={rights.canEdit}
            onIssued={(id) => { reload(); if (id) { setTabRaw("all"); setSelectedId(id); } }} />
        ) : (
          <>
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Document, customer, booking or invoice" />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Document date" value={dates} onChange={setDates} />
              {hasFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
              <div className="ml-auto flex items-center gap-2">
                <GridSavedViews storageKey={VIEWS_KEY}
                  current={{ status: tab, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize, extra: { dates } }}
                  onApply={(v) => {
                    setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                    list.apply(v);
                    setTabRaw(TABS.some(([t]) => t === v.status) ? (v.status as Tab) : "all");
                    const x = (v.extra ?? {}) as { dates?: GridDateRange };
                    setDatesRaw(x.dates?.preset ? x.dates : THIS_FY);
                  }} />
                <GridColumnChooser cols={NOTE_COLS} prefs={prefs} onChange={setPrefs} />
              </div>
            </div>
            <CrmGrid cols={NOTE_COLS} prefs={prefs} onPrefs={setPrefs} rows={result?.rows ?? []} rowKey={(n) => n.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(n) => { setSelectedId(n.Id); setSp((p) => { p.set("id", String(n.Id)); return p; }, { replace: true }); }}
              empty="No credit notes for this period and these filters."
              page={list.page} pageSize={pageSize} total={result?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          </>
        )}
      </div>

      {selectedId && (
        <DetailDialog key={selectedId} id={selectedId} canEdit={rights.canEdit} onClose={() => { setSelectedId(null); setSp((p) => { p.delete("id"); return p; }, { replace: true }); }}
          onChanged={reload} onOpen={(nid) => { setSelectedId(nid); setSp((p) => { p.set("id", String(nid)); return p; }, { replace: true }); }} />
      )}
      {creating && (
        <NewCreditNoteDialog
          onClose={() => setCreating(false)}
          onCreated={(nid) => { setCreating(false); reload(); setTabRaw("all"); setSelectedId(nid); }}
        />
      )}
    </div>
  );
};

export default CrmCreditNotes;
