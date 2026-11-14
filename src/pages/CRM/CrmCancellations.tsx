// CRM Cancellations: a request to cancel a booking. One list; one page per request with the money first, its four
// steps, the one next action, and its approval, money, refund and details below. Requested → approved (the booking is
// cancelled and the whole paid amount is held as credit) → refunded or re-booked from Refunds. Before approval it can be
// corrected, or withdrawn with a reason. The server decides every rule.
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
import { ArrowLeft, ArrowRight, Download, FileText, Home, Info, PenLine, Plus, RefreshCw, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFields, GridFormField, GridFormSection, GridRelated, GridSearch, GridStatusPill, GridTabs, GridToggleChip,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, asName, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";

const API = "/api/crm/cancellations";
const PREFS_KEY = "crm-cancellations-grid-v2";
const ALL = "All";
const DEFAULT_SORT: CrmSort = { key: "CreatedAt", dir: "desc" };

// The tabs. The money side moved to Refunds, so a request ends at Approved (or Rejected / Withdrawn).
const STATUSES = ["Pending", "Approved", "Rejected", "Withdrawn"];
const TAB_LABEL: Record<string, string> = { Pending: "Awaiting approval" };
const statusText = (s: string) => (s === "FinancePending" ? "With Finance" : s);
// Before approval a request can be corrected, or withdrawn with a reason.
const CORRECTABLE = ["Pending", "Rejected"];

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
async function putJson(url: string, body?: object) {
  const r = await fetchWithAuth(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error);
  return d;
}

/** What a refund nets: the paid amount less the deduction, which is taken only if the customer takes a refund. */
const deductionOf = (r: any) => Math.round(Number(r.AmountPaidTillDate || 0) * Number(r.DeductionPercent || 0)) / 100;
const netOf = (r: any) => Math.max(0, round2(Number(r.AmountPaidTillDate || 0) - deductionOf(r)));
const approvedLike = (s: string) => s === CrmStatus.APPROVED || s === "Cancelled" || s === "FinancePending" || s === "Refunded";

/** The request's four steps as the shared bar: requested, approval, held credit, refund or re-booking. */
function cancellationBar(c: any): { label: string; state: StepState }[] {
  const dropped = c.Status === CrmStatus.REJECTED || c.Status === "Withdrawn";
  const approved = approvedLike(c.Status);
  const held = c.HeldOnAccountId != null;
  const settled = c.SettlementStatus === "Settled";
  return [
    { label: "Requested", state: "done" },
    { label: "Approval", state: approved ? "done" : dropped ? "stopped" : "active" },
    { label: "Held credit", state: held ? "done" : approved ? "active" : "off" },
    { label: "Refund or re-booking", state: settled ? "done" : held && !dropped ? "active" : "off" },
  ];
}

/** The policy slab for a booking, so any override of the charge is a deliberate choice. */
function PolicyCard({ policy, loading }: { policy: any | null; loading: boolean }) {
  const noCharge = policy?.source === "default" && Number(policy.DeductionPercent) === 0;
  return (
    <div className={cn("rounded-md border px-3 py-2.5 text-xs space-y-1", policy ? "border-primary/30 bg-primary/5" : "border-border bg-muted/40")}>
      <div className="flex items-center gap-1.5 font-semibold">
        <Info size={12} className="text-primary" />
        {loading ? "Loading the cancellation policy…" : noCharge ? "No policy for this booking: no charge (0%)" : policy ? "Cancellation policy" : "No policy configured — the system default applies"}
      </div>
      {!loading && policy && !noCharge && (
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
  );
}
/** The charge field with its policy card: shared by the request and the correction. */
function useBookingPolicy(bookingId: string) {
  const [policy, setPolicy] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!bookingId) { setPolicy(null); return; }
    let cancelled = false;
    setLoading(true);
    fetchCancellationPolicy(bookingId).then((p) => { if (!cancelled) setPolicy(p); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId]);
  return { policy, loading };
}
function ChargeField({ value, onChange, policy, loading }: { value: string; onChange: (v: string) => void; policy: any | null; loading: boolean }) {
  const overriding = policy && value !== "" && value !== String(Number(policy.DeductionPercent));
  return (
    <GridFormField label="Cancellation charge (%)" hint={overriding ? `overriding the policy (${Number(policy.DeductionPercent)}%)` : undefined}>
      <input type="number" min={0} max={100} step="0.01" value={value}
        placeholder={loading ? "Loading…" : "Leave blank to apply the policy"}
        onChange={(e) => onChange(e.target.value)}
        className={cn(GRID_INPUT, "tabular-nums", overriding && "border-destructive")} />
    </GridFormField>
  );
}

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (c) => c.ApplicantName, cell: (c) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate max-w-[16rem]" title={c.ApplicantName}>{asName(c.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{c.CancellationNo} · {c.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Project · unit", sortKey: "ProjectName", csv: (c) => [c.ProjectName, c.UnitNo].filter(Boolean).join(" · "),
    cell: (c) => <span className="truncate block max-w-[14rem]">{[c.ProjectName, c.UnitNo].filter(Boolean).join(" · ") || "—"}</span> },
  { id: "progress", label: "Progress", csv: (c) => statusText(c.Status), cell: (c) => <span className="block min-w-[15rem] py-1.5"><StepBar steps={cancellationBar(c)} /></span> },
  { id: "status", label: "Status", sortKey: "Status", csv: (c) => statusText(c.Status), cell: (c) => <GridStatusPill status={c.Status} label={statusText(c.Status)} /> },
  { id: "paid", label: "Paid till date", sortKey: "AmountPaidTillDate", align: "right", csv: (c) => c.AmountPaidTillDate, cell: (c) => <span className="tabular-nums">{fmt(c.AmountPaidTillDate)}</span> },
  { id: "charge", label: "Charge if refunded", sortKey: "DeductionPercent", align: "right", csv: (c) => deductionOf(c),
    cell: (c) => <span className="tabular-nums" title="Deducted only if the customer takes a refund; a re-booking keeps the full amount">{Number(c.DeductionPercent)}% · {fmt(deductionOf(c))}</span> },
  { id: "net", label: "Refund if taken", align: "right", csv: (c) => netOf(c),
    cell: (c) => <span className="tabular-nums font-semibold" title={`The full ${fmt(c.AmountPaidTillDate)} is held as credit; a re-booking uses all of it`}>{fmt(netOf(c))}</span> },
  { id: "requested", label: "Requested", sortKey: "RequestedDate", csv: (c) => dt(c.RequestedDate), cell: (c) => <span className="tabular-nums">{dt(c.RequestedDate)}</span> },
  // In the export only.
  ...([
    ["no", "Cancellation", (c: any) => c.CancellationNo], ["booking", "Booking", (c: any) => c.BookingNo], ["mobile", "Mobile", (c: any) => c.Mobile],
    ["pct", "Deduction %", (c: any) => Number(c.DeductionPercent)], ["by", "Requested by", (c: any) => c.RequestedByName], ["reason", "Reason", (c: any) => c.Reason],
  ] as [string, string, (c: any) => unknown][]).map(([id, label, csv]): GridCol<any> => ({ id, label, hiddenByDefault: true, csv, cell: () => null })),
];

// ── One request ────────────────────────────────────────────────────────────────
const CancellationRecord: React.FC<{ id: number; canEdit: boolean; onBack: () => void; onEdit: (c: any, thenSubmit?: boolean) => void; onWithdraw: (c: any) => void }> = ({ id, canEdit, onBack, onEdit, onWithdraw }) => {
  const navigate = useNavigate();
  const { data: c, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-cancellation", id], queryFn: () => fetchCancellation(id), staleTime: 15_000, retry: false });
  if (isLoading) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>;
  if (isError || !c) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{(error as Error)?.message || "Could not load this cancellation."}</div>;

  const heldBalance = c.HeldOnAccountId != null ? Math.max(0, round2(Number(c.HeldAmount || 0) - Number(c.HeldApplied || 0))) : null;
  const editable = canEdit && CORRECTABLE.includes(c.Status);
  const go = (key: string) => () => document.getElementById(`cx-${key}`)?.scrollIntoView({ block: "start" });

  // Where it stands, and the one action that moves it on.
  let next = ""; let action: { label: string; run: () => void } | null = null; let finished = false;
  if (c.Status === CrmStatus.PENDING) { next = "Waiting for approval (Approval Inbox). The booking stays active until it is approved."; action = { label: "Go to Approval", run: go("approval") }; }
  else if (c.Status === CrmStatus.REJECTED) { next = `Rejected${c.RejectionNote ? `: ${c.RejectionNote}` : ""}. Correct it, then send it again.`; action = editable ? { label: "Correct and Send Again", run: () => onEdit(c, true) } : null; }
  else if (c.Status === "Withdrawn") { next = `Withdrawn${c.RejectionNote ? `: ${c.RejectionNote}` : ""}. The booking stays active; a new request can be raised.`; finished = true; }
  else if (approvedLike(c.Status)) {
    if (c.RefundId != null) { next = `Approved: refund ${c.RefundNo} is ${c.RefundStatus}.`; action = { label: "Open Refund", run: () => navigate(`/crm/refunds?id=${c.RefundId}`) }; }
    else { next = `Approved: ${fmt(heldBalance ?? c.AmountPaidTillDate)} is held as credit. Refund it or use it for a new booking in Refunds.`; action = { label: "Open Refunds", run: () => navigate("/crm/refunds") }; }
    finished = c.SettlementStatus === "Settled";
  }

  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Cancellation · ${c.CancellationNo}`} title={<span className="capitalize">{asName(c.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(c.Status)}</span>}
        sub={[c.BookingNo, c.ProjectName, c.UnitNo].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All Cancellations</button>
          <button type="button" onClick={() => navigate(`/crm/bookings?view=${c.BookingId}`)} className={BAND_KEY}><Home size={13} /> Open Booking</button>
          {editable && <button type="button" onClick={() => onEdit(c)} className={BAND_KEY}><PenLine size={13} /> Edit Details</button>}
          {editable && <button type="button" onClick={() => onWithdraw(c)} className={cn(BAND_KEY, "!text-rose-300")}><XCircle size={13} /> Withdraw</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(Number(c.AmountPaidTillDate || 0))} leadNote="Paid till date"
        bar={<StepBar steps={cancellationBar(c)} onDark />}
        figures={[
          { label: `Deduction (${Number(c.DeductionPercent)}%)`, value: fmtShort(deductionOf(c)), exact: fmt(deductionOf(c)), note: "only if refunded" },
          { label: "Refund if taken", dot: BAND_DOT.collected, value: fmtShort(netOf(c)), exact: fmt(netOf(c)), note: "" },
          { label: "Held credit", dot: BAND_DOT.finance, value: c.HeldOnAccountId != null ? fmtShort(Number(c.HeldAmount || 0)) : "—", exact: c.HeldOnAccountId != null ? fmt(c.HeldAmount) : undefined, note: c.HeldOnAccountId != null ? `${fmt(heldBalance)} left` : "Not parked yet" },
          { label: "Refund", dot: c.IsRefundOverdue ? BAND_DOT.overdue : undefined, value: c.RefundNo || "—", note: c.RefundId != null ? (c.SettlementStatus === "Settled" ? "Settled" : c.RefundStatus) : "", alert: !!c.IsRefundOverdue },
        ]}
        footer={<BandNext text={next} finished={finished} action={action} />} />

      <div id="cx-approval" className="scroll-mt-4">
        <GridRelated icon={ShieldCheck} title="Approval history">
          <div className="px-4 py-3 space-y-3 text-xs">
            {c.Status === CrmStatus.PENDING && <div className="flex flex-wrap items-center gap-2"><ApprovalActions status={c.Status} recordId={c.Id} endpoint={API} module="crm-cancellations" onSuccess={() => refetch()} /></div>}
            {c.Status === CrmStatus.REJECTED && canEdit && <div className="flex flex-wrap items-center gap-2"><ApprovalActions status={c.Status} recordId={c.Id} endpoint={API} submitOnly onSuccess={() => refetch()} /></div>}
            <ApprovalTrailTimeline table="CrmCancellation" recordId={c.Id} refreshKey={c.UpdatedAt}
              empty={<span className="text-muted-foreground">{c.Status === CrmStatus.PENDING ? "Waiting in the Approval Inbox. No level has acted yet." : "No approval steps recorded."}</span>} />
          </div>
        </GridRelated>
      </div>

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
        action={c.RefundId != null ? <button type="button" className={GRID_BTN} onClick={() => navigate(`/crm/refunds?id=${c.RefundId}`)}>Open Refund</button> : undefined}>
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
          ...(c.Status === CrmStatus.REJECTED && c.RejectionNote ? [{ label: "Rejection reason", value: <span className="whitespace-pre-line">{c.RejectionNote}</span>, wide: true }] : []),
          ...(c.Notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{c.Notes}</span>, wide: true }] : []),
          { label: "Customer", value: <ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /> },
          { label: "Mobile", value: <span className="tabular-nums">{c.Mobile || "—"}</span> },
          { label: "Booking", value: <span className="tabular-nums">{c.BookingNo}</span> },
          { label: "Requested by", value: c.RequestedByName || "—" },
          { label: approvedLike(c.Status) ? "Approved by" : "Approver", value: c.ApprovedByName ? `${c.ApprovedByName}${c.ApprovedAt ? ` · ${dt(c.ApprovedAt)}` : ""}` : "—" },
          { label: "Last updated", value: <span className="tabular-nums">{c.UpdatedAt ? new Date(c.UpdatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span> },
        ]} />
      </GridRelated>

      <section className={cn(GRID_CARD, "px-4 py-3 text-xs text-muted-foreground flex gap-2")}>
        <Info size={14} className="shrink-0 mt-0.5 text-primary" />
        <p>On approval the whole paid amount is held as credit. The deduction is taken only if the customer takes a refund; a re-booking uses all of it.</p>
      </section>
    </div>
  );
};

/** Correct a request before approval: the reason and the charge. After a rejection it is then sent again. */
function EditDialog({ c, thenSubmit, onClose, onDone }: { c: any; thenSubmit: boolean; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<string>(c.Reason || "");
  const [pct, setPct] = useState<string>(c.DeductionPercent != null ? String(Number(c.DeductionPercent)) : "");
  const [saving, setSaving] = useState(false);
  const { policy, loading } = useBookingPolicy(String(c.BookingId));
  const save = async () => {
    if (!reason.trim()) return void toast.error("Give the reason for the cancellation");
    const n = pct !== "" ? parseFloat(pct) : undefined;
    if (n != null && (!(n >= 0) || n > 100)) return void toast.error("The charge must be between 0 and 100%");
    setSaving(true);
    try {
      await putJson(`${API}/${c.Id}`, { Reason: reason.trim(), ...(n != null ? { DeductionPercent: n } : {}) });
      if (thenSubmit) await putJson(`${API}/${c.Id}/submit`);
      onDone(); onClose();
    } catch (e: any) { toast.error(translateError(e.message)); onDone(); }
    finally { setSaving(false); }
  };
  return (
    <GridDialog onClose={onClose} icon={PenLine} width="max-w-2xl" title="Edit Cancellation Request" description={`${c.CancellationNo} · ${personName(c.ApplicantName)} · ${c.BookingNo}`}
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={save} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : thenSubmit ? "Save and Send Again" : "Save Details"}</button></>}>
      {c.Status === CrmStatus.REJECTED && c.RejectionNote && <p className="mb-3 text-sm rounded-md px-3 py-2 border border-destructive/40 text-destructive"><strong>Rejection reason:</strong> {c.RejectionNote}</p>}
      <GridFormSection>
        <GridFormField label="Reason" required wide><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
        <ChargeField value={pct} onChange={setPct} policy={policy} loading={loading} />
        <GridFormField label="" wide><PolicyCard policy={policy} loading={loading} /></GridFormField>
      </GridFormSection>
    </GridDialog>
  );
}

// ── Cancellation Policy ────────────────────────────────────────────────────────
// The slabs: for one project or all, a days-since-booking range, the charge % and the refund due days. The server
// decides which slab applies (crmCancellations.js resolveCancellationPolicy) and checks every slab it is sent.
const daysRange = (x: any) => (x.DaysFromBookingMax == null ? `${x.DaysFromBookingMin} and more` : `${x.DaysFromBookingMin}–${x.DaysFromBookingMax}`);
const EMPTY_SLAB = { ProjectId: "", PolicyName: "", DaysFromBookingMin: "0", DaysFromBookingMax: "", DeductionPercent: "", RefundDueDays: "", Notes: "" };
function PolicyScreen({ canEdit, onBack }: { canEdit: boolean; onBack: () => void }) {
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-cancellation-policies"],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/policies`); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d?.error); return d as { rows: any[]; defaults: { refundDueDays: number; deductionPercent: number } }; },
  });
  const { data: dropdown } = useQuery({ queryKey: ["crm-business-dropdown"], queryFn: async () => { const r = await fetchWithAuth("/api/business/dropdown"); return r.ok ? r.json() : { projects: [] }; }, staleTime: 5 * 60_000 });
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_SLAB });
  const [saving, setSaving] = useState(false);
  const rows = data?.rows ?? [];
  const def = data?.defaults ?? { refundDueDays: 0, deductionPercent: 0 };
  const active = rows.filter((x) => x.IsActive);
  const ownProjects = new Set(active.filter((x) => x.ProjectId != null).map((x) => x.ProjectId)).size;
  const open = (x: any | null) => {
    setEditing(x ?? {});
    setForm(x ? { ProjectId: x.ProjectId != null ? String(x.ProjectId) : "", PolicyName: x.PolicyName || "", DaysFromBookingMin: String(x.DaysFromBookingMin ?? 0),
      DaysFromBookingMax: x.DaysFromBookingMax != null ? String(x.DaysFromBookingMax) : "", DeductionPercent: String(Number(x.DeductionPercent)),
      RefundDueDays: x.RefundDueDays != null ? String(x.RefundDueDays) : "", Notes: x.Notes || "" } : { ...EMPTY_SLAB });
  };
  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, ProjectId: form.ProjectId || null };
      const url = editing?.Id ? `${API}/policies/${editing.Id}` : `${API}/policies`;
      const r = await fetchWithAuth(url, { method: editing?.Id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error);
      setEditing(null); refetch();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const toggle = async (x: any) => {
    try { await putJson(`${API}/policies/${x.Id}`, { IsActive: !x.IsActive }); refetch(); }
    catch (e: any) { toast.error(translateError(e.message)); }
  };
  const cols: GridCol<any>[] = [
    { id: "name", label: "Slab", locked: true, cell: (x) => <span className="block py-1.5"><span className="block font-semibold">{x.PolicyName}</span>{x.Notes && <span className="block text-xs text-muted-foreground truncate max-w-[18rem]">{x.Notes}</span>}</span> },
    { id: "project", label: "Project", cell: (x) => x.ProjectName || "All projects" },
    { id: "days", label: "Days since booking", cell: (x) => <span className="tabular-nums">{daysRange(x)}</span> },
    { id: "charge", label: "Charge", align: "right", cell: (x) => <span className="tabular-nums">{Number(x.DeductionPercent)}%</span> },
    { id: "due", label: "Refund due", cell: (x) => <span className="tabular-nums">{x.RefundDueDays != null ? `${x.RefundDueDays} days` : `${def.refundDueDays} days (default)`}</span> },
    { id: "status", label: "Status", cell: (x) => <GridStatusPill status={x.IsActive ? "Active" : "Inactive"} label={x.IsActive ? "Active" : "Off"} /> },
    { id: "act", label: "", align: "right", cell: (x) => canEdit ? (
      <span className="inline-flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => open(x)} className={cn(GRID_BTN, "h-7")}>Edit</button>
        <button type="button" onClick={() => toggle(x)} className={cn(GRID_BTN, "h-7")}>{x.IsActive ? "Switch Off" : "Switch On"}</button>
      </span>
    ) : null },
  ];
  const [prefs, setPrefs] = useGridPrefs("crm-cancellation-policy-cols", cols);
  const set = (k: keyof typeof EMPTY_SLAB) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow="CRM · After-sales" title="Cancellation Policy"
        sub="The charge kept if a cancelled customer takes a refund, and the days the refund is due in, by how long after booking the cancellation comes. A request keeps the figures it was raised with."
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All Cancellations</button>
          {canEdit && <button type="button" onClick={() => open(null)} className={BAND_KEY_MAIN}><Plus size={13} /> Add Slab</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={String(active.length)} leadNote="Active slabs" bar={<span />}
        figures={[
          { label: "Projects with their own slabs", value: String(ownProjects), note: "" },
          { label: "Default charge", value: `${def.deductionPercent}%`, note: "" },
          { label: "Default refund due", value: `${def.refundDueDays} days`, note: "" },
        ]} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <CrmGrid cols={cols} prefs={prefs} onPrefs={setPrefs} rows={rows} rowKey={(x) => x.Id} noRowNumbers
          loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
          sort={{ key: "", dir: "asc" }} onSort={() => {}} onRowClick={canEdit ? (x) => open(x) : undefined}
          empty={`No slabs yet: every request is charged ${def.deductionPercent}% and its refund is due in ${def.refundDueDays} days.`}
          page={1} pageSize={Math.max(rows.length, 1)} total={rows.length} onPage={() => {}} onPageSize={() => {}} />
      </div>
      {editing && (
        <GridDialog onClose={() => setEditing(null)} icon={FileText} width="max-w-2xl" title={editing.Id ? "Edit Slab" : "Add Slab"}
          footer={<><button type="button" onClick={() => setEditing(null)} className={GRID_BTN}>Cancel</button><button type="button" onClick={save} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : "Save Slab"}</button></>}>
          <GridFormSection>
            <GridFormField label="Name" required wide><input value={form.PolicyName} onChange={set("PolicyName")} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Project" wide hint="Blank = All projects">
              <select value={form.ProjectId} onChange={set("ProjectId")} className={GRID_INPUT}>
                <option value="">All projects</option>
                {((dropdown?.projects ?? []) as any[]).map((pr) => <option key={pr.id} value={String(pr.id)}>{pr.name}</option>)}
              </select>
            </GridFormField>
            <GridFormField label="Days since booking: from" required><input type="number" min={0} value={form.DaysFromBookingMin} onChange={set("DaysFromBookingMin")} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="to" hint="Blank = no end"><input type="number" min={0} value={form.DaysFromBookingMax} onChange={set("DaysFromBookingMax")} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Charge (%)" required><input type="number" min={0} max={100} step="0.01" value={form.DeductionPercent} onChange={set("DeductionPercent")} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Refund due (days)" hint={`Blank = ${def.refundDueDays}`}><input type="number" min={1} max={365} value={form.RefundDueDays} onChange={set("RefundDueDays")} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Notes" wide><textarea value={form.Notes} onChange={set("Notes")} rows={2} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
const CrmCancellations: React.FC = () => {
  const rights = usePageRights("crm-cancellations");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingIdParam = searchParams.get("bookingId") || "";
  // The open request lives in the address (?id=), so a refresh, a shared link or the Approval Inbox lands on it.
  const [idParam, setIdParam] = useUrlParam("id");
  // The Cancellation Policy screen (?view=policy).
  const [viewParam, setViewParam] = useUrlParam("view");
  const openId = Number(idParam) > 0 ? Number(idParam) : null;
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const s = useCrmListState({ pageSize, defaultSort: DEFAULT_SORT, defaultStatus: ALL });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ BookingId: "", Reason: "", DeductionPercent: "" });
  const { policy, loading: policyLoading } = useBookingPolicy(form.BookingId);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setExtra = (x: Partial<ExtraFilters>) => { setExtraRaw((cur) => ({ ...cur, ...x })); s.setPage(1); };
  const filtered = s.hasFilters || extra.requested.preset !== "any" || extra.refundOverdue;
  const [editing, setEditing] = useState<{ c: any; thenSubmit: boolean } | null>(null);
  const [withdrawing, setWithdrawing] = useState<any | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bookingIdParam && rights.canCreate) {
      setForm((f) => ({ ...f, BookingId: bookingIdParam }));
      setDialogOpen(true);
      setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete("bookingId"); return next; }, { replace: true });
    }
  }, [bookingIdParam, setSearchParams, rights.canCreate]);
  // The policy's charge is filled in when a booking is picked; staff can still override it.
  useEffect(() => { setForm((f) => ({ ...f, DeductionPercent: policy?.DeductionPercent != null ? String(Number(policy.DeductionPercent)) : "" })); }, [policy]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["crm-cancellations", s.query, extra], queryFn: () => fetchCancellationsList(s.query, extra), staleTime: 30_000, enabled: openId == null && viewParam !== "policy" });
  const result = useSticky(data);
  const counts = result?.statusCounts ?? {};
  const allCount = Object.values(counts).reduce((n, x) => n + x, 0);
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-cancellation-bookings"], queryFn: fetchBookings, staleTime: 60_000, enabled: dialogOpen });
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, COLS);

  const refreshAll = () => {
    ["crm-cancellations", "crm-cancellation", "crm-cancellation-bookings", "crm-booking-lifecycle", "crm-dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const runExport = async () => {
    setExporting(true);
    try { exportGrid(await fetchAllCancellations(s.query, extra), COLS, `cancellations-${s.status.toLowerCase()}`); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const closeDialog = () => { setDialogOpen(false); setForm({ BookingId: "", Reason: "", DeductionPercent: "" }); };
  const handleRequest = async () => {
    if (!form.BookingId) { toast.error("Booking is required"); return; }
    if (!form.Reason.trim()) { toast.error("Give the reason for the cancellation"); return; }
    const pct = form.DeductionPercent !== "" ? parseFloat(form.DeductionPercent) : undefined;
    if (pct != null && (!(pct >= 0) || pct > 100)) { toast.error("The charge must be between 0 and 100%"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ BookingId: parseInt(form.BookingId), Reason: form.Reason.trim() || undefined, DeductionPercent: pct }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message || d.error);
      toast.success(`Cancellation requested — ${fmt(d.refundAmt)} will be held as credit (deduction only if refunded)`);
      closeDialog();
      refreshAll();
      if (d.id) setIdParam(String(d.id));
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const doWithdraw = async () => {
    setBusy(true);
    try { await putJson(`${API}/${withdrawing.Id}/withdraw`, { reason: withdrawReason.trim() }); setWithdrawing(null); refreshAll(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };

  const tabs = [ALL, ...STATUSES].map((k) => ({ key: k, label: k === ALL ? "All" : TAB_LABEL[k] ?? statusText(k), count: result ? (k === ALL ? allCount : counts[k] ?? 0) : null }));
  const dropped = (counts.Rejected ?? 0) + (counts.Withdrawn ?? 0);

  return (
    <div className="space-y-4">
      <Breadcrumbs items={openId ? ["Dashboard", "CRM", "Cancellations", "Record"] : ["Dashboard", "CRM", "Cancellations"]} />
      {viewParam === "policy" ? (
        <PolicyScreen canEdit={rights.canEdit} onBack={() => setViewParam("")} />
      ) : openId != null ? (
        <CancellationRecord key={openId} id={openId} canEdit={rights.canEdit} onBack={() => setIdParam("")}
          onEdit={(c, thenSubmit) => setEditing({ c, thenSubmit: !!thenSubmit })} onWithdraw={(c) => { setWithdrawing(c); setWithdrawReason(""); }} />
      ) : (
        <>
          <MoneyBand eyebrow="CRM · After-sales" title="Cancellations"
            sub="On approval the paid amount is held as credit; the policy's deduction is taken only if the customer takes a refund. Refunds and re-bookings carry on in Refunds."
            actions={<>
              <button type="button" onClick={() => setViewParam("policy")} className={BAND_KEY}><FileText size={13} /> Cancellation Policy</button>
              {rights.canCreate && <button type="button" onClick={() => setDialogOpen(true)} className={BAND_KEY_MAIN}><XCircle size={13} /> Request Cancellation</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={fmtShort(result?.summary.paidTillDate ?? 0)} leadNote="Paid till date"
            bar={<CollectionBar onDark due={allCount} collected={counts.Approved ?? 0} finance={counts.Pending ?? 0} recorded={0} />}
            figures={[
              { label: "Awaiting approval", dot: BAND_DOT.finance, value: String(counts.Pending ?? 0), note: "" },
              { label: "Approved", dot: BAND_DOT.collected, value: String(counts.Approved ?? 0), note: "" },
              { label: "Refunds overdue", dot: BAND_DOT.overdue, value: String(result?.summary.refundsOverdue ?? 0), note: "", alert: (result?.summary.refundsOverdue ?? 0) > 0 },
              { label: "Rejected or withdrawn", value: String(dropped), note: "" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs label="Status" tabs={tabs} active={s.status} onChange={s.setStatus} />
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
              <GridSearch value={s.searchInput} onChange={s.setSearchInput} placeholder="Search customer, booking, cancellation no." />
              <CrmCompanyProjectBlockFilter value={s.cpb} onChange={s.setCpb} />
              <GridDateFilter label="Requested" value={extra.requested} onChange={(v) => setExtra({ requested: v })} />
              <GridToggleChip label="Refunds overdue" on={extra.refundOverdue} onChange={(on) => setExtra({ refundOverdue: on })} count={extra.refundOverdue ? null : result?.summary.refundsOverdue ?? null} />
              {filtered && <button type="button" onClick={() => { s.reset(); setExtraRaw(NO_EXTRA); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" className={cn(GRID_BTN, "ml-auto")} onClick={runExport} disabled={exporting || !(result?.total)} title="Export to Excel">
                <Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span>
              </button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={result?.rows ?? []} rowKey={(c) => c.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={error ? (error as Error).message : null} onRetry={() => refetch()}
              sort={s.sort} onSort={s.toggleSort} onRowClick={(c) => setIdParam(String(c.Id))}
              empty={filtered ? "No cancellation matches these filters." : "No cancellation requests yet."}
              page={s.page} pageSize={pageSize} total={result?.total ?? 0} onPage={s.setPage} onPageSize={(n) => { setPageSize(n); s.setPage(1); }} />
          </div>
        </>
      )}

      {dialogOpen && (
        <GridDialog onClose={closeDialog} icon={XCircle} width="max-w-2xl" title="Request Cancellation"
          footer={<><button type="button" onClick={closeDialog} className={GRID_BTN}>Cancel</button><button type="button" onClick={handleRequest} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Submitting…" : "Submit Request"}</button></>}>
          <GridFormSection>
            <GridFormField label="Booking" required wide>
              <SearchableNativeSelect value={form.BookingId} onChange={(e) => setForm((f) => ({ ...f, BookingId: e.target.value }))} className={GRID_INPUT}>
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} — ${b.ApplicantName}${b.UnitNo ? ` (${b.UnitNo})` : ""}`}</option>)}
              </SearchableNativeSelect>
            </GridFormField>
            {form.BookingId && <GridFormField label="" wide><PolicyCard policy={policy} loading={policyLoading} /></GridFormField>}
            <ChargeField value={form.DeductionPercent} onChange={(v) => setForm((f) => ({ ...f, DeductionPercent: v }))} policy={policy} loading={policyLoading} />
            <GridFormField label="Reason" required wide>
              <textarea value={form.Reason} onChange={(e) => setForm((f) => ({ ...f, Reason: e.target.value }))} rows={3} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}

      {editing && <EditDialog c={editing.c} thenSubmit={editing.thenSubmit} onClose={() => setEditing(null)} onDone={refreshAll} />}

      {withdrawing && (
        <GridDialog onClose={() => setWithdrawing(null)} icon={XCircle} width="max-w-xl" title="Withdraw Cancellation Request" description={`${withdrawing.CancellationNo} · ${personName(withdrawing.ApplicantName)} · ${withdrawing.BookingNo}`}
          footer={<><button type="button" onClick={() => setWithdrawing(null)} className={GRID_BTN}>Keep It</button><button type="button" onClick={doWithdraw} disabled={busy || !withdrawReason.trim()} className={cn(GRID_BTN_BRAND, "!bg-destructive !border-destructive")}>{busy ? "Withdrawing…" : "Withdraw Request"}</button></>}>
          <p className="mb-3 text-sm text-muted-foreground">The request stays on record as Withdrawn and can't be sent or approved again. The booking stays active.</p>
          <GridFormField label="Why it is withdrawn" required wide>
            <textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} autoFocus className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmCancellations;
