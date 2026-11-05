import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCrmListState, useSticky, listParams, type CrmListQuery, type CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { round2 } from "@/lib/crmPriceQuote";
import { ArrowLeft, ArrowRight, Copy, Download, ExternalLink, Info, RefreshCw, RotateCcw, Wallet, XCircle, ShieldCheck, FileText, Home } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmAppPage, CrmGrid, GridBulkBar, GridColumnChooser, GridDateFilter, GridFields, GridHighlights, GridMetric, GridPath, GridRelated,
  GridSavedViews, GridSearch, GridStatusPill, GridTabs, GridToggleChip, exportGrid, gridListMeta, gridVisibleCols, resolveGridDateRange,
  useGridPrefs, GRID_ANY_DATE, type GridDateRange,

  GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_LABEL, GRID_PAGE_SIZES, type GridCol, type GridPathState,
} from "@/components/crm/CrmDataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";

const API = "/api/crm/cancellations";
const PREFS_KEY = "crm-cancellations-grid";
const VIEWS_KEY = "crm-cancellations-saved-views";
const ALL = "All";
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };

const STATUSES = ["Pending", "FinancePending", "Approved", "Rejected", "Refunded"];
const statusText = (s: string) => (s === "FinancePending" ? "With Finance" : s);

const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const dt = (v: any) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");

/** This page's own filters beyond the common list ones: when it was requested, and only overdue refunds. */
interface ExtraFilters { requested: GridDateRange; refundOverdue: boolean }
const NO_EXTRA: ExtraFilters = { requested: GRID_ANY_DATE, refundOverdue: false };
function queryString(q: CrmListQuery, x: ExtraFilters): URLSearchParams {
  const p = listParams(q, ALL);
  const { from, to } = resolveGridDateRange(x.requested);
  if (from) p.set("dateFrom", from);
  if (to) p.set("dateTo", to);
  if (x.refundOverdue) p.set("refundOverdue", "1");
  return p;
}

interface CancellationList { rows: any[]; total: number; statusCounts: Record<string, number>; summary: { paidTillDate: number; refundsOverdue: number } }
async function fetchCancellationsList(q: CrmListQuery, x: ExtraFilters): Promise<CancellationList> {
  // A failed load used to read as "No cancellation requests".
  const r = await fetchWithAuth(`${API}?${queryString(q, x)}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the cancellations (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {}, summary: data.summary || { paidTillDate: 0, refundsOverdue: 0 } };
}
async function fetchAllCancellations(q: CrmListQuery, x: ExtraFilters): Promise<any[]> {
  const p = queryString(q, x);
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the cancellations (${r.status}).`);
  return data;
}
async function fetchCancellation(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load this cancellation (${r.status}).`);
  return data;
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchCancellationPolicy(bookingId: string): Promise<any | null> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/policy?bookingId=${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}

/** What a refund nets: the paid amount less the deduction, which is taken only if the customer takes a refund. */
const deductionOf = (r: any) => Math.round(Number(r.AmountPaidTillDate || 0) * Number(r.DeductionPercent || 0)) / 100;
const netOf = (r: any) => Math.max(0, round2(Number(r.AmountPaidTillDate || 0) - deductionOf(r)));
const approvedLike = (s: string) => s === CrmStatus.APPROVED || s === "Cancelled" || s === "FinancePending" || s === "Refunded";

/** What the cancellation is waiting on next, in words, and who acts. */
function nextStepText(c: any): string {
  if (c.Status === CrmStatus.PENDING) return "Waiting in the Approval Inbox";
  if (c.Status === CrmStatus.REJECTED) return c.Notes ? `Rejected: ${c.Notes}` : "Rejected";
  if (approvedLike(c.Status)) {
    if (c.SettlementStatus === "Settled") return "Settled";
    if (c.RefundId != null) return `Refund ${c.RefundNo}: ${c.RefundStatus}`;
    return "Held credit parked. Refund or re-book from Refunds.";
  }
  return statusText(c.Status);
}

/** The record's stages, read from what is recorded: requested, approval, held credit, refund or re-booking. */
function cancellationPath(c: any): { label: string; state: GridPathState; note?: string }[] {
  const rejected = c.Status === CrmStatus.REJECTED;
  const approved = approvedLike(c.Status);
  const held = c.HeldOnAccountId != null;
  const settled = c.SettlementStatus === "Settled";
  return [
    { label: "Requested", state: "done", note: `Requested ${dt(c.RequestedDate)}${c.RequestedByName ? ` by ${c.RequestedByName}` : ""}` },
    {
      label: rejected ? "Rejected" : "Approval", state: rejected ? "failed" : approved ? "done" : "current",
      note: rejected ? (c.Notes ? `Rejected: ${c.Notes}` : "Rejected in the Approval Inbox") : "Waiting in the Approval Inbox",
    },
    { label: "Held credit", state: rejected ? "todo" : held ? "done" : approved ? "current" : "todo", note: "The paid amount is parked as credit on approval." },
    {
      label: "Refund or re-booking", state: settled ? "done" : held && !rejected ? "current" : "todo",
      note: c.RefundId != null ? `Refund ${c.RefundNo} is ${c.RefundStatus}${c.IsRefundOverdue ? " and overdue" : ""}.` : "Carried on in Refunds: refund the customer or use the credit for a new booking.",
    },
  ];
}

/** The grid's columns. The Next step column needs the page's rights and actions, so they come in from the page. */
function cancellationCols(ctx: { canEdit: boolean; onChanged: () => void; openRefund: (id: number) => void }): GridCol<any>[] {
  return [
    { id: "no", label: "Cancellation", sortKey: "CancellationNo", locked: true, cell: (c) => <span className="font-semibold text-primary hover:underline tabular-nums">{c.CancellationNo}</span>, csv: (c) => c.CancellationNo },
    { id: "booking", label: "Booking", sortKey: "BookingNo", cell: (c) => <span className="tabular-nums">{c.BookingNo}</span>, csv: (c) => c.BookingNo },
    {
      id: "customer", label: "Customer", sortKey: "ApplicantName",
      cell: (c) => <span className="truncate block max-w-[16rem]" onClick={(e) => e.stopPropagation()}><ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /></span>,
      csv: (c) => c.ApplicantName,
    },
    { id: "mobile", label: "Mobile", cell: (c) => <span className="tabular-nums">{c.Mobile || "—"}</span>, csv: (c) => c.Mobile, hiddenByDefault: true },
    {
      id: "unit", label: "Project · unit", sortKey: "ProjectName",
      cell: (c) => <span className="truncate block max-w-[14rem]">{[c.ProjectName, c.UnitNo].filter(Boolean).join(" · ") || "—"}</span>,
      csv: (c) => [c.ProjectName, c.UnitNo].filter(Boolean).join(" · "),
    },
    { id: "paid", label: "Paid till date", sortKey: "AmountPaidTillDate", align: "right", cell: (c) => <span className="tabular-nums">{fmt(c.AmountPaidTillDate)}</span>, csv: (c) => c.AmountPaidTillDate },
    { id: "pct", label: "Deduction %", sortKey: "DeductionPercent", align: "right", cell: (c) => <span className="tabular-nums">{Number(c.DeductionPercent)}%</span>, csv: (c) => Number(c.DeductionPercent) },
    {
      id: "deduction", label: "Deduction if refunded", align: "right",
      cell: (c) => <span className="tabular-nums" title="Deducted only if the customer takes a refund; a re-booking keeps the full amount">{fmt(deductionOf(c))}</span>,
      csv: (c) => deductionOf(c),
    },
    {
      id: "net", label: "Refund if taken", align: "right",
      cell: (c) => <span className="tabular-nums font-semibold" title={`The full ${fmt(c.AmountPaidTillDate)} is held as credit; a re-booking uses all of it`}>{fmt(netOf(c))}</span>,
      csv: (c) => netOf(c),
    },
    { id: "status", label: "Status", sortKey: "Status", cell: (c) => <GridStatusPill status={c.Status} label={statusText(c.Status)} />, csv: (c) => statusText(c.Status) },
    { id: "requested", label: "Requested", sortKey: "RequestedDate", cell: (c) => <span className="tabular-nums">{dt(c.RequestedDate)}</span>, csv: (c) => dt(c.RequestedDate) },
    { id: "by", label: "Requested by", hiddenByDefault: true, cell: (c) => c.RequestedByName || "—", csv: (c) => c.RequestedByName },
    { id: "reason", label: "Reason", hiddenByDefault: true, cell: (c) => <span className="truncate block max-w-[18rem]" title={c.Reason || ""}>{c.Reason || "—"}</span>, csv: (c) => c.Reason },
    {
      id: "next", label: "Next step", csv: nextStepText,
      cell: (c) => (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* submitOnly: Approve/Reject only ever happen from the Admin Approval Inbox */}
          {ctx.canEdit && <ApprovalActions status={c.Status} recordId={c.Id} endpoint={API} submitOnly onSuccess={ctx.onChanged} />}
          {approvedLike(c.Status) && c.RefundId != null ? (
            <button type="button" onClick={() => ctx.openRefund(c.RefundId)} className={cn(GRID_BTN, "h-7")}>
              Refund {c.RefundNo} <ArrowRight size={11} />
            </button>
          ) : (
            <span className={cn("truncate max-w-[18rem]", c.Status === CrmStatus.REJECTED ? "text-destructive" : "text-muted-foreground")} title={nextStepText(c)}>{nextStepText(c)}</span>
          )}
        </div>
      ),
    },
  ];
}

// ── Record page ──────────────────────────────────────────────────────────────
const CancellationRecord: React.FC<{ id: number; canEdit: boolean; onChanged: () => void }> = ({ id, canEdit, onChanged }) => {
  const navigate = useNavigate();
  const { data: c, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["crm-cancellation", id],
    queryFn: () => fetchCancellation(id),
    staleTime: 15_000,
    retry: false,
  });
  if (isLoading) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>;
  if (isError || !c) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{(error as Error)?.message || "Could not load this cancellation."}</div>;

  const heldBalance = c.HeldOnAccountId != null ? Math.max(0, round2(Number(c.HeldAmount || 0) - Number(c.HeldApplied || 0))) : null;
  const changed = () => { refetch(); onChanged(); };

  return (
    <div className="space-y-4">
      <GridHighlights icon={XCircle} object="Cancellation" title={<span className="tabular-nums">{c.CancellationNo}</span>}
        status={<GridStatusPill status={c.Status} label={statusText(c.Status)} />}
        sub={<>{c.ApplicantName} · <span className="tabular-nums">{c.BookingNo}</span></>}
        actions={<>
          {canEdit && <ApprovalActions status={c.Status} recordId={c.Id} endpoint={API} submitOnly onSuccess={changed} />}
          <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/bookings?view=${c.BookingId}`)}><Home size={13} /> Open booking</button>
          {c.RefundId != null && <button type="button" className={GRID_BTN_BRAND} onClick={() => navigate(`/crm/refunds?id=${c.RefundId}`)}>Open refund {c.RefundNo} <ExternalLink size={12} /></button>}
        </>}
        fields={[
          { label: "Paid till date", value: fmt(c.AmountPaidTillDate) },
          { label: "Refund if taken", value: fmt(netOf(c)) },
          { label: "Project · unit", value: [c.ProjectName, c.UnitNo].filter(Boolean).join(" · ") || "—" },
          { label: "Requested", value: dt(c.RequestedDate) },
          { label: "Requested by", value: c.RequestedByName || "—" },
          { label: approvedLike(c.Status) ? "Approved by" : "Approver", value: c.ApprovedByName ? `${c.ApprovedByName}${c.ApprovedAt ? ` · ${dt(c.ApprovedAt)}` : ""}` : "—" },
        ]} />

      <GridPath steps={cancellationPath(c)} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
        <div className="space-y-4 min-w-0">
          <GridRelated icon={Wallet} title="Money">
            <GridFields fields={[
              { label: "Paid till date", value: <span className="tabular-nums font-semibold">{fmt(c.AmountPaidTillDate)}</span> },
              { label: "Booking value", value: <span className="tabular-nums">{fmt(c.TotalValue)}</span> },
              { label: `Deduction (${Number(c.DeductionPercent)}%)`, value: <span className="tabular-nums">{fmt(deductionOf(c))} <span className="text-muted-foreground">· only if refunded</span></span> },
              { label: "Refund if taken", value: <span className="tabular-nums font-semibold">{fmt(netOf(c))}</span> },
              { label: "Held credit", value: c.HeldOnAccountId != null ? <span className="tabular-nums">{fmt(c.HeldAmount)}</span> : "Not parked yet" },
              { label: "Held credit left", value: heldBalance != null ? <span className="tabular-nums">{fmt(heldBalance)}{Number(c.HeldApplied) > 0 ? <span className="text-muted-foreground"> · {fmt(c.HeldApplied)} used</span> : null}</span> : "—" },
            ]} />
          </GridRelated>

          <GridRelated icon={ArrowRight} title="Refund"
            action={c.RefundId != null ? <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/refunds?id=${c.RefundId}`)}>Open <ExternalLink size={11} /></button> : undefined}>
            {c.RefundId == null ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">
                {approvedLike(c.Status) ? "No refund made yet. The credit can still be used for a new booking." : "A refund is made once the cancellation is approved."}
              </p>
            ) : (
              <GridFields fields={[
                { label: "Refund", value: <span className="tabular-nums font-medium">{c.RefundNo}</span> },
                { label: "Status", value: <GridStatusPill status={c.SettlementStatus === "Settled" ? "Settled" : c.RefundStatus} /> },
                { label: "Net amount", value: <span className="tabular-nums">{fmt(c.RefundNetAmount)}</span> },
                {
                  label: "Due", value: c.RefundDueDate ? (
                    <span className={cn("tabular-nums", c.IsRefundOverdue ? "text-destructive font-semibold" : "")}>
                      {dt(c.RefundDueDate)}{c.RefundDaysRemaining != null ? (c.IsRefundOverdue ? ` · ${Math.abs(c.RefundDaysRemaining)} days overdue` : ` · ${c.RefundDaysRemaining} days left`) : ""}
                    </span>) : "—",
                },
              ]} />
            )}
          </GridRelated>

          <GridRelated icon={FileText} title="Details">
            <GridFields fields={[
              { label: "Reason", value: c.Reason || "—", wide: true },
              ...(c.Notes ? [{ label: c.Status === CrmStatus.REJECTED ? "Rejection note" : "Notes", value: <span className="whitespace-pre-line">{c.Notes}</span>, wide: true }] : []),
              { label: "Customer", value: <ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /> },
              { label: "Mobile", value: <span className="tabular-nums">{c.Mobile || "—"}</span> },
              { label: "Booking", value: <span className="tabular-nums">{c.BookingNo}</span> },
              { label: "Last updated", value: <span className="tabular-nums">{c.UpdatedAt ? new Date(c.UpdatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span> },
            ]} />
          </GridRelated>
        </div>

        <aside className="space-y-4 min-w-0 xl:sticky xl:top-4">
          <GridRelated icon={ShieldCheck} title="Approval history">
            <div className="px-4 py-4 text-xs">
              <ApprovalTrailTimeline table="CrmCancellation" recordId={c.Id} refreshKey={c.UpdatedAt}
                empty={<span className="text-muted-foreground">{c.Status === CrmStatus.PENDING ? "Waiting in the Approval Inbox. No level has acted yet." : "No approval steps recorded."}</span>} />
            </div>
          </GridRelated>
          <section className={cn(GRID_CARD, "px-4 py-3 text-xs text-muted-foreground flex gap-2")}>
            <Info size={14} className="shrink-0 mt-0.5 text-primary" />
            <p>On approval the whole paid amount is held as credit. The deduction is taken only if the customer takes a refund; a re-booking uses all of it.</p>
          </section>
        </aside>
      </div>
    </div>
  );
};

// ── Page ─────────────────────────────────────────────────────────────────────
const CrmCancellations: React.FC = () => {
  const rights = usePageRights("crm-cancellations");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || "";
  // The open cancellation lives in the address (?id=), so a refresh or a shared link lands on it.
  const [idParam, setIdParam] = useUrlParam("id");
  const openId = Number(idParam) > 0 ? Number(idParam) : null;
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ BookingId: "", Reason: "", DeductionPercent: "" });
  // Policy data loaded when a booking is selected — shown to staff before submit
  const [policy, setPolicy] = useState<any | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setExtra = (x: Partial<ExtraFilters>) => { setExtraRaw((cur) => ({ ...cur, ...x })); s.setPage(1); };
  const extraOn = extra.requested.preset !== "any" || extra.refundOverdue;
  const filtered = s.hasFilters || extraOn;
  const clearFilters = () => { s.reset(); setExtraRaw(NO_EXTRA); };
  // Ticked rows, kept across pages and filters until cleared.
  const [selected, setSelected] = useState<Map<string | number, any>>(new Map());

  useEffect(() => {
    if (bookingIdParam && rights.canCreate) {
      setForm((f) => ({ ...f, BookingId: bookingIdParam }));
      setDialogOpen(true);
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("bookingId"); return next; }, { replace: true });
    }
  }, [bookingIdParam, setSearchParams, rights.canCreate]);

  // When BookingId changes, fetch the applicable policy slab and pre-fill
  // DeductionPercent. Staff can still override it — the slab info card
  // makes the policy visible so any deviation is a deliberate choice.
  useEffect(() => {
    if (!form.BookingId) { setPolicy(null); setForm((f) => ({ ...f, DeductionPercent: "" })); return; }
    let cancelled = false;
    setPolicyLoading(true);
    fetchCancellationPolicy(form.BookingId).then((p) => {
      if (cancelled) return;
      setPolicy(p);
      if (p?.DeductionPercent != null) setForm((f) => ({ ...f, DeductionPercent: String(Number(p.DeductionPercent)) }));
    }).finally(() => { if (!cancelled) setPolicyLoading(false); });
    return () => { cancelled = true; };
  }, [form.BookingId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-cancellations", s.query, extra],
    queryFn: () => fetchCancellationsList(s.query, extra),
    staleTime: 30_000,
  });
  const result = useSticky(data);
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const counts = result?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((n, x) => n + x, 0);
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-cancellation-bookings"], queryFn: fetchBookings, staleTime: 60_000, enabled: dialogOpen });

  // A change from the list or the record refreshes both.
  const refreshAll = useMemo(() => () => {
    qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
    qc.invalidateQueries({ queryKey: ["crm-cancellation"] });
  }, [qc]);
  const cols = useMemo(() => cancellationCols({
    canEdit: rights.canEdit,
    onChanged: refreshAll,
    openRefund: (id) => navigate(`/crm/refunds?id=${id}`),
  }), [rights.canEdit, refreshAll, navigate]);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, cols);

  const runExport = async () => {
    setExporting(true); setExportError(null);
    try {
      exportGrid(await fetchAllCancellations(s.query, extra), gridVisibleCols(cols, prefs), `cancellations-${s.status.toLowerCase()}`);
    } catch (e) { setExportError((e as Error).message); } finally { setExporting(false); }
  };
  const exportSelected = () => exportGrid([...selected.values()], gridVisibleCols(cols, prefs), `cancellations-selected-${selected.size}`);
  const copySelected = async () => {
    const text = [...selected.values()].map((c) => c.CancellationNo).join("\n");
    try { await navigator.clipboard.writeText(text); toast.success(`Copied ${selected.size} cancellation number${selected.size === 1 ? "" : "s"}`); }
    catch { toast.error("Could not copy. Your browser blocked the clipboard."); }
  };

  const closeDialog = () => { setDialogOpen(false); setPolicy(null); setForm({ BookingId: "", Reason: "", DeductionPercent: "" }); };

  const handleRequest = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!form.Reason.trim()) { toast.error("Give the reason for the cancellation"); return; }
    const pct = form.DeductionPercent !== "" ? parseFloat(form.DeductionPercent) : undefined;
    if (pct != null && (!(pct >= 0) || pct > 100)) { toast.error("The charge must be between 0 and 100%"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          BookingId: parseInt(form.BookingId),
          Reason: form.Reason.trim() || undefined,
          // Only send DeductionPercent if staff actually changed it from the
          // policy suggestion — omitting it lets the backend re-resolve fresh.
          DeductionPercent: pct,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || data.error);
      toast.success(`Cancellation requested — ${fmt(data.refundAmt)} will be held as credit (deduction only if refunded)`);
      closeDialog();
      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
      qc.invalidateQueries({ queryKey: ["crm-cancellation-bookings"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const overriding = policy && form.DeductionPercent !== "" && form.DeductionPercent !== String(Number(policy.DeductionPercent));
  const tabs = [ALL, ...STATUSES].map((k) => ({ key: k, label: k === ALL ? "All" : statusText(k), count: result ? (k === ALL ? allCount : counts[k] ?? 0) : null }));

  return (
    <>
      <Breadcrumbs items={openId ? ["Dashboard", "CRM", "Cancellations", "Record"] : ["Dashboard", "CRM", "Cancellations"]} />
      <CrmAppPage icon={XCircle} section="CRM · After-sales" title="Cancellations"
        subtitle={openId ? undefined : "On approval the paid amount is held as credit; the policy's deduction is taken only if the customer takes a refund. Refunds and re-bookings carry on in Refunds."}
        actions={<>
          {openId && <button type="button" onClick={() => setIdParam("")} className={GRID_BTN}><ArrowLeft size={13} /> All cancellations</button>}
          {rights.canCreate && <button type="button" onClick={() => setDialogOpen(true)} className={GRID_BTN_BRAND}><XCircle size={13} /> Request cancellation</button>}
        </>}>

        {/* The list stays mounted while a record is open, so its tab, search, filters, sort and page survive the round trip. */}
        <div hidden={openId != null} className={cn(GRID_CARD, "overflow-hidden")}>
          <div className="px-4 pt-3 pb-2">
            <h2 className="text-base font-bold leading-tight">{tabs.find((t) => t.key === s.status)?.label ?? "All"} cancellations</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{gridListMeta(total, cols, s.sort, filtered)}</p>
          </div>
          <GridTabs label="Status" tabs={tabs} active={s.status} onChange={s.setStatus} />

          {/* Totals across the current tab and filters */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border border-b border-border">
            <GridMetric label="Requests" value={total.toLocaleString("en-IN")} />
            <GridMetric label="Paid till date" value={fmt(result?.summary.paidTillDate ?? 0)} strong />
            <GridMetric label="Awaiting approval" value={(counts.Pending ?? 0).toLocaleString("en-IN")} />
            <GridMetric label="Refunds overdue" value={<span className={(result?.summary.refundsOverdue ?? 0) > 0 ? "text-destructive" : ""}>{(result?.summary.refundsOverdue ?? 0).toLocaleString("en-IN")}</span>} />
          </div>

          {selected.size > 0 && (
            <GridBulkBar count={selected.size} onClear={() => setSelected(new Map())}>
              <button type="button" className={GRID_BTN} onClick={exportSelected}><Download size={13} /> Export selected</button>
              <button type="button" className={GRID_BTN} onClick={copySelected}><Copy size={13} /> Copy numbers</button>
            </GridBulkBar>
          )}

          <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
            <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, booking, cancellation no." />
            <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
            <GridDateFilter label="Requested" value={extra.requested} onChange={(v) => setExtra({ requested: v })} />
            <GridToggleChip label="Refunds overdue" on={extra.refundOverdue} onChange={(on) => setExtra({ refundOverdue: on })}
              count={extra.refundOverdue ? null : result?.summary.refundsOverdue ?? null} />
            {filtered && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 h-8 px-2 text-xs text-primary hover:underline">
                <RotateCcw size={12} /> Clear filters
              </button>
            )}
            <div className="ml-auto flex items-center gap-2 flex-wrap">
              {exportError && <span className="text-xs text-destructive">{exportError}</span>}
              <button type="button" className={cn(GRID_BTN, "w-9 px-0")} onClick={() => refetch()} aria-label="Refresh" title="Refresh">
                <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
              <GridSavedViews storageKey={VIEWS_KEY}
                current={{ status: s.status, search: s.searchInput.trim(), cpb: s.cpb, sort: s.sort, pageSize, extra: { ...extra } }}
                onApply={(v) => {
                  setPageSize(GRID_PAGE_SIZES.includes(v.pageSize as typeof GRID_PAGE_SIZES[number]) ? v.pageSize : GRID_PAGE_SIZES[0]);
                  s.apply(v);
                  const x = (v.extra ?? {}) as Partial<ExtraFilters>;
                  setExtraRaw({ requested: x.requested?.preset ? x.requested : GRID_ANY_DATE, refundOverdue: !!x.refundOverdue });
                }} />
              <GridColumnChooser cols={cols} prefs={prefs} onChange={setPrefs} />
              <button type="button" className={GRID_BTN} onClick={runExport} disabled={exporting || total === 0} title="Export to Excel">
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
          </div>

          <CrmGrid cols={cols} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(c) => c.Id}
            loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
            sort={s.sort} onSort={s.toggleSort} onRowClick={(c) => setIdParam(String(c.Id))} activeKey={openId}
            selected={selected} onSelect={setSelected}
            empty={filtered ? "No cancellation matches these filters." : "No cancellation requests yet."}
            page={s.page} pageSize={pageSize} total={total} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
        </div>

        {openId != null && <CancellationRecord key={openId} id={openId} canEdit={rights.canEdit} onChanged={refreshAll} />}
      </CrmAppPage>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-md p-5 gap-4">
          <DialogHeader><DialogTitle>Request cancellation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={cn("block font-medium", GRID_LABEL)}>Booking <span className="text-destructive">*</span></label>
              <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))} className={cn(GRID_INPUT, "h-9 text-sm")}>
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName}${b.UnitNo ? ` (${b.UnitNo})` : ""}`}</option>
                ))}
              </SearchableNativeSelect>
            </div>

            {/* The policy slab for this booking, so any override is a deliberate choice. */}
            {form.BookingId && (
              <div className={cn("rounded-md border px-3 py-2.5 text-xs space-y-1", policy ? "border-primary/30 bg-primary/5" : "border-border bg-muted/40")}>
                <div className="flex items-center gap-1.5 font-semibold">
                  <Info size={12} className="text-primary" />
                  {policyLoading ? "Loading the cancellation policy…" : policy ? "Cancellation policy" : "No policy configured — the system default applies"}
                </div>
                {!policyLoading && policy && (
                  <>
                    <p>{policy.PolicyName || "Policy"} · <span className="tabular-nums">{policy.daysSinceBooking}</span> day{policy.daysSinceBooking !== 1 ? "s" : ""} since booking</p>
                    <p className="tabular-nums">
                      Slab {policy.DaysFromBookingMin ?? 0}–{policy.DaysFromBookingMax != null ? policy.DaysFromBookingMax : "∞"} days → <span className="font-bold">{Number(policy.DeductionPercent)}% deduction</span>
                    </p>
                    {policy.Notes && <p className="text-muted-foreground italic">{policy.Notes}</p>}
                    {policy.source === "default" && <p className="text-muted-foreground">The global default (no policy for this project).</p>}
                  </>
                )}
              </div>
            )}

            <div className="space-y-1">
              <label className={cn("block font-medium", GRID_LABEL)}>
                Cancellation charge (%)
                {overriding && <span className="ml-2 text-destructive">overriding the policy ({Number(policy.DeductionPercent)}%)</span>}
              </label>
              <input type="number" min={0} max={100} step="0.01" value={form.DeductionPercent}
                placeholder={policyLoading ? "Loading…" : "Leave blank to apply the policy"}
                onChange={(e) => setForm((f) => ({ ...f, DeductionPercent: e.target.value }))}
                className={cn(GRID_INPUT, "h-9 text-sm tabular-nums", overriding && "border-destructive")} />
            </div>
            <div className="space-y-1">
              <label className={cn("block font-medium", GRID_LABEL)}>Reason <span className="text-destructive">*</span></label>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} rows={3}
                className={cn(GRID_INPUT, "h-auto py-2 text-sm resize-none")} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button type="button" onClick={closeDialog} className={cn(GRID_BTN, "h-9 px-4")}>Cancel</button>
            <button type="button" onClick={handleRequest} disabled={saving} className={cn(GRID_BTN_BRAND, "h-9 px-4")}>{saving ? "Submitting…" : "Submit request"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CrmCancellations;
