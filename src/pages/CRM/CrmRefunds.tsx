// CRM Refunds: money given back to a customer, a cancelled booking's held credit or an overpayment. One list; one page per
// refund with the money first, its five steps, the one next action, and its approval, payout and GST papers below.
// Raised (or made as a draft by a cancellation) → sent for CRM approval → approved, which raises the payout voucher →
// Finance approves the voucher in Payments → Paid. The server decides every rule.
import React, { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { useCanApprove } from "@/hooks/useCanApprove";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ArrowLeft, ArrowRightLeft, Banknote, Download, ExternalLink, FileText, History, Landmark, PenLine, Plus, RefreshCw, ShieldCheck, Undo2, Wallet, XCircle } from "lucide-react";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFacts, GridFormField, GridFormSection, GridMiniTable, GridRelated, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, Initials, MoneyBand, StepBar, asName, personName, type StepState } from "./payments/parts";
import { fmtDate, fmtShort, pct } from "./payments/config";
import { findBank } from "@/components/crm/SelectedBankCard";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { useUrlParam } from "@/hooks/useUrlParam";

const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PREFS_KEY = "crm-refunds-cols-v2";
const REFUNDS_DEFAULT_SORT: CrmSort = { key: "", dir: "desc" };
const { RULE_SOFT } = GRID_SHEET_KEYS;
const REFUND_TABS = [
  { key: "All", label: "All refunds" }, { key: "CRM", label: "With CRM" }, { key: "Voucher", label: "Voucher not raised" }, { key: "FinanceApproved", label: "With Finance" },
  { key: "Paid", label: "Paid" }, { key: "Rejected", label: "Rejected" }, { key: "Withdrawn", label: "Withdrawn" }, { key: "Overdue", label: "RERA overdue" },
];
// What each status means to a reader.
const STATUS_LABEL: Record<string, string> = {
  Draft: "Not sent yet",
  Pending: "Awaiting CRM approval",
  Approved: "Voucher not raised",
  FinancePending: "Voucher not raised",
  FinanceApproved: "With Finance",
};
const statusText = (s: string) => STATUS_LABEL[s] || s;
const SOURCE_LABEL: Record<string, string> = {
  CancellationHeldCredit: "Cancelled booking",
  OverpaymentOnAccount: "Overpayment",
  Manual: "Manual",
};
const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const cleanNote = (n?: string | null) => String(n || "").replace(/^\[[^\]]*\]\s*/, "");
// Before approval: it can be corrected, or withdrawn with a reason (Withdrawn is final, nothing is deleted).
const EDITABLE = ["Draft", "Pending", "Rejected"];
// Dropped refunds: they claim no money, so the band's totals leave them out.
const DROPPED = ["Rejected", "Withdrawn"];
const VOUCHER_NOT_RAISED = ["Approved", "FinancePending"];

type StatusCounts = Record<string, { count: number; net: number; gross: number; deduction: number; overdue: number }>;
async function getJson<T>(url: string, fallback: string): Promise<T> {
  const r = await fetchWithAuth(url);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || fallback);
  return d as T;
}
async function fetchList(params: URLSearchParams): Promise<{ rows: any[]; total: number; statusCounts: StatusCounts }> {
  const d = await getJson<any>(`${API}?${params}`, "Could not load the refunds.");
  return { rows: d.rows || [], total: d.total || 0, statusCounts: d.statusCounts || {} };
}
const fetchExport = async (params: URLSearchParams) => { const d = await getJson<any>(`${API}?${params}`, "Could not export the refunds."); return Array.isArray(d) ? d : []; };
const fetchRefund = (id: string) => getJson<any>(`${API}/${encodeURIComponent(id)}`, "Could not load this refund.");
const fetchRefundNotes = async (id: string) => { try { const d = await getJson<any>(`${API}/${encodeURIComponent(id)}/gst-notes`, ""); return Array.isArray(d) ? d : []; } catch { return []; } };
const fetchEligibleSources = async () => { const d = await getJson<any>(`${API}/eligible-sources`, "Could not load the held credits and overpayments."); return Array.isArray(d) ? d : []; };
const fetchPayModes = () => getJson<{ modes: string[]; transfer: string[] }>(`${API}/payment-modes`, "Could not load the payment modes.");
// excludeCash=1: a refund is always paid by bank transfer or cheque, never from Cash in Hand.
const fetchProjectBanks = async (projectId?: number | null) => {
  if (projectId == null) return [];
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}?excludeCash=1`); return r.ok ? r.json() : []; } catch { return []; }
};
const fetchBookings = async () => { try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; } };
// Every bank account on file for the booking's customer, to pick from; manual entry otherwise.
async function fetchCustomerBanks(bookingId?: number | null): Promise<any[]> {
  if (bookingId == null) return [];
  try {
    const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`);
    if (!r.ok) return [];
    const d = await r.json();
    if (Array.isArray(d)) return d;
    return d && (d.BankName || d.AccountNo) ? [d] : [];
  } catch { return []; }
}
const usePayModes = () => useQuery({ queryKey: ["crm-refund-pay-modes"], queryFn: fetchPayModes, staleTime: 60 * 60_000 });

const bankLabel = (b: any) => `${b.BName}${b.BBranch ? ` · ${b.BBranch}` : ""}${b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}`;
function BankNote({ bank }: { bank: any }) {
  if (!bank) return null;
  return (
    <span className="mt-1.5 block px-3 py-2 text-xs rounded-md" style={{ border: RULE_SOFT }}>
      <span className="block font-medium">{bank.BName}</span>
      <span className="mt-0.5 text-muted-foreground flex flex-wrap gap-x-2 tabular-nums">
        {bank.BBranch && <span>{bank.BBranch}</span>}
        {bank.BIfscCode && <span>IFSC {bank.BIfscCode}</span>}
        {bank.BAccountLast4 && <span>A/c ••{bank.BAccountLast4}</span>}
      </span>
    </span>
  );
}

/** The customer's account: one of the saved ones, or typed in. Shared by New Refund and Edit Details. */
function CustomerAccount({ bookingId, name, acc, ifsc, onChange, transfer }: {
  bookingId?: number | null; name: string; acc: string; ifsc: string; transfer: boolean;
  onChange: (v: { name: string; acc: string; ifsc: string }) => void;
}) {
  const { data: saved = [] } = useQuery({ queryKey: ["crm-refund-customer-banks", bookingId], queryFn: () => fetchCustomerBanks(bookingId), enabled: bookingId != null });
  const [manual, setManual] = useState(false);
  const pickedIdx = (saved as any[]).findIndex((b) => b.AccountNo && b.AccountNo === acc);
  const showManual = manual || !(saved as any[]).length;
  return (
    <span className="block space-y-2">
      {!showManual && (
        <select value={pickedIdx >= 0 ? String(pickedIdx) : ""} className={GRID_INPUT}
          onChange={(e) => {
            if (e.target.value === "manual") { setManual(true); onChange({ name: "", acc: "", ifsc: "" }); return; }
            const b = (saved as any[])[Number(e.target.value)];
            onChange(b ? { name: b.BankName || "", acc: b.AccountNo || "", ifsc: b.IfscCode || "" } : { name: "", acc: "", ifsc: "" });
          }}>
          <option value="">Select the customer's bank account…</option>
          {(saved as any[]).map((b, i) => <option key={i} value={String(i)}>{`${b.BankName || "—"}${b.BranchName ? ` · ${b.BranchName}` : ""} · A/c ${b.AccountNo ? `••${String(b.AccountNo).slice(-4)}` : "—"}${b.IfscCode ? ` · ${b.IfscCode}` : ""}`}</option>)}
          <option value="manual">Enter another account…</option>
        </select>
      )}
      {showManual && (
        <span className="block space-y-2">
          <BankNamePicker value={name} onChange={(v) => onChange({ name: v, acc, ifsc })} placeholder="Select the customer's bank…" otherPlaceholder="Bank name (if not listed)" sheet />
          <span className="grid grid-cols-2 gap-2">
            <input value={acc} onChange={(e) => onChange({ name, acc: e.target.value, ifsc })} placeholder="Account no." className={cn(GRID_INPUT, "tabular-nums")} />
            <input value={ifsc} onChange={(e) => onChange({ name, acc, ifsc: e.target.value.toUpperCase() })} placeholder="IFSC" className={cn(GRID_INPUT, "tabular-nums")} />
          </span>
          {(saved as any[]).length > 0 && <button type="button" onClick={() => setManual(false)} className="text-xs text-primary hover:underline">Pick a saved account</button>}
        </span>
      )}
      <span className="block text-xs text-muted-foreground">{transfer ? "Needed: the payout is a bank transfer." : "Needed only for an NEFT, RTGS, IMPS or UPI refund; a cheque needs none."}</span>
    </span>
  );
}

// ── New refund / re-booking credit ─────────────────────────────────────────

/** `bookingId`: opened from a booking with excess money, so only that booking's money is offered. */
function NewRefundDialog({ onClose, onDone, bookingId }: { onClose: () => void; onDone: (id?: number) => void; bookingId?: string | null }) {
  const [mode, setMode] = useState<"refund" | "rebook">("refund");
  const [picked, setPicked] = useState<any | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankLHeadId, setBankLHeadId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [acct, setAcct] = useState({ name: "", acc: "", ifsc: "" });
  const [toBookingId, setToBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: payModes } = usePayModes();

  const { data: sources = [], isLoading: sourcesLoading, isError: sourcesError, error: sourcesErr } = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: fetchEligibleSources });
  const offered = bookingId ? (sources as any[]).filter((x) => String(x.BookingId) === bookingId) : (sources as any[]);
  const { data: banks = [] } = useQuery({ queryKey: ["crm-refund-project-banks", picked?.ProjectId], queryFn: () => fetchProjectBanks(picked?.ProjectId), enabled: picked?.ProjectId != null });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, enabled: mode === "rebook", staleTime: 5 * 60_000 });
  const { data: savedAccounts = [] } = useQuery({ queryKey: ["crm-refund-customer-banks", picked?.BookingId], queryFn: () => fetchCustomerBanks(picked?.BookingId), enabled: picked?.BookingId != null });
  // One saved account: take it.
  useEffect(() => {
    if ((savedAccounts as any[]).length === 1) { const b = (savedAccounts as any[])[0]; setAcct({ name: b.BankName || "", acc: b.AccountNo || "", ifsc: b.IfscCode || "" }); }
  }, [savedAccounts]);

  const remaining = picked ? Number(picked.Remaining) : 0;
  const amt = Number(amount) || 0;
  const dedPct = picked?.SourceType === "CancellationHeldCredit" ? Number(picked.DeductionPercent || 0) : 0;
  const deduction = mode === "refund" ? Math.round(((amt * dedPct) / 100) * 100) / 100 : 0;
  const net = Math.max(0, amt - deduction);
  const rebookTargets = (bookings as any[]).filter((b) => picked && String(b.CustomerId ?? "") === String(picked.CustomerId ?? "") && !["Cancelled", "Rejected"].includes(b.Status));
  const canRebook = picked?.SourceType === "CancellationHeldCredit";
  useEffect(() => { if (!canRebook && mode === "rebook") setMode("refund"); }, [canRebook, mode]);
  const transfer = !!payModes?.transfer.includes(paymentMode);

  const followUp = (d: any) => {
    if (d.partialFailure && d.fundTransferId) {
      toast.warning(d.message || "The fund transfer is a draft: submit it when ready", { action: { label: "Submit for Approval", onClick: async () => {
        try { const r = await fetchWithAuth(`${API}/rebooking-transfer/${d.id}/submit-fund-transfer`, { method: "PUT" }); const x = await r.json(); if (!r.ok) throw new Error(x.error); toast.success(x.message || "Fund transfer submitted for approval"); }
        catch (e: any) { toast.error(translateError(e?.message)); }
      } } });
    } else if (d.partialFailure) {
      toast.warning(d.message || "Credit applied, but the accounting follow-up is incomplete", { action: { label: "Retry Ledger", onClick: async () => {
        try { const r = await fetchWithAuth(`${API}/rebooking-transfer/${d.id}/retry-ledger`, { method: "PUT" }); const x = await r.json(); if (!r.ok) throw new Error(x.error); x.partialFailure ? toast.warning(x.message) : toast.success(x.message || "Ledger entries updated"); }
        catch (e: any) { toast.error(translateError(e?.message)); }
      } } });
    } else toast.success(d.crossCompany ? `Inter-company transfer ${d.fundTransferDocNo || ""} raised: the credit lands once Finance approves it` : "Held credit applied to the booking");
  };

  const submit = async () => {
    if (!picked) return void toast.error("Pick a held credit or overpayment.");
    if (amt <= 0) return void toast.error("Enter the amount.");
    if (amt > remaining + 0.005) return void toast.error(`At most ${fmt(remaining)} is available from this source.`);
    setSaving(true);
    try {
      if (mode === "rebook") {
        if (!toBookingId) throw new Error("Pick the booking the credit goes to.");
        const r = await fetchWithAuth(`${API}/rebooking-transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ heldOnAccountId: picked.OnAccountId, toBookingId: Number(toBookingId), amount: amt }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        followUp(d);
        onDone();
      } else {
        const body = { GrossAmount: amt, Reason: reason || null, RefundBankLHeadId: bankLHeadId || null, CustomerBankName: acct.name || null, CustomerAccountNo: acct.acc || null,
          CustomerIfscCode: acct.ifsc || null, PreferredPaymentMode: paymentMode || null, SourceType: picked.SourceType, SourceOnAccountId: picked.OnAccountId };
        const r = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        toast.success(`${d.RefundNo} raised: net ${fmt(d.NetAmount)}${d.DeductionAmount ? `, deduction ${fmt(d.DeductionAmount)}` : ""}`);
        onDone(d.Id ?? d.id);
      }
      onClose();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  return (
    <GridDialog onClose={onClose} icon={Undo2} title="New Refund" description="Pays back a cancelled booking's held credit or an overpayment, or moves held credit onto the customer's new booking."
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving || !picked} className={GRID_BTN_BRAND}>{saving ? "Saving…" : mode === "rebook" ? <><ArrowRightLeft size={13} /> Apply Credit</> : <><Banknote size={13} /> Raise Refund</>}</button></>}>
      <GridFormSection title="Source of funds">
        <GridFormField label="Held credit or overpayment" required wide
          hint={sourcesError ? translateError((sourcesErr as Error)?.message) : !sourcesLoading && !offered.length ? "No held credit or unapplied overpayment right now: a refund can only be raised against one." : undefined}>
          <select value={picked ? String(picked.OnAccountId) : ""} className={GRID_INPUT}
            onChange={(e) => { const x = offered.find((o) => String(o.OnAccountId) === e.target.value) || null; setPicked(x); setAmount(x ? String(Number(x.Remaining)) : ""); setBankLHeadId(""); setAcct({ name: "", acc: "", ifsc: "" }); }}>
            <option value="">{sourcesLoading ? "Loading…" : "Select a held credit or overpayment…"}</option>
            {offered.map((x) => <option key={`${x.SourceType}-${x.OnAccountId}`} value={String(x.OnAccountId)}>{`${SOURCE_LABEL[x.SourceType]} · ${personName(x.CustomerName)} · ${x.BookingNo}${x.CancellationNo ? ` (${x.CancellationNo})` : ""} · ${fmt(x.Remaining)} left`}</option>)}
          </select>
        </GridFormField>
        {canRebook && (
          <GridFormField label="What to do with it" wide>
            <span className="grid grid-cols-2 gap-2">
              {([["refund", Banknote, "Refund to the customer"], ["rebook", ArrowRightLeft, "Apply to a re-booking"]] as const).map(([k, Icon, l]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={cn(GRID_BTN, "h-9 justify-center", mode === k && "!border-primary !bg-primary/10 font-semibold")}><Icon size={13} /> {l}</button>
              ))}
            </span>
          </GridFormField>
        )}
      </GridFormSection>
      <GridFormSection title="Amount">
        <GridFormField label={mode === "rebook" ? "Credit to move" : "Gross amount"} required hint={picked ? `${fmt(remaining)} available` : undefined}>
          <span className="flex gap-2">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={cn(GRID_INPUT, "tabular-nums")} />
            {picked && <button type="button" onClick={() => setAmount(String(remaining))} className={cn(GRID_BTN, "h-9 shrink-0")}>Use All</button>}
          </span>
        </GridFormField>
        {mode === "refund" && (
          <GridFormField label="Net to the customer" hint={dedPct ? `${dedPct}% cancellation deduction: ${fmt(deduction)}` : "No deduction"}>
            <span className="flex items-center h-9 px-3 rounded-md bg-muted/40 font-semibold tabular-nums">{fmt(net)}</span>
          </GridFormField>
        )}
      </GridFormSection>
      {mode === "rebook" ? (
        <GridFormSection title="Apply to booking">
          <GridFormField label="Booking (same customer)" required wide hint="A booking under another company raises an inter-company fund transfer for Finance to approve; the credit lands afterwards.">
            <SearchableNativeSelect value={toBookingId} onChange={(e) => setToBookingId(e.target.value)} className={GRID_INPUT}>
              <option value="">Select the booking…</option>
              {rebookTargets.map((b) => <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} · ${b.ProjectName || b.UnitNo || ""} · ${b.CompanyId === picked?.CompanyId ? "same company" : "another company"}`}</option>)}
            </SearchableNativeSelect>
          </GridFormField>
        </GridFormSection>
      ) : (
        <GridFormSection title="Payout">
          <GridFormField label="Payment mode" hint="Finance can set it later.">
            <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={GRID_INPUT}>
              <option value="">Not set yet</option>
              {(payModes?.modes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </GridFormField>
          <GridFormField label="Paid from (company bank)" hint="Finance picks it otherwise.">
            <select value={bankLHeadId} onChange={(e) => setBankLHeadId(e.target.value)} className={GRID_INPUT}>
              <option value="">Finance picks it</option>
              {(banks as any[]).map((b) => <option key={b.BId} value={String(b.BId)}>{bankLabel(b)}</option>)}
            </select>
            <BankNote bank={findBank(banks as any[], bankLHeadId)} />
          </GridFormField>
          <GridFormField label="Customer's account" required={transfer} wide>
            <CustomerAccount bookingId={picked?.BookingId} name={acct.name} acc={acct.acc} ifsc={acct.ifsc} transfer={transfer} onChange={setAcct} />
          </GridFormField>
          <GridFormField label="Reason" wide><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this refund is raised" className={GRID_INPUT} /></GridFormField>
        </GridFormSection>
      )}
    </GridDialog>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────
const STEPS = ["Raised", "Sent for approval", "CRM approved", "Voucher raised", "Paid"];
// How many steps are done for each status; a rejected refund stopped at CRM approval.
const DONE_OF: Record<string, number> = { Draft: 1, Pending: 2, Rejected: 2, Withdrawn: 1, Approved: 3, FinancePending: 3, FinanceApproved: 4, Paid: 5 };
function refundBar(r: any): { steps: { label: string; state: StepState }[]; caption: string } {
  const done = DONE_OF[r.Status] ?? 0;
  const steps = STEPS.map((label, i) => ({ label, state: (i < done ? "done" : i === done ? (DROPPED.includes(r.Status) || r.NeedsAccount ? "stopped" : "active") : "off") as StepState }));
  return { steps, caption: r.Status === "Paid" ? "Paid" : r.Status === "Withdrawn" ? "Withdrawn before approval" : r.Status === "Rejected" ? "Rejected at CRM approval" : `Step ${Math.min(done + 1, STEPS.length)} of ${STEPS.length}: ${STEPS[Math.min(done, STEPS.length - 1)]}` };
}
// Who the refund waits on, in a few words (the list's column).
function waitingOn(r: any): { text: string; tone: "done" | "waiting" | "stopped" | "moving" | "draft" } {
  if (r.Status === "Paid") return { text: "Paid", tone: "done" };
  if (r.Status === "Withdrawn") return { text: "Withdrawn", tone: "draft" };
  if (r.NeedsAccount && EDITABLE.includes(r.Status)) return { text: "Add the customer's account", tone: "stopped" };
  switch (r.Status) {
    case "Draft": return { text: "CRM: send for approval", tone: "waiting" };
    case "Pending": return { text: r.RejectionNote ? "CRM approver (sent back by Finance)" : "CRM approver", tone: "waiting" };
    case "Rejected": return { text: "CRM: correct and send again", tone: "stopped" };
    case "Approved": case "FinancePending": return { text: "Finance: raise the payout voucher", tone: "moving" };
    case "FinanceApproved": return { text: "Finance: approve the voucher in Payments", tone: "moving" };
    default: return { text: statusText(r.Status), tone: "waiting" };
  }
}

const dash = <span className="text-muted-foreground">—</span>;
const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "CustomerName", csv: (r) => personName(r.CustomerName), cell: (r) => (
    <span className="flex items-center gap-3 py-1.5 min-w-0">
      <Initials name={r.CustomerName} />
      <span className="min-w-0">
        <span className="block font-semibold text-foreground capitalize truncate" title={r.CustomerName}>{asName(r.CustomerName)}</span>
        <span className="block text-xs text-muted-foreground tabular-nums truncate">{[r.RefundNo, r.BookingNo, r.UnitNo, r.ProjectName].filter(Boolean).join(" · ")}</span>
      </span>
    </span>
  ) },
  { id: "progress", label: "Progress", sortKey: "Status", csv: (r) => statusText(r.Status), cell: (r) => { const b = refundBar(r); return <span className="block min-w-[13rem] py-1.5"><StepBar steps={b.steps} caption={b.caption} /></span>; } },
  { id: "waiting", label: "Waiting on", csv: (r) => waitingOn(r).text, cell: (r) => { const w = waitingOn(r); return <GridToneMark text={w.text} tone={w.tone} />; } },
  { id: "net", label: "Net payout", align: "right", sortKey: "NetAmount", csv: (r) => r.NetAmount, cell: (r) => (
    <span className="inline-flex flex-col items-end leading-tight" title={`Gross ${fmt(r.GrossAmount)} · Deduction ${fmt(r.DeductionAmount)} · Net ${fmt(r.NetAmount)}`}>
      <span className="tabular-nums font-semibold">{fmtShort(r.NetAmount)}</span>
      {Number(r.DeductionAmount) > 0 && <span className="mt-0.5 text-xs text-muted-foreground tabular-nums">{fmtShort(r.GrossAmount)} less {r.DeductionPercent}%</span>}
    </span>
  ) },
  { id: "source", label: "Source of funds", sortKey: "SourceType", csv: (r) => SOURCE_LABEL[r.SourceType] || r.SourceType, cell: (r) => (
    <span className="block leading-tight">
      <span className="block">{SOURCE_LABEL[r.SourceType] || r.SourceType}</span>
      {r.CancellationNo && <span className="block mt-0.5 text-xs text-muted-foreground tabular-nums">{r.CancellationNo}</span>}
    </span>
  ) },
  { id: "due", label: "RERA due", sortKey: "RefundDueDate", csv: (r) => r.RefundDueDate, cell: (r) => (!r.RefundDueDate || r.Status === "Paid" ? dash : (
    <span className="inline-flex flex-col leading-tight">
      <span className="tabular-nums">{fmtDate(r.RefundDueDate)}</span>
      <span className={cn("mt-0.5 text-xs tabular-nums", r.IsOverdue ? "font-semibold text-destructive" : "text-muted-foreground")}>{r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`}</span>
    </span>
  )) },
  // In the export only.
  ...([
    ["no", "Refund no", (r: any) => r.RefundNo], ["booking", "Booking", (r: any) => r.BookingNo], ["unit", "Unit", (r: any) => r.UnitNo], ["project", "Project", (r: any) => r.ProjectName],
    ["mobile", "Mobile", (r: any) => r.Mobile], ["gross", "Gross", (r: any) => r.GrossAmount], ["deduction", "Deduction", (r: any) => r.DeductionAmount], ["mode", "Payment mode", (r: any) => r.PreferredPaymentMode],
    ["bank", "Company bank", (r: any) => r.RefundBankName], ["raisedBy", "Raised by", (r: any) => r.RequestedByName], ["raised", "Raised on", (r: any) => r.RequestedAt || r.CreatedAt],
    ["paid", "Paid on", (r: any) => r.PaidAt], ["note", "Rejection note", (r: any) => r.RejectionNote],
  ] as [string, string, (r: any) => unknown][]).map(([id, label, csv]): GridCol<any> => ({ id, label, hiddenByDefault: true, csv, cell: () => null })),
];

// ── One refund ──────────────────────────────────────────────────────────────
function RefundRecord({ id, canEdit, onBack, onEdit, onFinance, onSendBack, onSubmit, onWithdraw, busy }: {
  id: string; canEdit: boolean; onBack: () => void; onEdit: (r: any, thenSubmit?: boolean) => void; onFinance: (r: any) => void; onSendBack: (r: any) => void; onSubmit: (r: any) => void; onWithdraw: (r: any) => void; busy: boolean;
}) {
  const navigate = useNavigate();
  const { data: r, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-refunds", "record", id], queryFn: () => fetchRefund(id), retry: false });
  const { data: notes = [] } = useQuery({ queryKey: ["crm-refunds", "record-notes", id], queryFn: () => fetchRefundNotes(id), enabled: r?.Status === "Paid" });
  const financeCan = useCanApprove("crm-refunds-finance", r?.Id, !!r && VOUCHER_NOT_RAISED.includes(r.Status));
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !r) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{translateError((error as Error)?.message || "Refund not found")}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All refunds</button>
    </div>
  );
  const bar = refundBar(r);
  const editable = canEdit && EDITABLE.includes(r.Status);
  const go = (key: string) => () => document.getElementById(`rf-${key}`)?.scrollIntoView({ block: "start" });
  const note = cleanNote(r.RejectionNote);
  const fromFinance = /^\[Finance\]/.test(r.RejectionNote || "");

  // Where it stands, and the one action that moves it on.
  let next = ""; let action: { label: string; run: () => void } | null = null; let finished = false;
  if (r.Status === "Paid") { next = `Paid on ${fmtDate(r.PaidAt)}${r.PreferredPaymentMode ? ` by ${r.PreferredPaymentMode}` : ""}.`; finished = true; }
  else if (r.Status === "Withdrawn") { next = `Withdrawn${note ? `: ${note}` : ""}. Nothing was paid, and the money it claimed is free for a new refund or a re-booking.`; finished = true; }
  else if (r.NeedsAccount && EDITABLE.includes(r.Status)) { next = `A ${r.PreferredPaymentMode} refund needs the customer's bank account: add it, or change the mode to cheque`; action = editable ? { label: "Add Customer's Account", run: () => onEdit(r) } : null; }
  else if (r.Status === "Draft") { next = "Not sent for approval yet. No money has moved"; action = canEdit ? { label: "Send for Approval", run: () => onSubmit(r) } : null; }
  else if (r.Status === "Pending") { next = fromFinance ? `Finance sent it back: ${note}. Correct it if needed; the CRM approver approves it again` : "Waiting for CRM approval. No money has moved"; action = { label: "Go to Approval", run: go("approval") }; }
  else if (r.Status === "Rejected") { next = `Rejected${note ? `: ${note}` : ""}. Correct it, then send it again`; action = editable ? { label: "Correct and Send Again", run: () => onEdit(r, true) } : null; }
  else if (VOUCHER_NOT_RAISED.includes(r.Status)) {
    next = note ? `Approved, but the payout voucher wasn't raised: ${note}` : "Approved: Finance raises the payout voucher";
    action = financeCan ? { label: "Raise Payout Voucher", run: () => onFinance(r) } : null;
    if (!financeCan) next += " (Approval Setup: CRM Refunds Finance)";
  } else if (r.Status === "FinanceApproved") { next = "The payout voucher is with Finance in Payments. It is marked Paid once Finance approves the voucher"; action = r.FinanceNewPaymentId != null ? { label: "Open in Payments", run: () => navigate(`/payments?view=${r.FinanceNewPaymentId}`) } : null; }

  const trail = [
    { step: "Raised", by: r.RequestedByName, at: r.RequestedAt || r.CreatedAt },
    { step: "CRM approved", by: r.ApprovedByName, at: r.ApprovedAt },
    { step: "Payout voucher raised", by: r.FinanceClearedByName, at: r.FinanceClearedAt },
    { step: "Paid", by: null, at: r.PaidAt },
  ].filter((t) => t.at);

  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Refund · ${r.RefundNo}`} title={<span className="capitalize">{asName(r.CustomerName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(r.Status)}</span>}
        sub={[r.BookingNo, r.UnitNo, r.ProjectName, r.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All refunds</button>
          {r.BookingId != null && <Link to={`/crm/bookings?view=${r.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</Link>}
          {editable && <button type="button" onClick={() => onEdit(r)} className={BAND_KEY}><PenLine size={13} /> Edit Details</button>}
          {editable && r.FinanceNewPaymentId == null && <button type="button" onClick={() => onWithdraw(r)} className={cn(BAND_KEY, "!text-rose-300")}><XCircle size={13} /> Withdraw</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(r.NetAmount)} leadNote={Number(r.DeductionAmount) > 0 ? `net payout · ${fmtShort(r.GrossAmount)} less ${r.DeductionPercent}%` : "net payout"}
        bar={<StepBar steps={bar.steps} onDark />}
        figures={[
          { label: "Gross", value: fmtShort(r.GrossAmount), note: SOURCE_LABEL[r.SourceType] || r.SourceType, exact: fmt(r.GrossAmount) },
          { label: "Deduction", value: fmtShort(r.DeductionAmount), note: Number(r.DeductionAmount) > 0 ? `${r.DeductionPercent}% kept` : "None", exact: fmt(r.DeductionAmount) },
          { label: "Paid by", dot: r.NeedsAccount ? BAND_DOT.overdue : undefined, value: r.PreferredPaymentMode || "Not set", note: r.NeedsAccount ? "Customer's account missing" : r.CustomerAccountNo ? `To A/c ••${String(r.CustomerAccountNo).slice(-4)}` : r.PreferredPaymentMode ? "No account needed" : "Finance chooses the mode", alert: !!r.NeedsAccount },
          { label: "RERA due", dot: r.IsOverdue ? BAND_DOT.overdue : undefined, value: r.RefundDueDate ? fmtDate(r.RefundDueDate) : "—", note: r.Status === "Paid" || !r.RefundDueDate ? "No date running" : r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`, alert: !!r.IsOverdue },
        ]}
        footer={<BandNext text={next} finished={finished} action={action} />} />

      <div id="rf-approval" className="scroll-mt-4">
        <GridRelated icon={ShieldCheck} title="Approval">
          <div className="px-4 py-3 space-y-3">
            {["Draft", "Rejected"].includes(r.Status) && canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} submitOnly extraSubmitStatuses={["Draft"]} onSuccess={() => refetch()} />
                <span className="text-xs text-muted-foreground">{r.Status === "Rejected" ? "Correct the details first if needed (Edit Details)." : "Goes to the CRM approver set in Approval Setup (CRM Refunds)."}</span>
              </div>
            )}
            {r.Status === "Pending" && (
              <div className="flex flex-wrap items-center gap-2">
                <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} module="crm-refunds" onSuccess={() => refetch()} />
                <span className="text-xs text-muted-foreground">Who approves is set in Approval Setup (CRM Refunds). Approving raises the payout voucher for Finance.</span>
              </div>
            )}
            {VOUCHER_NOT_RAISED.includes(r.Status) && financeCan && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => onFinance(r)} className={GRID_BTN_BRAND}><Banknote size={13} /> Raise Payout Voucher</button>
                <button type="button" onClick={() => onSendBack(r)} disabled={busy} className={cn(GRID_BTN, "!text-destructive")}>Send Back to CRM</button>
              </div>
            )}
            {r.Status === "Withdrawn" && <p className="text-xs rounded-md px-3 py-2 border border-border"><strong>Withdrawn:</strong> {note || "No reason recorded"}</p>}
            <ApprovalTrailTimeline table="CrmRefund" recordId={r.Id} refreshKey={r.UpdatedAt} empty={<span className="text-xs text-muted-foreground">{r.Status === "Draft" ? "Not sent for approval yet." : "No approval steps recorded."}</span>} />
          </div>
        </GridRelated>
      </div>

      <GridRelated icon={Wallet} title="Amount and source">
        <GridFacts items={[
          { label: "Comes from", value: SOURCE_LABEL[r.SourceType] || r.SourceType },
          { label: "Cancellation", value: r.CancellationNo },
          { label: "Booking", value: r.BookingNo },
          { label: "Customer no", value: r.CustomerNo },
          { label: "Gross", value: fmt(r.GrossAmount) },
          { label: "Deduction", value: Number(r.DeductionAmount) > 0 ? `${fmt(r.DeductionAmount)} (${r.DeductionPercent}%)` : null },
          { label: "Net payout", value: <span className="font-semibold">{fmt(r.NetAmount)}</span> },
          { label: "Reason", value: r.Reason, wide: true },
        ]} />
      </GridRelated>

      <GridRelated icon={Landmark} title="Payout" action={editable ? <button type="button" onClick={() => onEdit(r)} className={cn(GRID_BTN, "h-8")}><PenLine size={12} /> Edit Details</button> : undefined}>
        <GridFacts items={[
          { label: "Payment mode", value: r.PreferredPaymentMode || "Not set: Finance chooses" },
          { label: "Customer's bank", value: r.CustomerBankName },
          { label: "Customer's account", value: r.CustomerAccountNo ? <span className="tabular-nums">{r.CustomerAccountNo}</span> : r.NeedsAccount ? <span className="text-destructive font-medium">Missing: needed for {r.PreferredPaymentMode}</span> : null },
          { label: "IFSC", value: r.CustomerIfscCode ? <span className="tabular-nums">{r.CustomerIfscCode}</span> : null },
          { label: "Paid from", value: r.RefundBankName },
          { label: "Payout voucher", value: r.FinanceNewPaymentId != null ? <button type="button" onClick={() => navigate(`/payments?view=${r.FinanceNewPaymentId}`)} className="text-primary hover:underline inline-flex items-center gap-1">Open in Payments <ExternalLink size={11} /></button> : null },
          { label: "Paid on", value: r.PaidAt ? fmtDate(r.PaidAt) : null },
        ]} />
      </GridRelated>

      {r.Status === "Paid" && (
        <GridRelated icon={FileText} title="GST documents" count={notes.length} action={<button type="button" onClick={() => navigate(`/crm/credit-notes?refundId=${r.Id}`)} className={cn(GRID_BTN, "h-8")}><FileText size={12} /> Credit Notes</button>}>
          <GridMiniTable rows={notes} rowKey={(n: any) => n.Id} empty="None: this booking charged no GST on the amount refunded." cols={[
            { header: "Document", cell: (n: any) => <Link to={`/crm/credit-notes?refundId=${r.Id}`} className="tabular-nums text-primary hover:underline">{n.DocNo || "Certificate"}</Link> },
            { header: "Type", cell: (n: any) => (n.DocType === "RefundVoucher" ? "Refund voucher" : "Credit note") },
            { header: "Against", cell: (n: any) => <span className="tabular-nums text-muted-foreground">{n.AgainstRef || "—"}</span> },
            { header: "Date", cell: (n: any) => <span className="tabular-nums">{fmtDate(n.DocDate)}</span> },
            { header: "GST", align: "right", cell: (n: any) => <span className="tabular-nums">{fmt(n.GstAmount)}</span> },
            { header: "Amount", align: "right", cell: (n: any) => <span className="tabular-nums font-semibold">{fmt(n.TotalAmount)}</span> },
            { header: "Status", cell: (n: any) => <GridToneMark text={n.Status === "TimeBarred" ? "Time-barred" : n.Status} tone={n.Status === "Cancelled" ? "stopped" : n.Status === "TimeBarred" ? "waiting" : "done"} /> },
          ]} />
        </GridRelated>
      )}

      <GridRelated icon={History} title="History">
        <GridMiniTable rows={trail} rowKey={(t) => t.step} empty="No steps recorded." cols={[
          { header: "Step", cell: (t) => <span className="font-medium">{t.step}</span> },
          { header: "By", cell: (t) => <span className="text-muted-foreground">{t.by || "—"}</span> },
          { header: "When", cell: (t) => <span className="tabular-nums">{fmtDate(t.at)}</span> },
        ]} />
      </GridRelated>
    </div>
  );
}

// ── Edit details (before approval, or after a rejection) ─────────────────────
function EditDialog({ r, thenSubmit, onClose, onDone }: { r: any; thenSubmit: boolean; onClose: () => void; onDone: () => void }) {
  const { data: payModes } = usePayModes();
  const { data: banks = [] } = useQuery({ queryKey: ["crm-refund-project-banks", r.ProjectId], queryFn: () => fetchProjectBanks(r.ProjectId), enabled: r.ProjectId != null });
  const [mode, setMode] = useState<string>(r.PreferredPaymentMode || "");
  const [bank, setBank] = useState<string>(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : "");
  const [acct, setAcct] = useState({ name: r.CustomerBankName || "", acc: r.CustomerAccountNo || "", ifsc: r.CustomerIfscCode || "" });
  const [reason, setReason] = useState<string>(r.Reason || "");
  const [saving, setSaving] = useState(false);
  const transfer = !!payModes?.transfer.includes(mode);
  const save = async () => {
    if (transfer && !acct.acc.trim()) return void toast.error(`A ${mode} refund needs the customer's account number, or choose Cheque.`);
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${r.Id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        Reason: reason || null, PreferredPaymentMode: mode, RefundBankLHeadId: bank || null, CustomerBankName: acct.name || null, CustomerAccountNo: acct.acc || null, CustomerIfscCode: acct.ifsc || null,
      }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error);
      if (thenSubmit) {
        const s = await fetchWithAuth(`${API}/${r.Id}/submit`, { method: "PUT" });
        const x = await s.json().catch(() => ({}));
        if (!s.ok) { toast.warning(`Saved, but not sent: ${translateError(x.error)}`); onDone(); onClose(); return; }
        toast.success("Corrected and sent for approval");
      } else toast.success("Details saved");
      onDone(); onClose();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  return (
    <GridDialog onClose={onClose} icon={PenLine} title={thenSubmit ? "Correct and Send Again" : "Edit Refund Details"} description={`${r.RefundNo} · ${personName(r.CustomerName)} · net ${fmt(r.NetAmount)}`}
      footer={<><button type="button" onClick={onClose} className={GRID_BTN}>Cancel</button><button type="button" onClick={save} disabled={saving} className={GRID_BTN_BRAND}>{saving ? "Saving…" : thenSubmit ? "Save and Send Again" : "Save Details"}</button></>}>
      {r.Status === "Rejected" && r.RejectionNote && <p className="mb-3 text-sm rounded-md px-3 py-2 border border-destructive/40 text-destructive"><strong>Rejected:</strong> {cleanNote(r.RejectionNote)}</p>}
      <GridFormSection title="Payout">
        <GridFormField label="Payment mode" hint="Not set: Finance chooses it on the voucher.">
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={GRID_INPUT}>
            <option value="">Not set yet</option>
            {(payModes?.modes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </GridFormField>
        <GridFormField label="Paid from (company bank)">
          <select value={bank} onChange={(e) => setBank(e.target.value)} className={GRID_INPUT}>
            <option value="">Finance picks it</option>
            {(banks as any[]).map((b) => <option key={b.BId} value={String(b.BId)}>{bankLabel(b)}</option>)}
          </select>
          <BankNote bank={findBank(banks as any[], bank)} />
        </GridFormField>
        <GridFormField label="Customer's account" required={transfer} wide>
          <CustomerAccount bookingId={r.BookingId} name={acct.name} acc={acct.acc} ifsc={acct.ifsc} transfer={transfer} onChange={setAcct} />
        </GridFormField>
        <GridFormField label="Reason" wide><input value={reason} onChange={(e) => setReason(e.target.value)} className={GRID_INPUT} /></GridFormField>
      </GridFormSection>
      <p className="mt-3 text-xs text-muted-foreground">The amount can't change here. For a different amount, leave this one rejected and raise a new refund: a rejected refund doesn't hold the money.</p>
    </GridDialog>
  );
}

// ── Re-booking credits ──────────────────────────────────────────────────────
// Held credit moved onto the customer's new booking (New Refund → Apply to a re-booking). Same company: applied at once.
// Another company: a fund transfer goes to Finance first, and the credit lands once it is approved there.
function rebookState(t: any): { text: string; tone: "done" | "waiting" | "stopped" | "moving" } {
  if (t.Status === "Applied") return { text: "Applied to the booking", tone: "done" };
  if (t.Status === "Rejected") return { text: "Not applied", tone: "stopped" };
  if (t.IsCrossCompany && t.FundTransferStatus === "Draft") return { text: "Fund transfer not sent", tone: "stopped" };
  if (t.IsCrossCompany) return { text: `Fund transfer ${t.FundTransferStatus || "pending"}`, tone: "moving" };
  return { text: t.Status, tone: "waiting" };
}
function RebookingCredits({ search, cpb, canEdit }: { search: string; cpb: URLSearchParams; canEdit: boolean }) {
  const navigate = useNavigate();
  const qs = useMemo(() => { const p = new URLSearchParams(cpb); if (search) p.set("search", search); return p.toString(); }, [search, cpb]);
  const { data: rows = [], refetch, isFetching } = useQuery({ queryKey: ["crm-refunds", "rebooking", qs], queryFn: () => getJson<any[]>(`${API}/rebooking-transfers?${qs}`, "Could not load the re-booking credits."), staleTime: 30_000 });
  const [busy, setBusy] = useState<number | null>(null);
  const act = async (t: any, path: string, done: string) => {
    setBusy(t.Id);
    try {
      const r = await fetchWithAuth(`${API}/rebooking-transfer/${t.Id}/${path}`, { method: "PUT" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error);
      d.partialFailure ? toast.warning(d.message) : toast.success(d.message || done);
      refetch();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(null); }
  };
  if (!(rows as any[]).length) return null;
  return (
    <GridRelated icon={ArrowRightLeft} title="Re-booking credits" count={(rows as any[]).length}
      action={<button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(GRID_BTN, "w-9 !px-0 h-8")} title="Refresh" aria-label="Refresh"><RefreshCw size={12} className={isFetching ? "animate-spin" : ""} /></button>}>
      <GridMiniTable rows={rows as any[]} rowKey={(t: any) => t.Id} empty="None." cols={[
        { header: "Customer", cell: (t: any) => <span className="block"><span className="block font-medium capitalize">{asName(t.CustomerName)}</span><span className="block text-xs text-muted-foreground tabular-nums">{[t.FromBookingNo, t.CancellationNo].filter(Boolean).join(" · ")}</span></span> },
        { header: "Moved to", cell: (t: any) => <span className="block"><span className="block tabular-nums">{t.ToBookingNo}</span><span className="block text-xs text-muted-foreground">{[t.ToProjectName, t.ToUnitNo].filter(Boolean).join(" · ")}{t.IsCrossCompany ? " · another company" : ""}</span></span> },
        { header: "Amount", align: "right", cell: (t: any) => <span className="tabular-nums font-semibold">{fmt(t.Amount)}</span> },
        { header: "Where it stands", cell: (t: any) => { const st = rebookState(t); return <span className="block"><GridToneMark text={st.text} tone={st.tone} />{t.FundTransferNo && <span className="block mt-0.5 text-xs text-muted-foreground tabular-nums">{t.FundTransferNo}</span>}</span>; } },
        { header: "Made", cell: (t: any) => <span className="block text-xs"><span className="block tabular-nums">{fmtDate(t.CreatedAt)}</span>{t.CreatedByName && <span className="block text-muted-foreground">{t.CreatedByName}</span>}</span> },
        { header: "", align: "right", cell: (t: any) => (
          <span className="inline-flex gap-1.5 flex-wrap justify-end">
            {canEdit && t.IsCrossCompany && t.Status === "PendingTransfer" && t.FundTransferStatus === "Draft" && (
              <button type="button" disabled={busy === t.Id} onClick={() => act(t, "submit-fund-transfer", "Fund transfer sent for approval")} className={cn(GRID_BTN_BRAND, "h-7")}>Send Fund Transfer</button>
            )}
            {canEdit && t.Status === "Applied" && (
              <button type="button" disabled={busy === t.Id} onClick={() => act(t, "retry-ledger", "Ledger entries are up to date")} className={cn(GRID_BTN, "h-7")} title="Posts any ledger entry the move is still missing; safe to repeat">Check Ledger</button>
            )}
            {t.FundTransferId != null && <button type="button" onClick={() => navigate("/fund-transfer")} className={cn(GRID_BTN, "h-7")}>Fund Transfer <ExternalLink size={11} /></button>}
          </span>
        ) },
      ]} />
    </GridRelated>
  );
}

const CrmRefunds: React.FC = () => {
  const rights = usePageRights("crm-refunds");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: REFUNDS_DEFAULT_SORT });
  // ?search= (e.g. from a credit note) opens the list filtered to that refund.
  useEffect(() => { const q = sp.get("search"); if (q) list.setSearchInput(q); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [status, setStatusRaw] = useUrlParam<string>("status", "All");
  const setStatus = (s: string) => { setStatusRaw(s); list.setPage(1); };
  const [dates, setDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };
  const [exporting, setExporting] = useState(false);
  const [showNew, setShowNew] = useState(() => !!sp.get("newForBooking"));
  const [editing, setEditing] = useState<{ r: any; thenSubmit: boolean } | null>(null);
  const [financeDialog, setFinanceDialog] = useState<any | null>(null);
  const [financeBank, setFinanceBank] = useState("");
  const [financeMode, setFinanceMode] = useState("");
  const [sendBack, setSendBack] = useState<any | null>(null);
  const [sendBackNote, setSendBackNote] = useState("");
  const [withdrawing, setWithdrawing] = useState<any | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: payModes } = usePayModes();

  // The open refund lives in the address. ?id= is how other pages and the Approval Inbox link here.
  const openId = sp.get("open") || sp.get("id");
  const openRefund = (id: number) => setSp((p) => { p.delete("id"); p.set("open", String(id)); return p; });
  const closeRefund = () => setSp((p) => { p.delete("open"); p.delete("id"); return p; });

  const range = resolveGridDateRange(dates);
  const params = useMemo(() => {
    const p = listParams({ ...list.query, status });
    if (range.from) p.set("dateFrom", range.from);
    if (range.to) p.set("dateTo", range.to);
    return p;
  }, [list.query, status, range.from, range.to]);
  // The company / project / block filter, for the re-booking credits below the list.
  const cpbParams = useMemo(() => { const p = new URLSearchParams(); ["companyId", "projectId", "blockId"].forEach((k) => { const v = params.get(k); if (v) p.set(k, v); }); return p; }, [params]);
  const { data, isLoading, error, isFetching, refetch } = useQuery({ queryKey: ["crm-refunds", "list", params.toString()], queryFn: () => fetchList(params), staleTime: 20_000, enabled: !openId });
  const result = useSticky(data);
  const counts = result?.statusCounts ?? {};
  const { data: sources = [] } = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: fetchEligibleSources, staleTime: 60_000, enabled: !openId });
  const { data: financeBanks = [] } = useQuery({ queryKey: ["crm-refund-project-banks", financeDialog?.ProjectId], queryFn: () => fetchProjectBanks(financeDialog?.ProjectId), enabled: !!financeDialog?.ProjectId });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["crm-refunds"] }); qc.invalidateQueries({ queryKey: ["crm-refund-eligible-sources"] }); };
  const closeFinance = () => { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); };
  const openFinance = (r: any) => { setFinanceDialog(r); setFinanceBank(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : ""); setFinanceMode(r.PreferredPaymentMode || ""); };
  const put = async (url: string, body?: object) => {
    const res = await fetchWithAuth(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error);
    return d;
  };
  const run = async (work: () => Promise<any>, done: (d: any) => string, after?: () => void) => {
    setBusy(true);
    try { const d = await work(); toast.success(done(d)); invalidate(); after?.(); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };
  const submitRefund = (r: any) => run(() => put(`${API}/${r.Id}/submit`), () => `${r.RefundNo} sent for approval`);
  const raiseVoucher = () => run(() => put(`${API}/${financeDialog.Id}/finance-approve`, { RefundBankLHeadId: financeBank || undefined, PaymentMode: financeMode || undefined }),
    (d) => `Payout voucher ${d.docNo || ""} raised: with Finance in Payments`, closeFinance);
  const doWithdraw = () => run(() => put(`${API}/${withdrawing.Id}/withdraw`, { reason: withdrawReason.trim() }), () => `${withdrawing.RefundNo} withdrawn: its money is free again`, () => setWithdrawing(null));
  const doSendBack = () => run(() => put(`${API}/${sendBack.Id}/finance-reject`, { note: sendBackNote.trim() }), () => "Sent back to CRM", () => setSendBack(null));

  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, COLS);
  const c = (s: string) => counts[s] ?? { count: 0, net: 0, gross: 0, deduction: 0, overdue: 0 };
  const allStatuses = Object.values(counts);
  const sum = (keys: string[], f: "count" | "net") => keys.reduce((s, k) => s + (Number(c(k)[f]) || 0), 0);
  const CRM = ["Draft", "Pending"];
  const raised = allStatuses.reduce((s, x) => s + x.net, 0) - sum(DROPPED, "net");
  const paid = c("Paid").net;
  const withFinance = sum([...VOUCHER_NOT_RAISED, "FinanceApproved"], "net");
  const inCrm = sum(CRM, "net");
  const overdue = allStatuses.reduce((s, x) => s + x.overdue, 0);
  const allCount = allStatuses.reduce((s, x) => s + x.count, 0);
  const available = (sources as any[]).reduce((s, x) => s + (Number(x.Remaining) || 0), 0);
  const tabCount: Record<string, number> = { All: allCount, CRM: sum(CRM, "count"), Voucher: sum(VOUCHER_NOT_RAISED, "count"), FinanceApproved: c("FinanceApproved").count, Paid: c("Paid").count, Rejected: c("Rejected").count, Withdrawn: c("Withdrawn").count, Overdue: overdue };
  const tabs = REFUND_TABS.map((t) => ({ ...t, count: result ? tabCount[t.key] ?? 0 : null }));
  const hasFilters = list.hasFilters || dates.preset !== GRID_ANY_DATE.preset;
  const handleExport = async () => {
    setExporting(true);
    try { const p = new URLSearchParams(params); p.delete("page"); p.delete("pageSize"); exportGrid(await fetchExport(p), COLS, `refunds-${status}`); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Refunds"]} />
      {openId ? (
        <RefundRecord id={openId} canEdit={rights.canEdit} onBack={closeRefund} busy={busy}
          onEdit={(r, thenSubmit) => setEditing({ r, thenSubmit: !!thenSubmit })} onFinance={openFinance} onWithdraw={(r) => { setWithdrawing(r); setWithdrawReason(""); }} onSendBack={(r) => { setSendBack(r); setSendBackNote(""); }} onSubmit={submitRefund} />
      ) : (
        <>
          <MoneyBand eyebrow="CRM · Finance" title="Refunds" sub="Money given back: a cancelled booking's held credit or an overpayment, approved by CRM and paid through Finance."
            actions={<>
              <button type="button" onClick={() => navigate("/crm/credit-notes")} className={BAND_KEY} title="Every credit note, for the GST return"><FileText size={13} /> Credit Notes</button>
              {rights.canCreate && <button type="button" onClick={() => setShowNew(true)} className={BAND_KEY_MAIN}><Plus size={13} /> New Refund</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={fmtShort(paid)} leadNote={result ? `paid of ${fmtShort(raised)} raised · ${pct(paid, raised)}%` : ""}
            bar={<CollectionBar onDark due={raised} collected={paid} finance={withFinance} recorded={inCrm} title={`Raised ${fmt(raised)} · Paid ${fmt(paid)} · With Finance ${fmt(withFinance)} · With CRM ${fmt(inCrm)}`} />}
            figures={[
              { label: "Paid", dot: BAND_DOT.collected, value: fmtShort(paid), note: `${c("Paid").count} refund${c("Paid").count === 1 ? "" : "s"}`, exact: fmt(paid) },
              { label: "With Finance", dot: BAND_DOT.finance, value: fmtShort(withFinance), note: `${sum([...VOUCHER_NOT_RAISED, "FinanceApproved"], "count")} to pay out`, exact: fmt(withFinance) },
              { label: "With CRM", dot: BAND_DOT.recorded, value: fmtShort(inCrm), note: `${sum(CRM, "count")} to send or approve`, exact: fmt(inCrm) },
              { label: "RERA overdue", dot: BAND_DOT.overdue, value: String(overdue), note: "Past the refund due date", alert: overdue > 0 },
            ]}
            footer={[
              c("Paid").deduction > 0 ? `${fmt(c("Paid").deduction)} kept as cancellation deductions on paid refunds.` : null,
              !hasFilters && available > 0 ? `${fmt(available)} on account or held as credit is not claimed by any refund.` : null,
              sum(DROPPED, "count") > 0 ? `${[c("Rejected").count ? `${c("Rejected").count} rejected` : "", c("Withdrawn").count ? `${c("Withdrawn").count} withdrawn` : ""].filter(Boolean).join(" and ")}, ${fmt(sum(DROPPED, "net"))}, not counted above.` : null,
            ].filter(Boolean).join(" ") || undefined} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<string> label="Refunds" active={status} onChange={setStatus} tabs={tabs} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, mobile, refund or booking" />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Raised on" value={dates} onChange={setDates} />
              {hasFilters && <button type="button" onClick={() => { list.reset(); setDatesRaw(GRID_ANY_DATE); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={result?.rows ?? []} rowKey={(r) => r.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openRefund(r.Id)}
              empty={hasFilters || status !== "All" ? "No refund matches these filters." : "No refunds yet. Cancelling a booking makes a draft refund; one can also be raised for an overpayment."}
              page={list.page} pageSize={pageSize} total={result?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          </div>
          <RebookingCredits search={params.get("search") || ""} cpb={cpbParams} canEdit={rights.canEdit} />
        </>
      )}

      {showNew && rights.canCreate && <NewRefundDialog bookingId={sp.get("newForBooking")} onClose={() => setShowNew(false)} onDone={(id) => { invalidate(); if (id) openRefund(id); }} />}
      {editing && <EditDialog r={editing.r} thenSubmit={editing.thenSubmit} onClose={() => setEditing(null)} onDone={invalidate} />}

      {withdrawing && (
        <GridDialog onClose={() => setWithdrawing(null)} icon={XCircle} width="max-w-xl" title="Withdraw Refund" description={`${withdrawing.RefundNo} · ${personName(withdrawing.CustomerName)} · net ${fmt(withdrawing.NetAmount)}`}
          footer={<><button type="button" onClick={() => setWithdrawing(null)} className={GRID_BTN}>Keep It</button><button type="button" onClick={doWithdraw} disabled={busy || !withdrawReason.trim()} className={cn(GRID_BTN_BRAND, "!bg-destructive !border-destructive")}>{busy ? "Withdrawing…" : "Withdraw Refund"}</button></>}>
          <p className="mb-3 text-sm text-muted-foreground">The refund stays on record as Withdrawn and can't be sent or approved again. Nothing has been paid; the money it claims becomes free for a new refund or a re-booking.</p>
          <GridFormField label="Why it is withdrawn" required wide hint="Kept with the refund and in its approval history.">
            <textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} autoFocus placeholder="e.g. The customer chose to move the credit to a new booking" className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}

      {sendBack && (
        <GridDialog onClose={() => setSendBack(null)} icon={Undo2} width="max-w-xl" title="Send Back to CRM" description={`${sendBack.RefundNo} · ${personName(sendBack.CustomerName)} · no payout voucher is raised`}
          footer={<><button type="button" onClick={() => setSendBack(null)} className={GRID_BTN}>Cancel</button><button type="button" onClick={doSendBack} disabled={busy || !sendBackNote.trim()} className={GRID_BTN_BRAND}>{busy ? "Sending…" : "Send Back"}</button></>}>
          <GridFormField label="What needs fixing" required wide hint="CRM sees this and can correct the refund; the CRM approver then approves it again.">
            <textarea value={sendBackNote} onChange={(e) => setSendBackNote(e.target.value)} rows={3} autoFocus className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}

      {financeDialog && (
        <GridDialog onClose={closeFinance} icon={Banknote} width="max-w-2xl" title="Raise Payout Voucher" description="Raises the payout voucher in Finance → Payments; the refund is marked Paid once Finance approves that voucher."
          footer={<><button type="button" onClick={closeFinance} className={GRID_BTN}>Cancel</button><button type="button" onClick={raiseVoucher} disabled={!financeBank || busy} className={GRID_BTN_BRAND}>{busy ? "Raising…" : "Raise Payout Voucher"}</button></>}>
          <GridFacts items={[
            { label: "Customer", value: personName(financeDialog.CustomerName) },
            { label: "Net payout", value: <span className="font-semibold">{fmt(financeDialog.NetAmount)}</span> },
            { label: "To", value: [financeDialog.CustomerBankName, financeDialog.CustomerAccountNo, financeDialog.CustomerIfscCode].filter(Boolean).join(" · ") || "No account on file", wide: true },
          ]} />
          <GridFormSection title="Payout">
            <GridFormField label="Paid from (company bank)" required>
              <select value={financeBank} onChange={(e) => setFinanceBank(e.target.value)} className={GRID_INPUT}>
                <option value="">Select…</option>
                {(financeBanks as any[]).map((b) => <option key={b.BId} value={String(b.BId)}>{bankLabel(b)}</option>)}
              </select>
              <BankNote bank={findBank(financeBanks as any[], financeBank)} />
            </GridFormField>
            <GridFormField label="Payment mode" hint="Can be set later on the voucher.">
              <select value={financeMode} onChange={(e) => setFinanceMode(e.target.value)} className={GRID_INPUT}>
                <option value="">Not set yet</option>
                {(payModes?.modes ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmRefunds;
