import React, { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, ExternalLink, ArrowLeft, ArrowRightLeft, Banknote, Download, ListChecks, PenLine, RefreshCw, FileText, Wallet } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { ApprovalActions } from "@/components/ApprovalActions";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import {
  CrmGrid, GridColumnChooser, GridDateFilter, GridFields, GridMiniTable, GridRelated, GridSavedViews, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_CARD, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { useCrmListState, useSticky, listParams, type CrmSort } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, CollectionBar, Initials, MoneyBand, asName } from "./payments/parts";
import { fmtDate, fmtShort, pct } from "./payments/config";
import { findBank } from "@/components/crm/SelectedBankCard";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

import { useUrlParam } from "@/hooks/useUrlParam";
const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PREFS_KEY = "crm-refunds-cols-v1";
const VIEWS_KEY = "crm-refunds-views";
const SMALL_KEY = "h-7 px-2.5";
const REFUNDS_DEFAULT_SORT: CrmSort = { key: "", dir: "desc" };
const REFUND_TABS = [
  { key: "All", label: "All refunds" }, { key: "CRM", label: "With CRM" }, { key: "Voucher", label: "Voucher not raised" }, { key: "FinanceApproved", label: "With Finance" },
  { key: "Paid", label: "Paid" }, { key: "Rejected", label: "Rejected" }, { key: "Overdue", label: "RERA overdue" },
];
// What each status means to a reader. A refund has one Finance step: CRM approval raises its payout voucher,
// which Finance approves in Payments.
const STATUS_LABEL: Record<string, string> = {
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
const PAY_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque"];
const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const DIALOG = "rounded-none p-5 gap-4";
const SEL = `${INP} text-sm`;

type StatusCounts = Record<string, { count: number; net: number; gross: number; deduction: number; overdue: number }>;
async function fetchList(params: URLSearchParams): Promise<{ rows: any[]; total: number; statusCounts: StatusCounts }> {
  const r = await fetchWithAuth(`${API}?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the refunds.");
  return { rows: d.rows || [], total: d.total || 0, statusCounts: d.statusCounts || {} };
}
async function fetchExport(params: URLSearchParams): Promise<any[]> {
  const r = await fetchWithAuth(`${API}?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not export the refunds.");
  return Array.isArray(d) ? d : [];
}
async function fetchRefund(id: string): Promise<any> {
  const r = await fetchWithAuth(`${API}/${encodeURIComponent(id)}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load this refund.");
  return d;
}
async function fetchRefundNotes(id: string): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/${encodeURIComponent(id)}/gst-notes`);
  const d = await r.json().catch(() => null);
  return r.ok && Array.isArray(d) ? d : [];
}
async function fetchEligibleSources(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-sources`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the held credits and overpayments.");
  return Array.isArray(d) ? d : [];
}
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (projectId == null) return [];
  // excludeCash=1 — a refund is always paid by bank transfer or cheque to the customer, never from Cash in Hand.
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}?excludeCash=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Every bank account on file for the booking's customer, to pick from; manual entry otherwise.
async function fetchCustomerBanks(bookingId?: number | null): Promise<any[]> {
  if (bookingId == null) return [];
  try {
    const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`);
    if (!r.ok) return [];
    const d = await r.json();
    if (Array.isArray(d)) return d;
    if (d && (d.BankName || d.AccountNo)) return [d];
    return [];
  } catch { return []; }
}

const bankLabel = (b: any) => `${b.BName}${b.BBranch ? ` — ${b.BBranch}` : ""}${b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}`;
function BankNote({ bank }: { bank: any }) {
  if (!bank) return null;
  return (
    <div className="mt-1.5 px-3 py-2 text-xs" style={{ border: RULE_SOFT }}>
      <div className="font-medium">{bank.BName}</div>
      <div className="mt-0.5 text-muted-foreground flex flex-wrap gap-x-2 tabular-nums">
        {bank.BBranch && <span>{bank.BBranch}</span>}
        {bank.BIfscCode && <span>IFSC {bank.BIfscCode}</span>}
        {bank.BAccountLast4 && <span>A/c ••{bank.BAccountLast4}</span>}
      </div>
    </div>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: RULE_SOFT }}>
      <div className={`px-3 py-2 ${LBL}`} style={{ borderBottom: RULE_SOFT }}>{title}</div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

// ── New refund / re-booking dialog ─────────────────────────────────────────

/** `bookingId`: opened from a booking with excess money, so only that booking's money is offered. */
function NewRefundDialog({ onClose, onDone, bookingId }: { onClose: () => void; onDone: () => void; bookingId?: string | null }) {
  const [mode, setMode] = useState<"refund" | "rebook">("refund");
  const [picked, setPicked] = useState<any | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankLHeadId, setBankLHeadId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  // The customer's account: a saved bank ("__bank_<i>__") or manual entry ("__manual__").
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [cbName, setCbName] = useState("");
  const [cbAcc, setCbAcc] = useState("");
  const [cbIfsc, setCbIfsc] = useState("");
  const [toBookingId, setToBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: sources = [], isLoading: sourcesLoading, isError: sourcesError, error: sourcesErr } =
    useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: fetchEligibleSources });
  const offered = bookingId ? (sources as any[]).filter((x) => String(x.BookingId) === bookingId) : (sources as any[]);
  const { data: banks = [] } = useQuery({
    queryKey: ["crm-refund-project-banks", picked?.ProjectId],
    queryFn: () => fetchProjectBanks(picked?.ProjectId),
    enabled: picked?.ProjectId != null,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, enabled: mode === "rebook", staleTime: 5 * 60_000 });
  const { data: customerBanks = [] } = useQuery({
    queryKey: ["crm-refund-customer-banks", picked?.BookingId],
    queryFn: () => fetchCustomerBanks(picked?.BookingId),
    enabled: picked?.BookingId != null,
  });

  // One saved bank: take it. None: open manual entry. Several: leave it to staff to pick.
  useEffect(() => {
    if (!picked) return;
    if (customerBanks.length === 1) {
      const b = customerBanks[0];
      setSelectedBankId("__bank_0__");
      setCbName(b.BankName || ""); setCbAcc(b.AccountNo || ""); setCbIfsc(b.IfscCode || "");
    } else if (customerBanks.length === 0) {
      setSelectedBankId("__manual__");
    } else {
      setSelectedBankId("");
    }
  }, [customerBanks, picked]);

  const remaining = picked ? Number(picked.Remaining) : 0;
  const amt = Number(amount) || 0;
  const pct = picked && picked.SourceType === "CancellationHeldCredit" ? Number(picked.DeductionPercent || 0) : 0;
  const deduction = mode === "refund" ? Math.round((amt * pct) / 100 * 100) / 100 : 0;
  const net = Math.max(0, amt - deduction);
  const rebookTargets = (bookings as any[]).filter(
    (b) => picked && String(b.CustomerId ?? "") === String(picked.CustomerId ?? "") && !["Cancelled", "Rejected"].includes(b.Status),
  );

  const canRebook = picked?.SourceType === "CancellationHeldCredit";
  useEffect(() => { if (!canRebook && mode === "rebook") setMode("refund"); }, [canRebook, mode]);

  const isManual = selectedBankId === "__manual__";
  const hasBanks = customerBanks.length > 0;

  const handleBankSelect = (val: string) => {
    setSelectedBankId(val);
    if (val === "__manual__" || val === "") { setCbName(""); setCbAcc(""); setCbIfsc(""); return; }
    const b = customerBanks[parseInt(val.replace("__bank_", "").replace("__", ""), 10)];
    if (b) { setCbName(b.BankName || ""); setCbAcc(b.AccountNo || ""); setCbIfsc(b.IfscCode || ""); }
  };

  const submit = async () => {
    if (amt > remaining + 0.005) { toast.error(`At most ${fmt(remaining)} is available from this source`); return; }
    setSaving(true);
    try {
      if (mode === "rebook") {
        if (!picked || !toBookingId || amt <= 0) { toast.error("Pick a held credit, a target booking and an amount"); return; }
        const r = await fetchWithAuth(`${API}/rebooking-transfer`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ heldOnAccountId: picked.OnAccountId, toBookingId: Number(toBookingId), amount: amt }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        if (d.partialFailure && d.fundTransferId) {
          toast.warning(d.message || "Fund Transfer remains Draft; submit it when ready", {
            action: {
              label: "Submit for approval",
              onClick: async () => {
                try {
                  const submitResult = await fetchWithAuth(`${API}/rebooking-transfer/${d.id}/submit-fund-transfer`, { method: "PUT" });
                  const submitData = await submitResult.json();
                  if (!submitResult.ok) throw new Error(submitData.error || "Fund Transfer submission failed");
                  toast.success(submitData.message || "Fund Transfer submitted for approval");
                } catch (err: any) {
                  toast.error(err?.message || "Fund Transfer submission failed");
                }
              },
            },
          });
        } else if (d.partialFailure) {
          toast.warning(d.message || "Credit applied, but accounting follow-up is incomplete", {
            action: {
              label: "Retry ledger",
              onClick: async () => {
                try {
                  const retry = await fetchWithAuth(`${API}/rebooking-transfer/${d.id}/retry-ledger`, { method: "PUT" });
                  const retryResult = await retry.json();
                  if (!retry.ok) throw new Error(retryResult.error || "Ledger retry failed");
                  if (retryResult.partialFailure) toast.warning(retryResult.message || "Ledger follow-up is still incomplete");
                  else toast.success(retryResult.message || "Ledger entries updated");
                } catch (err: any) {
                  toast.error(err?.message || "Ledger retry failed");
                }
              },
            },
          });
        } else {
          toast.success(d.crossCompany
            ? `Inter-company transfer ${d.fundTransferDocNo || ""} raised — the credit lands once Finance approves it`
            : "Held credit applied to the booking");
        }
      } else {
        if (!picked) { toast.error("Pick a source"); return; }
        if (amt <= 0) { toast.error("Enter the amount to refund"); return; }
        const body: any = { GrossAmount: amt, Reason: reason || null, RefundBankLHeadId: bankLHeadId || null,
          CustomerBankName: cbName || null, CustomerAccountNo: cbAcc || null, CustomerIfscCode: cbIfsc || null,
          PreferredPaymentMode: paymentMode || null,
          SourceType: picked.SourceType, SourceOnAccountId: picked.OnAccountId };
        const r = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error);
        toast.success(`${d.RefundNo} raised — net ${fmt(d.NetAmount)}${d.DeductionAmount ? `, deduction ${fmt(d.DeductionAmount)}` : ""}`);
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  const modeTab = (on: boolean) => `flex-1 inline-flex items-center justify-center gap-2 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`max-w-xl max-h-[90vh] overflow-y-auto ${DIALOG}`} style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading">New refund / re-booking credit</DialogTitle>
          <DialogDescription className="text-xs">Pays back a cancelled booking's held credit or an overpayment — or moves held credit onto the customer's new booking.</DialogDescription>
        </DialogHeader>

        <Block title="Source of funds">
          <div>
            <label className={`block mb-1 ${LBL}`}>Held credit or overpayment *</label>
            <select
              value={picked ? String(picked.OnAccountId) : ""}
              onChange={(e) => {
                const s = (sources as any[]).find((x) => String(x.OnAccountId) === e.target.value) || null;
                setPicked(s);
                setAmount(s ? String(Number(s.Remaining)) : "");
                setBankLHeadId("");
                setSelectedBankId("");
                setCbName(""); setCbAcc(""); setCbIfsc("");
              }}
              className={SEL}
            >
              <option value="">{sourcesLoading ? "Loading…" : "Select a held credit or overpayment…"}</option>
              {offered.map((s) => (
                <option key={`${s.SourceType}-${s.OnAccountId}`} value={String(s.OnAccountId)}>
                  {`${SOURCE_LABEL[s.SourceType]} · ${s.CustomerName} · ${s.BookingNo}${s.CancellationNo ? ` (${s.CancellationNo})` : ""} · ${fmt(s.Remaining)} left`}
                </option>
              ))}
            </select>
            {sourcesError ? (
              <p className="text-xs text-destructive mt-1.5">{(sourcesErr as Error)?.message}</p>
            ) : !sourcesLoading && !sources.length ? (
              <p className="text-[0.6875rem] text-muted-foreground mt-1.5">No held credits or unapplied overpayments right now — a refund can only be raised against one.</p>
            ) : picked && (
              <div className="mt-2 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ border: RULE_SOFT }}>
                <span className="font-medium">{picked.CustomerName}</span>
                <span className="font-heading tabular-nums text-muted-foreground">{picked.BookingNo}</span>
                {picked.CancellationNo && <span className="font-heading tabular-nums text-muted-foreground">{picked.CancellationNo}</span>}
                <span className="ml-auto font-heading font-semibold tabular-nums">{fmt(picked.Remaining)} available</span>
              </div>
            )}
          </div>
        </Block>

        {canRebook && (
          <div className="flex items-stretch" style={{ border: RULE }}>
            <button type="button" onClick={() => setMode("refund")} className={modeTab(mode === "refund")} style={{ borderRight: RULE_SOFT }}><Banknote size={13} /> Refund to customer</button>
            <button type="button" onClick={() => setMode("rebook")} className={modeTab(mode === "rebook")}><ArrowRightLeft size={13} /> Apply to re-booking</button>
          </div>
        )}

        <Block title="Amount">
          <div className="flex gap-2">
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={`${INP} tabular-nums`} />
            {picked && <button type="button" onClick={() => setAmount(String(remaining))} className={`${KEY_LINE} h-9 px-3 shrink-0`}>Use all</button>}
          </div>
          {mode === "refund" && (
            <div className="grid grid-cols-3" style={{ border: RULE_SOFT }}>
              {[
                { l: "Gross", v: fmt(amt) },
                { l: `Deduction${pct ? ` (${pct}%)` : ""}`, v: fmt(deduction) },
                { l: "Net to customer", v: fmt(net), strong: true },
              ].map(({ l, v, strong }, i) => (
                <div key={l} className="px-3 py-2" style={{ borderLeft: i ? RULE_SOFT : undefined }}>
                  <div className={LBL}>{l}</div>
                  <div className={`mt-1 font-heading text-sm tabular-nums ${strong ? "font-bold" : "font-semibold"}`}>{v}</div>
                </div>
              ))}
            </div>
          )}
        </Block>

        {mode === "rebook" ? (
          <Block title="Apply to booking">
            <SearchableNativeSelect value={toBookingId} onChange={(e) => setToBookingId(e.target.value)} className={SEL}>
              <option value="">Select the target booking (same customer)…</option>
              {rebookTargets.map((b) => (
                <option key={b.Id} value={String(b.Id)}>{`${b.BookingNo} · ${b.ProjectName || b.UnitNo || ""} · ${b.CompanyId === picked?.CompanyId ? "same company" : "another company"}`}</option>
              ))}
            </SearchableNativeSelect>
            <p className="text-[0.6875rem] text-muted-foreground">A booking under another company raises an inter-company fund transfer for Finance to approve; the credit lands afterwards.</p>
          </Block>
        ) : (
          <Block title="Payout">
            <div>
              <label className={`block mb-1 ${LBL}`}>Company bank it's paid from</label>
              <select value={bankLHeadId} onChange={(e) => setBankLHeadId(e.target.value)} className={SEL}>
                <option value="">Finance picks it at approval</option>
                {(banks as any[]).map((b) => <option key={b.BId} value={String(b.BId)}>{bankLabel(b)}</option>)}
              </select>
              <BankNote bank={findBank(banks as any[], bankLHeadId)} />
            </div>
            <div>
              <label className={`block mb-1 ${LBL}`}>Payment mode <span className="normal-case tracking-normal">(Finance can set it later)</span></label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className={SEL}>
                <option value="">Not set yet</option>
                {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className={LBL}>Customer's account</label>
                {hasBanks && selectedBankId && !isManual && (
                  <button type="button" onClick={() => handleBankSelect("__manual__")} className="text-[0.6875rem] inline-flex items-center gap-1 underline underline-offset-2"><PenLine size={10} /> Enter another</button>
                )}
                {isManual && hasBanks && (
                  <button type="button" onClick={() => handleBankSelect("")} className="text-[0.6875rem] underline underline-offset-2">Pick a saved one</button>
                )}
              </div>
              {hasBanks && !isManual && (
                <select value={selectedBankId} onChange={(e) => handleBankSelect(e.target.value)} className={SEL}>
                  <option value="">Select the customer's bank account…</option>
                  {(customerBanks as any[]).map((b, i) => (
                    <option key={i} value={`__bank_${i}__`}>
                      {`${b.BankName || "—"}${b.BranchName ? ` · ${b.BranchName}` : ""} · A/c ${b.AccountNo ? `••${String(b.AccountNo).slice(-4)}` : "—"}${b.IfscCode ? ` · ${b.IfscCode}` : ""}`}
                    </option>
                  ))}
                  <option value="__manual__">Enter another account…</option>
                </select>
              )}
              {selectedBankId && !isManual && (cbName || cbAcc) && (
                <div className="mt-1.5 px-3 py-2 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5" style={{ border: RULE_SOFT }}>
                  {cbName && <><span className="text-muted-foreground">Bank</span><span className="font-medium">{cbName}</span></>}
                  {cbAcc && <><span className="text-muted-foreground">A/c no.</span><span className="font-heading tabular-nums">{cbAcc}</span></>}
                  {cbIfsc && <><span className="text-muted-foreground">IFSC</span><span className="font-heading tabular-nums">{cbIfsc}</span></>}
                  <span className="col-span-2 text-muted-foreground text-[0.6875rem] mt-0.5">From the customer's KYC — enter another if the account has changed.</span>
                </div>
              )}
              {(!hasBanks || isManual) && (
                <div className="space-y-2">
                  <BankNamePicker value={cbName} onChange={(v) => setCbName(v)} placeholder="Select the customer's bank…" otherPlaceholder="Bank name (if not listed)" sheet />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={cbAcc} onChange={(e) => setCbAcc(e.target.value)} placeholder="Account no." className={`${INP} tabular-nums`} />
                    <input value={cbIfsc} onChange={(e) => setCbIfsc(e.target.value.toUpperCase())} placeholder="IFSC" className={`${INP} tabular-nums`} />
                  </div>
                  {!hasBanks && picked?.BookingId != null && (
                    <p className="text-[0.6875rem] text-muted-foreground">No bank details on file for this customer — needed only for an NEFT / RTGS / IMPS / UPI refund; a cheque needs none.</p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className={`block mb-1 ${LBL}`}>Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this refund is raised" className={INP} />
            </div>
          </Block>
        )}

        <DialogFooter className="gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          <button onClick={submit} disabled={saving || !picked} className={`${KEY_INK} h-9 px-4`}>
            {saving ? "Saving…" : mode === "rebook" ? <><ArrowRightLeft size={13} /> Apply credit</> : <><Banknote size={13} /> Raise refund</>}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// What each step of a refund is. One Finance step: CRM approval raises the payout voucher, which Finance approves in Payments.
const STAGES = ["Raised", "CRM approved", "Voucher raised", "Paid"];
const stageOf = (s: string) => (s === "Paid" ? 4 : s === "FinanceApproved" ? 3 : s === "Approved" || s === "FinancePending" ? 2 : s === "Draft" ? 0 : 1);

function StageBar({ status, onDark }: { status: string; onDark?: boolean }) {
  const done = stageOf(status);
  const off = onDark ? "bg-white/15" : "bg-slate-200 dark:bg-slate-700";
  return (
    <span className="flex gap-0.5 w-full" title={`${STAGES[Math.max(0, done - 1)]} · step ${done} of ${STAGES.length}`}>
      {STAGES.map((s, i) => (
        <span key={s} className={cn("flex-1 rounded-full", onDark ? "h-2.5" : "h-1.5",
          i < done ? (done === STAGES.length ? (onDark ? BAND_DOT.collected : "bg-emerald-500") : (onDark ? BAND_DOT.finance : "bg-amber-400"))
            : status === "Rejected" && i === done ? "bg-rose-500" : off)} />
      ))}
    </span>
  );
}

const refundsDash = <span className="text-muted-foreground">—</span>;
const inr = (n: unknown) => (Number(n) > 0 ? <span className="tabular-nums" title={fmt(Number(n))}>{fmtShort(Number(n))}</span> : refundsDash);

function refundCols(actions: (r: any) => React.ReactNode): GridCol<any>[] {
  return [
    { id: "customer", label: "Customer", locked: true, sortKey: "CustomerName", csv: (r) => r.CustomerName, cell: (r) => (
      <span className="flex items-center gap-3 py-1.5 min-w-0">
        <Initials name={r.CustomerName} />
        <span className="min-w-0">
          <span className="block font-semibold text-foreground capitalize truncate" title={r.CustomerName}>{asName(r.CustomerName)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums truncate">{r.RefundNo}{r.BookingNo ? ` · ${r.BookingNo}` : ""}{r.UnitNo ? ` · ${r.UnitNo}` : ""}{r.ProjectName ? ` · ${r.ProjectName}` : ""}</span>
        </span>
      </span>
    ) },
    { id: "progress", label: "Progress", sortKey: "Status", csv: (r) => statusText(r.Status), cell: (r) => (
      <span className="block min-w-[13rem] py-1.5">
        <StageBar status={r.Status} />
        <span className="mt-1.5 flex justify-between gap-3 text-xs">
          <span className={cn("font-medium", r.Status === "Rejected" ? "text-destructive" : "text-foreground")} title={r.RejectionNote || undefined}>{statusText(r.Status)}</span>
          <span className="text-muted-foreground tabular-nums">{stageOf(r.Status)} of {STAGES.length}</span>
        </span>
      </span>
    ) },
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
    { id: "due", label: "RERA due", sortKey: "RefundDueDate", csv: (r) => r.RefundDueDate, cell: (r) => (!r.RefundDueDate || r.Status === "Paid" ? refundsDash : (
      <span className="inline-flex flex-col leading-tight">
        <span className="tabular-nums">{fmtDate(r.RefundDueDate)}</span>
        <span className={cn("mt-0.5 text-xs tabular-nums", r.IsOverdue ? "font-semibold text-destructive" : "text-muted-foreground")}>{r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`}</span>
      </span>
    )) },
    { id: "act", label: "Actions", locked: true, cell: actions },
    // Under Columns, for whoever needs them; the export writes them all.
    { id: "no", label: "Refund no", hiddenByDefault: true, sortKey: "RefundNo", cell: (r) => <span className="tabular-nums">{r.RefundNo}</span>, csv: (r) => r.RefundNo },
    { id: "booking", label: "Booking", hiddenByDefault: true, sortKey: "BookingNo", cell: (r) => <span className="tabular-nums">{r.BookingNo || "—"}</span>, csv: (r) => r.BookingNo },
    { id: "unit", label: "Unit", hiddenByDefault: true, cell: (r) => r.UnitNo || "—", csv: (r) => r.UnitNo },
    { id: "project", label: "Project", hiddenByDefault: true, cell: (r) => r.ProjectName || "—", csv: (r) => r.ProjectName },
    { id: "mobile", label: "Mobile", hiddenByDefault: true, cell: (r) => <span className="tabular-nums">{r.Mobile || "—"}</span>, csv: (r) => r.Mobile },
    { id: "gross", label: "Gross", align: "right", hiddenByDefault: true, sortKey: "GrossAmount", cell: (r) => inr(r.GrossAmount), csv: (r) => r.GrossAmount },
    { id: "deduction", label: "Deduction", align: "right", hiddenByDefault: true, cell: (r) => inr(r.DeductionAmount), csv: (r) => r.DeductionAmount },
    { id: "bank", label: "Company bank", hiddenByDefault: true, cell: (r) => r.RefundBankName || "—", csv: (r) => r.RefundBankName },
    { id: "raisedBy", label: "Raised by", hiddenByDefault: true, cell: (r) => r.RequestedByName || "—", csv: (r) => r.RequestedByName },
    { id: "raised", label: "Raised on", hiddenByDefault: true, sortKey: "CreatedAt", cell: (r) => <span className="tabular-nums">{fmtDate(r.RequestedAt || r.CreatedAt)}</span>, csv: (r) => r.RequestedAt || r.CreatedAt },
    { id: "paid", label: "Paid on", hiddenByDefault: true, sortKey: "PaidAt", cell: (r) => (r.PaidAt ? <span className="tabular-nums">{fmtDate(r.PaidAt)}</span> : refundsDash), csv: (r) => r.PaidAt },
    { id: "note", label: "Rejection note", hiddenByDefault: true, cell: (r) => r.RejectionNote || "—", csv: (r) => r.RejectionNote },
  ];
}

// In one sentence: where the refund stands and what happens next.
function nextStep(r: any): string {
  switch (r.Status) {
    case "Draft": return "Draft. It has not been sent for approval, and no money has moved.";
    case "Pending": return r.RejectionNote ? `Sent back: ${r.RejectionNote.replace(/^\[[^\]]*\]\s*/, "")}` : "Waiting for CRM approval. No money has moved.";
    case "Approved": case "FinancePending": return r.RejectionNote ? r.RejectionNote.replace(/^\[[^\]]*\]\s*/, "") : "Approved. The payout voucher still has to be raised for Finance.";
    case "FinanceApproved": return "The payout voucher is with Finance in Payments. The refund is marked Paid once Finance approves it.";
    case "Paid": return `Paid on ${fmtDate(r.PaidAt)}.`;
    case "Rejected": return `Rejected${r.RejectionNote ? `: ${r.RejectionNote}` : "."} It can be corrected and sent again.`;
    default: return "";
  }
}

function RefundRecord({ id, actions, onBack }: { id: string; actions: (r: any) => React.ReactNode; onBack: () => void }) {
  const { data: r, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: ["crm-refunds", "record", id], queryFn: () => fetchRefund(id), retry: false });
  const { data: notes = [] } = useQuery({ queryKey: ["crm-refunds", "record-notes", id], queryFn: () => fetchRefundNotes(id), enabled: r?.Status === "Paid" });
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !r) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{translateError((error as Error)?.message || "Refund not found")}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All refunds</button>
    </div>
  );
  const trail = [
    { step: "Raised", by: r.RequestedByName, at: r.RequestedAt || r.CreatedAt },
    { step: "CRM approved", by: r.ApprovedByName, at: r.ApprovedAt },
    { step: "Voucher raised by Finance", by: r.FinanceClearedByName, at: r.FinanceClearedAt },
    { step: "Paid", by: null, at: r.PaidAt },
  ].filter((t) => t.at);
  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Refund · ${r.RefundNo}`} title={<span className="capitalize">{asName(r.CustomerName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(r.Status)}</span>}
        sub={[r.BookingNo, r.UnitNo, r.ProjectName, r.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All refunds</button>
          {r.BookingId != null && <Link to={`/crm/bookings?view=${r.BookingId}`} className={BAND_KEY}><ExternalLink size={13} /> Open booking</Link>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(r.NetAmount)} leadNote={`net payout of ${fmtShort(r.GrossAmount)} gross`}
        bar={<StageBar status={r.Status} onDark />}
        figures={[
          { label: "Gross", value: fmtShort(r.GrossAmount), note: SOURCE_LABEL[r.SourceType] || r.SourceType, exact: fmt(r.GrossAmount) },
          { label: "Deduction", value: fmtShort(r.DeductionAmount), note: Number(r.DeductionAmount) > 0 ? `${r.DeductionPercent}% kept` : "None", exact: fmt(r.DeductionAmount) },
          { label: "Net payout", dot: BAND_DOT.collected, value: fmtShort(r.NetAmount), note: r.PreferredPaymentMode || "Mode not set", exact: fmt(r.NetAmount) },
          { label: "RERA due", dot: r.IsOverdue ? BAND_DOT.overdue : undefined, value: r.RefundDueDate ? fmtDate(r.RefundDueDate) : "—", note: r.Status === "Paid" || !r.RefundDueDate ? "No date running" : r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`, alert: !!r.IsOverdue },
        ]}
        footer={nextStep(r)} />
      <GridRelated icon={ListChecks} title="Actions and steps" action={actions(r)}>
        <GridMiniTable rows={trail} rowKey={(t) => t.step} empty="No steps recorded." cols={[
          { header: "Step", cell: (t) => <span className="font-medium">{t.step}</span> },
          { header: "By", cell: (t) => <span className="text-muted-foreground">{t.by || "—"}</span> },
          { header: "When", cell: (t) => <span className="tabular-nums">{fmtDate(t.at)}</span> },
        ]} />
      </GridRelated>
      <GridRelated icon={Wallet} title="Source of funds">
        <GridFields fields={[
          { label: "Comes from", value: SOURCE_LABEL[r.SourceType] || r.SourceType },
          { label: "Cancellation", value: r.CancellationNo || "—" },
          { label: "Booking", value: r.BookingNo || "—" },
          { label: "Customer no", value: r.CustomerNo || "—" },
          { label: "Reason", value: r.Reason || "—", wide: true },
        ]} />
      </GridRelated>
      <GridRelated icon={Banknote} title="Payout">
        <GridFields fields={[
          { label: "Customer's bank", value: r.CustomerBankName || "—" },
          { label: "Customer's account", value: <span className="tabular-nums">{r.CustomerAccountNo || "—"}</span> },
          { label: "IFSC", value: <span className="tabular-nums">{r.CustomerIfscCode || "—"}</span> },
          { label: "Payment mode", value: r.PreferredPaymentMode || "—" },
          { label: "Paid from", value: r.RefundBankName || "—" },
          { label: "Paid on", value: r.PaidAt ? fmtDate(r.PaidAt) : "—" },
        ]} />
      </GridRelated>
      {r.Status === "Paid" && (
        <GridRelated icon={FileText} title="GST documents" count={notes.length}>
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
    </div>
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
  // In the address, so a refresh or a shared link keeps it.
  const [status, setStatusRaw] = useUrlParam<string>("status", "All");
  const setStatus = (s: string) => { setStatusRaw(s); list.setPage(1); };
  const [dates, setDatesRaw] = useState<GridDateRange>(GRID_ANY_DATE);
  const setDates = (d: GridDateRange) => { setDatesRaw(d); list.setPage(1); };
  const [exporting, setExporting] = useState(false);
  const [showNew, setShowNew] = useState(() => !!sp.get("newForBooking"));
  const [financeDialog, setFinanceDialog] = useState<any | null>(null);
  const [sendBack, setSendBack] = useState<any | null>(null);
  const [sendBackNote, setSendBackNote] = useState("");
  const [financeBank, setFinanceBank] = useState("");
  const [financeMode, setFinanceMode] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  // The open refund lives in the address. ?id= is how the Cancellations page links here.
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
  const key = params.toString();
  const { data, isLoading, error, isFetching, refetch } = useQuery({ queryKey: ["crm-refunds", "list", key], queryFn: () => fetchList(params), staleTime: 20_000 });
  const result = useSticky(data);
  const counts = result?.statusCounts ?? {};

  const { data: sources = [] } = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: fetchEligibleSources, staleTime: 60_000 });
  const { data: financeBanks = [] } = useQuery({
    queryKey: ["crm-refund-project-banks", financeDialog?.ProjectId],
    queryFn: () => fetchProjectBanks(financeDialog?.ProjectId),
    enabled: !!financeDialog?.ProjectId,
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["crm-refunds"] }); qc.invalidateQueries({ queryKey: ["crm-refund-eligible-sources"] }); };
  const closeFinance = () => { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); };
  const openFinance = (r: any) => { setFinanceDialog(r); setFinanceBank(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : ""); setFinanceMode(r.PreferredPaymentMode || ""); };

  const financeAction = async (id: number, action: "finance-approve" | "finance-reject", body?: object) => {
    setBusyId(id);
    try {
      const r = await fetchWithAuth(`${API}/${id}/${action}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error);
      toast.success(action === "finance-approve" ? `Payout voucher ${d.docNo || ""} raised` : "Sent back to CRM");
      closeFinance();
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusyId(null); }
  };

  const actions = (r: any) => (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      {["Draft", "Pending", "Rejected"].includes(r.Status) && (
        <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} onSuccess={invalidate} extraSubmitStatuses={["Draft"]} submitOnly sheet />
      )}
      {(r.Status === "FinancePending" || (r.Status === "Approved" && r.FinanceNewPaymentId == null)) && rights.canEdit && (
        <button type="button" onClick={() => openFinance(r)} className={cn(GRID_SHEET_KEYS.KEY_INK, SMALL_KEY)} title="Raises the payout voucher in Finance → Payments, where Finance approves it">Send to Finance</button>
      )}
      {r.Status === "FinancePending" && rights.canEdit && (
        <button type="button" onClick={() => { setSendBack(r); setSendBackNote(""); }} disabled={busyId === r.Id} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL_KEY, "!text-destructive")}>Send back</button>
      )}
      {r.FinanceNewPaymentId != null && (
        <button type="button" onClick={() => navigate(`/payments?view=${r.FinanceNewPaymentId}`)} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL_KEY)}>{r.Status === "Paid" ? "Payment" : "Open in Payments"} <ExternalLink size={11} /></button>
      )}
      {r.Status === "Paid" && (
        <button type="button" onClick={() => navigate(`/crm/credit-notes?refundId=${r.Id}`)} className={cn(GRID_SHEET_KEYS.KEY_LINE, SMALL_KEY)} title="GST documents for this refund">Credit note</button>
      )}
    </span>
  );
  const cols = refundCols(actions);
  const [prefs, setPrefs] = useGridPrefs(PREFS_KEY, cols);

  const c = (s: string) => counts[s] ?? { count: 0, net: 0, gross: 0, deduction: 0, overdue: 0 };
  const allStatuses = Object.values(counts);
  const sum = (keys: string[], f: "count" | "net") => keys.reduce((s, k) => s + (Number(c(k)[f]) || 0), 0);
  const CRM = ["Draft", "Pending"], VOUCHER = ["Approved", "FinancePending"];
  const raised = allStatuses.reduce((s, x) => s + x.net, 0) - c("Rejected").net;
  const paid = c("Paid").net;
  const withFinance = sum([...VOUCHER, "FinanceApproved"], "net");
  const inCrm = sum(CRM, "net");
  const overdue = allStatuses.reduce((s, x) => s + x.overdue, 0);
  const allCount = allStatuses.reduce((s, x) => s + x.count, 0);
  const available = (sources as any[]).reduce((s, x) => s + (Number(x.Remaining) || 0), 0);
  const tabs: { key: string; label: string; count: number | null }[] = result ? [
    { key: "All", label: "All refunds", count: allCount },
    { key: "CRM", label: "With CRM", count: sum(CRM, "count") },
    { key: "Voucher", label: "Voucher not raised", count: sum(VOUCHER, "count") },
    { key: "FinanceApproved", label: "With Finance", count: c("FinanceApproved").count },
    { key: "Paid", label: "Paid", count: c("Paid").count },
    { key: "Rejected", label: "Rejected", count: c("Rejected").count },
    { key: "Overdue", label: "RERA overdue", count: overdue },
  ] : REFUND_TABS.map((t) => ({ ...t, count: null }));

  const hasFilters = list.hasFilters || dates.preset !== GRID_ANY_DATE.preset;
  const clearFilters = () => { list.reset(); setDatesRaw(GRID_ANY_DATE); };
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = new URLSearchParams(params);
      p.delete("page"); p.delete("pageSize");
      exportGrid(await fetchExport(p), cols, `refunds-${status}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Refunds"]} />
      {openId ? <RefundRecord id={openId} actions={actions} onBack={closeRefund} /> : (
      <>
      <MoneyBand eyebrow="CRM · Finance" title="Refunds" sub="Money given back: a cancelled booking's held credit or an overpayment, paid through Finance."
        actions={<>
          <button type="button" onClick={() => navigate("/crm/credit-notes")} className={BAND_KEY} title="Every credit note, for the GST return"><FileText size={13} /> Credit notes</button>
          {rights.canCreate && <button type="button" onClick={() => setShowNew(true)} className={BAND_KEY_MAIN}><Plus size={13} /> New refund</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={fmtShort(paid)} leadNote={result ? `paid of ${fmtShort(raised)} raised · ${pct(paid, raised)}%` : ""}
        bar={<CollectionBar onDark due={raised} collected={paid} finance={withFinance} recorded={inCrm} title={`Raised ${fmt(raised)} · Paid ${fmt(paid)} · With Finance ${fmt(withFinance)} · With CRM ${fmt(inCrm)}`} />}
        figures={[
          { label: "Paid", dot: BAND_DOT.collected, value: fmtShort(paid), note: `${c("Paid").count} refund${c("Paid").count === 1 ? "" : "s"}`, exact: fmt(paid) },
          { label: "With Finance", dot: BAND_DOT.finance, value: fmtShort(withFinance), note: `${sum([...VOUCHER, "FinanceApproved"], "count")} to pay out`, exact: fmt(withFinance) },
          { label: "With CRM", dot: BAND_DOT.recorded, value: fmtShort(inCrm), note: `${sum(CRM, "count")} awaiting approval`, exact: fmt(inCrm) },
          { label: "RERA overdue", dot: BAND_DOT.overdue, value: String(overdue), note: "Past the refund due date", alert: overdue > 0 },
        ]}
        footer={[
          c("Paid").deduction > 0 ? `${fmt(c("Paid").deduction)} kept as cancellation deductions on paid refunds.` : null,
          !hasFilters && available > 0 ? `${fmt(available)} on account or held as credit is not claimed by any refund.` : null,
          c("Rejected").count > 0 ? `${c("Rejected").count} rejected, ${fmt(c("Rejected").net)}, not counted above.` : null,
        ].filter(Boolean).join(" ") || undefined} />
      <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
        <GridTabs<string> label="Refunds" active={status} onChange={setStatus} tabs={tabs} />
        <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
          <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, mobile, refund or booking" />
          <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
          <GridDateFilter label="Raised on" value={dates} onChange={setDates} />
          {hasFilters && <button type="button" onClick={clearFilters} className={GRID_BTN}>Clear filters</button>}
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
          sort={list.sort} onSort={list.toggleSort} onRowClick={(r) => openRefund(r.Id)}
          empty={hasFilters || status !== "All" ? "No refund matches these filters." : "No refunds yet. Cancelling a booking creates a draft refund; one can also be raised for an overpayment."}
          page={list.page} pageSize={pageSize} total={result?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
      </div>
      </>
      )}

      {showNew && rights.canCreate && <NewRefundDialog bookingId={sp.get("newForBooking")} onClose={() => setShowNew(false)} onDone={invalidate} />}

      {sendBack && (
        <Dialog open onOpenChange={(o) => { if (!o) setSendBack(null); }}>
          <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
            <DialogHeader>
              <DialogTitle className="font-heading">Send {sendBack.RefundNo} back to CRM?</DialogTitle>
              <DialogDescription className="text-xs">No payout voucher is raised. CRM sees your reason and can correct the refund.</DialogDescription>
            </DialogHeader>
            <div>
              <label className={`block mb-1 ${LBL}`}>What needs fixing *</label>
              <textarea value={sendBackNote} onChange={(e) => setSendBackNote(e.target.value)} rows={3} autoFocus className={`${INP} w-full text-sm h-auto py-2`} />
            </div>
            <DialogFooter className="gap-2">
              <button onClick={() => setSendBack(null)} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
              <button onClick={async () => { await financeAction(sendBack.Id, "finance-reject", { note: sendBackNote.trim() }); setSendBack(null); }}
                disabled={busyId === sendBack.Id || !sendBackNote.trim()} className={`${KEY_INK} h-9 px-4`}>{busyId === sendBack.Id ? "Sending…" : "Send back"}</button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={!!financeDialog} onOpenChange={(o) => { if (!o) closeFinance(); }}>
        <DialogContent className={`max-w-md ${DIALOG}`} style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading">Send {financeDialog?.RefundNo} to Finance</DialogTitle>
            <DialogDescription className="text-xs">Raises a payout voucher in Finance → Payments; the refund is marked Paid once Finance approves that voucher.</DialogDescription>
          </DialogHeader>
          <div style={{ border: RULE_SOFT }}>
            {[
              { l: "Customer", v: financeDialog?.CustomerName },
              { l: "Net payout", v: fmt(financeDialog?.NetAmount), num: true },
              { l: "To", v: [financeDialog?.CustomerBankName, financeDialog?.CustomerAccountNo, financeDialog?.CustomerIfscCode].filter(Boolean).join(" · ") || "—", num: true },
            ].map(({ l, v, num }) => (
              <div key={l} className="flex justify-between items-center gap-3 px-3 py-2" style={{ borderBottom: RULE_SOFT }}>
                <span className={LBL}>{l}</span>
                <span className={`text-sm text-right ${num ? "font-heading tabular-nums" : "font-medium"}`}>{v}</span>
              </div>
            ))}
          </div>
          <div>
            <label className={`block mb-1 ${LBL}`}>Company bank it's paid from *</label>
            <select value={financeBank} onChange={(e) => setFinanceBank(e.target.value)} className={SEL}>
              <option value="">Select…</option>
              {(financeBanks as any[]).map((b) => <option key={b.BId} value={String(b.BId)}>{bankLabel(b)}</option>)}
            </select>
            <BankNote bank={findBank(financeBanks as any[], financeBank)} />
          </div>
          <div>
            <label className={`block mb-1 ${LBL}`}>Payment mode <span className="normal-case tracking-normal">(can be set later)</span></label>
            <select value={financeMode} onChange={(e) => setFinanceMode(e.target.value)} className={SEL}>
              <option value="">Not set yet</option>
              {PAY_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <DialogFooter className="gap-2">
            <button onClick={closeFinance} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button onClick={() => financeAction(financeDialog.Id, "finance-approve", { RefundBankLHeadId: financeBank || undefined, PaymentMode: financeMode || undefined })}
              disabled={!financeBank || busyId === financeDialog?.Id} className={`${KEY_INK} h-9 px-4`}>
              {busyId === financeDialog?.Id ? "Raising…" : "Raise payout"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CrmRefunds;
