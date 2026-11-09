import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { cn } from "@/lib/utils";
import { FileText, Download, RotateCcw, X, Ban, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridColumnChooser, GridDateFilter, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { useUrlParam } from "@/hooks/useUrlParam";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { BAND_DOT, BAND_KEY, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
import { fmtShort, pct } from "./payments/config";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, TEXTAREA } from "./customers/config";

// A money receipt is made automatically for every payment and has no approval of its own. Finance approving the
// payment is the one check on the money, and the receipt follows it.
const API = "/api/crm/money-receipts";
const PREFS_KEY = "crm-money-receipts-cols-v1";
const VIEWS_KEY = "crm-money-receipts-views";
const DEFAULT_SORT: CrmSort = { key: "", dir: "desc" };
const SMALL = "h-7 px-2.5";
const DIALOG = "rounded-none p-5 gap-4";

type ReceiptStatus = typeof CrmStatus.PENDING | typeof CrmStatus.APPROVED | "Bounced";
interface ReceiptRow {
  Id: number; ReceiptNo: string; BookingId: number; ReceivedPaymentId: number | null; Amount: number;
  BaseAmount: number | null; GSTAmount: number | null; PaymentMode: string; ChequeNo: string | null; ChequeDate: string | null;
  TransactionRef: string | null; ReceivedDate: string; Status: ReceiptStatus; BouncedReason: string | null; RPDocNo: string | null;
  BookingNo: string; ProjectName: string | null; UnitNo: string; ApplicantName: string; Mobile: string | null; CreatedAt: string;
}
type Counts = Record<string, { count: number; amount: number }>;

const fmt = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
// Where the money behind a receipt stands, in the same words as the Payment Milestones page.
const receiptState = (r: ReceiptRow): { label: string; tone: "done" | "waiting" | "stopped" } => (
  r.Status === "Bounced" ? { label: "Bounced", tone: "stopped" }
    : r.Status === CrmStatus.APPROVED ? { label: "Approved by Finance", tone: "done" }
    : r.ReceivedPaymentId == null ? { label: "Not sent to Finance", tone: "waiting" }
    : { label: "Pending with Finance", tone: "waiting" }
);

async function fetchList(params: URLSearchParams): Promise<{ rows: ReceiptRow[]; total: number; statusCounts?: Counts }> {
  const res = await fetchWithAuth(`${API}?${params}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to load money receipts");
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts };
}

function ReceiptPdfDialog({ receipt, onClose }: { receipt: ReceiptRow; onClose: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchWithAuth(`${API}/${receipt.Id}/pdf`)
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [receipt.Id]);
  const st = receiptState(receipt);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-2xl ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="font-heading flex items-center gap-2 tabular-nums"><FileText size={15} /> {receipt.ReceiptNo}</DialogTitle>
            {blobUrl && <a href={blobUrl} download={`${receipt.ReceiptNo}.pdf`} className={`${KEY_INK} h-8 px-3 shrink-0`}><Download size={12} /> Download PDF</a>}
          </div>
          <DialogDescription className="text-xs flex items-center gap-2 flex-wrap">
            <span className="font-heading tabular-nums">{receipt.BookingNo}</span> · <span className="font-heading tabular-nums">{fmt(receipt.Amount)}</span> · <GridToneMark text={st.label} tone={st.tone} />
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center min-h-[300px] overflow-hidden" style={{ border: RULE_SOFT }}>
          {failed ? <span className="text-sm text-destructive">Could not load the receipt PDF.</span>
            : !blobUrl ? <span className="text-sm text-muted-foreground">Loading preview…</span>
            : <iframe src={blobUrl} title={receipt.ReceiptNo} className="w-full h-[60vh] border-0" />}
        </div>
        {receipt.Status === "Bounced" && receipt.BouncedReason && <p className="text-xs text-destructive">Bounce reason: {receipt.BouncedReason}</p>}
      </DialogContent>
    </Dialog>
  );
}

function BounceDialog({ receipt, onClose, onConfirm, submitting }: {
  receipt: ReceiptRow; onClose: () => void; onConfirm: (reason: string) => void; submitting: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2"><Ban size={15} /> Bounce {receipt.ReceiptNo}?</DialogTitle>
          <DialogDescription className="text-xs tabular-nums">{fmt(receipt.Amount)} · {receipt.PaymentMode}{receipt.ChequeNo ? ` · cheque ${receipt.ChequeNo}` : ""}</DialogDescription>
        </DialogHeader>
        <div>
          <label className={`block mb-1 ${LBL}`}>Reason *</label>
          <textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why this receipt bounced…" className={TEXTAREA} />
        </div>
        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim() || submitting} className={`${KEY_RED} h-9 px-4`}>
            <Ban size={13} /> {submitting ? "Bouncing…" : "Bounce receipt"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function receiptCols(actions: (r: ReceiptRow) => React.ReactNode): GridCol<ReceiptRow>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (r) => r.ApplicantName, cell: (r) => (
      <span className="flex items-center gap-3 py-1.5 min-w-0">
        <Initials name={r.ApplicantName} />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground capitalize truncate" title={r.ApplicantName}>{asName(r.ApplicantName)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.BookingNo} · {r.UnitNo}{r.ProjectName ? ` · ${r.ProjectName}` : ""}</span>
        </span>
      </span>
    ) },
    { id: "no", label: "Receipt", sortKey: "ReceiptNo", csv: (r) => r.ReceiptNo, cell: (r) => (
      <span className="inline-flex flex-col leading-tight">
        <span className={cn("tabular-nums font-semibold", r.Status === "Bounced" ? "line-through text-muted-foreground" : "text-foreground")}>{r.ReceiptNo}</span>
        <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{fmtDate(r.ReceivedDate)}</span>
      </span>
    ) },
    { id: "mode", label: "Mode · Ref. no.", sortKey: "PaymentMode", csv: (r) => r.PaymentMode, cell: (r) => (
      <span className="inline-flex flex-col leading-tight">
        <span>{r.PaymentMode}</span>
        {(r.ChequeNo || r.TransactionRef) && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums truncate max-w-[10rem]" title={r.ChequeNo || r.TransactionRef || undefined}>{r.ChequeNo || r.TransactionRef}</span>}
      </span>
    ) },
    { id: "amount", label: "Amount", align: "right", sortKey: "Amount", csv: (r) => r.Amount, cell: (r) => (
      <span className="inline-flex flex-col items-end leading-tight">
        <span className={cn("tabular-nums font-semibold", r.Status === "Bounced" && "line-through font-normal text-muted-foreground")}>{fmt(r.Amount)}</span>
        {r.BaseAmount != null && r.GSTAmount != null && Number(r.GSTAmount) > 0 && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">GST {fmt(r.GSTAmount)}</span>}
      </span>
    ) },
    { id: "status", label: "Status", csv: (r) => receiptState(r).label, cell: (r) => {
      const st = receiptState(r);
      return (
        <span className="block leading-tight">
          <GridToneMark text={st.label} tone={st.tone} />
          {r.Status === "Bounced" && r.BouncedReason
            ? <span className="block mt-1 text-xs text-destructive truncate max-w-[14rem]" title={r.BouncedReason}>{r.BouncedReason}</span>
            : r.RPDocNo ? <span className="block mt-1 text-xs text-muted-foreground tabular-nums">{r.RPDocNo}</span> : null}
        </span>
      );
    } },
    { id: "act", label: "Actions", locked: true, cell: actions },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", csv: (r) => r.BookingNo, cell: (r) => <span className="tabular-nums">{r.BookingNo}</span> },
    { id: "unit", label: "Unit", hiddenByDefault: true, csv: (r) => r.UnitNo, cell: (r) => r.UnitNo },
    { id: "project", label: "Project", hiddenByDefault: true, csv: (r) => r.ProjectName, cell: (r) => r.ProjectName || "—" },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, csv: (r) => r.Mobile, cell: (r) => <span className="tabular-nums">{r.Mobile || "—"}</span> },
    { id: "base", label: "Taxable value", align: "right", hiddenByDefault: true, csv: (r) => r.BaseAmount, cell: (r) => <span className="tabular-nums">{fmt(r.BaseAmount)}</span> },
    { id: "gst", label: "GST", align: "right", hiddenByDefault: true, csv: (r) => r.GSTAmount, cell: (r) => <span className="tabular-nums">{fmt(r.GSTAmount)}</span> },
    { id: "chequeDate", label: "Cheque date", hiddenByDefault: true, csv: (r) => r.ChequeDate, cell: (r) => <span className="tabular-nums">{fmtDate(r.ChequeDate)}</span> },
    { id: "finance", label: "Finance doc", hiddenByDefault: true, csv: (r) => r.RPDocNo, cell: (r) => <span className="tabular-nums">{r.RPDocNo || "—"}</span> },
  ];
}

const REPORT_TABS = [
  { key: "All", label: "All receipts" }, { key: "NotSent", label: "Not sent to Finance" }, { key: "WithFinance", label: "Pending with Finance" },
  { key: CrmStatus.APPROVED as string, label: "Approved by Finance" }, { key: "Bounced", label: "Bounced" },
];

const CrmMoneyReceipts: React.FC = () => {
  const [sp, setSp] = useSearchParams();
  const bookingIdParam = sp.get("bookingId") || "";
  const qc = useQueryClient();
  const { canEdit } = usePageRights("crm-money-receipts");
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT });
  const [status, setStatusRaw] = useUrlParam<string>("status", "All");
  const setStatus = (s: string) => { setStatusRaw(s); list.setPage(1); };
  const [dates, setDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptRow | null>(null);
  const [bounceReceipt, setBounceReceipt] = useState<ReceiptRow | null>(null);
  const [sweeping, setSweeping] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const range = resolveGridDateRange(dates);
  const params = useMemo(() => {
    const p = listParams({ ...list.query, status });
    if (range.from) p.set("fromDate", range.from);
    if (range.to) p.set("toDate", range.to);
    if (bookingIdParam) p.set("bookingId", bookingIdParam);
    return p;
  }, [list.query, status, range.from, range.to, bookingIdParam]);
  const { data, isLoading, error, isFetching, refetch } = useQuery({ queryKey: ["crm-money-receipts", params.toString()], queryFn: () => fetchList(params), staleTime: 30_000 });
  const result = useSticky(data);
  const counts = result?.statusCounts ?? {};
  const c = (k: string) => counts[k] ?? { count: 0, amount: 0 };
  const invalidateAll = () => qc.invalidateQueries({ queryKey: ["crm-money-receipts"] });

  const runAction = async (row: ReceiptRow, path: string, okMsg: string, body?: object) => {
    setBusyId(row.Id);
    try {
      const res = await fetchWithAuth(`${API}/${row.Id}/${path}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(translateError(d.error || "That didn't go through")); return false; }
      toast.success(okMsg);
      invalidateAll();
      return true;
    } catch { toast.error("Network error — please try again"); return false; }
    finally { setBusyId(null); }
  };
  const handleBounce = async (reason: string) => {
    if (bounceReceipt && await runAction(bounceReceipt, "bounce", `${bounceReceipt.ReceiptNo} marked as bounced`, { reason })) setBounceReceipt(null);
  };
  const sendStuck = async () => {
    setSweeping(true);
    try {
      const res = await fetchWithAuth(`${API}/sweep-pending`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(translateError(d.error || "That didn't go through")); return; }
      if (d.processed === 0 && d.failed === 0) toast.info("Nothing stuck: every approved booking's receipt is with Finance.");
      else { toast.success(`Sent ${d.processed} receipt(s) to Finance.${d.failed ? ` ${d.failed} failed.` : ""}`); invalidateAll(); }
    } catch { toast.error("That didn't go through"); }
    finally { setSweeping(false); }
  };

  const actions = (r: ReceiptRow) => (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setPreviewReceipt(r)} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL)}><FileText size={12} /> PDF</button>
      {canEdit && r.Status === "Bounced" && r.ReceivedPaymentId == null && (
        <button type="button" onClick={() => void runAction(r, "resubmit", `${r.ReceiptNo} put back`)} disabled={busyId === r.Id} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL)} title="The payment came good: put this receipt back"><RotateCcw size={12} /> Put back</button>
      )}
      {canEdit && r.Status === CrmStatus.PENDING && r.ReceivedPaymentId == null && (
        <button type="button" onClick={() => setBounceReceipt(r)} disabled={busyId === r.Id} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL, "!text-destructive")}><Ban size={12} /> Bounce</button>
      )}
    </span>
  );
  const cols = receiptCols(actions);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, cols);

  const received = c(CrmStatus.APPROVED).amount + c("WithFinance").amount + c("NotSent").amount;
  const allCount = c(CrmStatus.APPROVED).count + c("WithFinance").count + c("NotSent").count + c("Bounced").count;
  const countOf = (k: string) => (k === "All" ? allCount : c(k).count);
  const hasFilters = list.hasFilters || dates.preset !== GRID_ANY_DATE.preset;
  const clearFilters = () => { list.reset(); setDatesRaw(GRID_ANY_DATE); };
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params);
      p.set("page", "1"); p.set("pageSize", "200");
      const first = await fetchList(p);
      let rows = first.rows;
      for (let n = 2; rows.length < first.total; n++) { p.set("page", String(n)); const more = await fetchList(p); if (!more.rows.length) break; rows = rows.concat(more.rows); }
      exportGrid(rows, cols, `money-receipts-${status}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Money Receipts"]} />
      <MoneyBand eyebrow="CRM · Finance" title="Money Receipts" sub="Made automatically for every payment received. A receipt needs no approval."
        actions={<>
          {canEdit && <button type="button" onClick={sendStuck} disabled={sweeping} className={BAND_KEY} title="Sends the receipts of approved bookings that did not reach Finance">{sweeping ? "Sending…" : "Send stuck receipts to Finance"}</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(c(CrmStatus.APPROVED).amount)} leadNote={result ? `approved by Finance of ${fmtShort(received)} received · ${pct(c(CrmStatus.APPROVED).amount, received)}%` : ""}
        bar={<CollectionBar onDark due={received} collected={c(CrmStatus.APPROVED).amount} finance={c("WithFinance").amount} recorded={c("NotSent").amount} title={`Received ${fmt(received)}`} />}
        figures={[
          { label: "Approved by Finance", dot: BAND_DOT.collected, value: fmtShort(c(CrmStatus.APPROVED).amount), note: `${c(CrmStatus.APPROVED).count} receipt${c(CrmStatus.APPROVED).count === 1 ? "" : "s"}`, exact: fmt(c(CrmStatus.APPROVED).amount) },
          { label: "Pending with Finance", dot: BAND_DOT.finance, value: fmtShort(c("WithFinance").amount), note: `${c("WithFinance").count} receipt${c("WithFinance").count === 1 ? "" : "s"}`, exact: fmt(c("WithFinance").amount) },
          { label: "Not sent to Finance", dot: BAND_DOT.recorded, value: fmtShort(c("NotSent").amount), note: "Sent on Director approval", exact: fmt(c("NotSent").amount) },
          { label: "Bounced", dot: BAND_DOT.overdue, value: fmtShort(c("Bounced").amount), note: `${c("Bounced").count} receipt${c("Bounced").count === 1 ? "" : "s"}, not counted`, exact: fmt(c("Bounced").amount), alert: c("Bounced").count > 0 },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<string> label="Money receipts" active={status} onChange={setStatus} tabs={REPORT_TABS.map((t) => ({ ...t, count: result ? countOf(t.key) : null }))} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          {bookingIdParam ? (
            <>
              <span className="text-sm">Receipts of booking <span className="font-semibold tabular-nums">{result?.rows[0]?.BookingNo ?? `#${bookingIdParam}`}</span></span>
              <button type="button" onClick={() => setSp((p) => { p.delete("bookingId"); return p; })} className={GRID_BTN}><X size={12} /> Show all receipts</button>
            </>
          ) : (
            <>
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Receipt, booking, customer or mobile" />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Received on" value={dates} onChange={setDates} />
              {hasFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <GridSavedViews storageKey={VIEWS_KEY}
              current={{ status, search: list.searchInput.trim(), cpb: list.cpb, sort: list.sort, pageSize, extra: { dates } }}
              onApply={(v) => {
                setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                list.apply(v);
                setStatusRaw(v.status || "All");
                const x = (v.extra ?? {}) as { dates?: GridDateRange };
                setDatesRaw(x.dates?.preset ? x.dates : GRID_ANY_DATE);
              }} />
            <GridColumnChooser cols={cols} prefs={prefs} onChange={setPrefs} />
            <button type="button" onClick={handleExport} disabled={exporting} className={GRID_BTN} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
          </div>
        </div>
        <CrmGrid cols={cols} prefs={prefs} onPrefs={setPrefs} rows={result?.rows ?? []} rowKey={(r) => r.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
          sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => setPreviewReceipt(r)}
          empty={hasFilters || status !== "All" ? "No money receipt matches these filters." : "No money receipts yet. One is made automatically for every payment received."}
          page={list.page} pageSize={pageSize} total={result?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>
      {previewReceipt && <ReceiptPdfDialog receipt={previewReceipt} onClose={() => setPreviewReceipt(null)} />}
      {bounceReceipt && <BounceDialog receipt={bounceReceipt} submitting={busyId === bounceReceipt.Id} onClose={() => setBounceReceipt(null)} onConfirm={handleBounce} />}
    </div>
  );
};

export default CrmMoneyReceipts;
