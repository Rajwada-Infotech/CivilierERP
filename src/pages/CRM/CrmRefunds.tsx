import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, ExternalLink, ArrowRightLeft, Banknote, PenLine, RefreshCw, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { findBank } from "@/components/crm/SelectedBankCard";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PAGE_SIZE = 20;

const STATUS_TABS = ["All", "Draft", "Pending", "FinancePending", "FinanceApproved", "Paid", "Rejected"] as const;
// What each status means to a reader. A refund has one Finance step: CRM approval raises its payout voucher,
// which Finance approves in Payments.
const STATUS_LABEL: Record<string, string> = {
  Pending: "Awaiting CRM approval",
  FinancePending: "Voucher not raised",
  FinanceApproved: "With Finance",
};
const statusText = (s: string) => STATUS_LABEL[s] || s;
const statusTone = (s: string): "done" | "waiting" | "stopped" => (s === "Paid" ? "done" : s === "Rejected" ? "stopped" : "waiting");
const SOURCE_LABEL: Record<string, string> = {
  CancellationHeldCredit: "Cancelled booking",
  OverpaymentOnAccount: "Overpayment",
  Manual: "Manual",
};
const PAY_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque"];
const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const DIALOG = "rounded-none p-5 gap-4";
const SEL = `${INP} text-sm`;

type StatusCounts = Record<string, { count: number; net: number; overdue: number }>;
interface Filters { search: string; companyId: string; projectId: string; blockId: string; status: string }
async function fetchList(f: Filters, page: number): Promise<{ rows: any[]; total: number; statusCounts: StatusCounts }> {
  const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.search) p.set("search", f.search);
  if (f.companyId) p.set("companyId", f.companyId);
  if (f.projectId) p.set("projectId", f.projectId);
  if (f.blockId) p.set("blockId", f.blockId);
  if (f.status && f.status !== "All") p.set("status", f.status);
  const r = await fetchWithAuth(`${API}?${p}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "Could not load the refunds.");
  return { rows: d.rows || [], total: d.total || 0, statusCounts: d.statusCounts || {} };
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

function NewRefundDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
        toast.success(d.crossCompany
          ? `Inter-company transfer ${d.fundTransferDocNo || ""} raised — the credit lands once Finance approves it`
          : "Held credit applied to the booking");
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
              {(sources as any[]).map((s) => (
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

const CrmRefunds: React.FC = () => {
  const rights = usePageRights("crm-refunds");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  // ?search= (e.g. from a credit note) opens the list filtered to that refund.
  const [searchInput, setSearchInput] = useState(() => sp.get("search") || "");
  const [search, setSearch] = useState(() => sp.get("search") || "");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [status, setStatus] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [financeDialog, setFinanceDialog] = useState<any | null>(null);
  const [financeBank, setFinanceBank] = useState("");
  const [financeMode, setFinanceMode] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const filters = useMemo<Filters>(() => ({ search, status, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }), [search, status, cpb]);
  const { data: result, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-refunds", filters, page],
    queryFn: () => fetchList(filters, page),
    placeholderData: (prev) => prev,
    staleTime: 20_000,
  });
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const counts = result?.statusCounts ?? {};

  const { data: financeBanks = [] } = useQuery({
    queryKey: ["crm-refund-project-banks", financeDialog?.ProjectId],
    queryFn: () => fetchProjectBanks(financeDialog?.ProjectId),
    enabled: !!financeDialog?.ProjectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["crm-refunds"] });
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

  const c = (s: string) => counts[s] ?? { count: 0, net: 0, overdue: 0 };
  const allCount = Object.values(counts).reduce((s, x) => s + x.count, 0);
  const overdue = Object.values(counts).reduce((s, x) => s + x.overdue, 0);
  const inCrm = c("Draft").count + c("Pending").count;
  const withFinance = c("Approved").count + c("FinancePending").count + c("FinanceApproved").count;
  const figures = [
    { label: "With CRM", value: String(inCrm), note: `${fmt(c("Draft").net + c("Pending").net)} · drafts and awaiting approval`, status: "Pending" },
    { label: "With Finance", value: String(withFinance), note: `${fmt(c("Approved").net + c("FinancePending").net + c("FinanceApproved").net)} to pay out`, status: "FinanceApproved" },
    { label: "Paid", value: String(c("Paid").count), note: `${fmt(c("Paid").net)} refunded`, status: "Paid" },
    { label: "RERA overdue", value: String(overdue), note: "Past the refund due date, unpaid", status: "", red: overdue > 0 },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const th = `!px-4 !py-2.5 text-left ${LBL}`;
  const td = "!px-4 !py-3";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Refunds"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Refunds"
        subtitle="Money given back: a cancelled booking's held credit or an overpayment, refunded through Finance — or held credit moved onto the customer's re-booking."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            <button onClick={() => navigate("/crm/credit-notes")} className={`${KEY_LINE} h-9 px-4`} title="Every credit note, for the GST return"><FileText size={13} /> Credit notes</button>
            {rights.canCreate && <button onClick={() => setShowNew(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New refund</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => { setStatus(x.status || "All"); setPage(1); }} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading && !result ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {STATUS_TABS.map((s) => (
                  <button key={s} onClick={() => { setStatus(s); setPage(1); }} className={tabClass(status === s)} style={{ borderRight: RULE_SOFT }}>
                    {statusText(s)} <span className="tabular-nums">{s === "All" ? allCount : c(s).count}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput.trim()); setPage(1); } }}
                  placeholder="Search customer, refund no, booking, cancellation…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
              </div>
            </div>

            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[980px]">
                <thead>
                  <tr style={{ borderBottom: RULE }}>
                    <th className={th}>Refund</th><th className={th}>Customer · source</th>
                    <th className={`${th} !text-right`}>Gross</th><th className={`${th} !text-right`}>Deduction</th><th className={`${th} !text-right`}>Net</th>
                    <th className={th}>State</th><th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {isError ? (
                    <tr><td colSpan={7} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                  ) : isLoading && !result ? (
                    <tr><td colSpan={7} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={7} className={`${td} text-center text-muted-foreground`}>
                      {search || status !== "All" || cpb.companyId || cpb.projectId ? "No refund matches." : "No refunds yet. Cancelling a booking creates a draft refund; one can also be raised for an overpayment."}
                    </td></tr>
                  ) : rows.map((r: any) => {
                    const ded = Number(r.DeductionAmount) || 0;
                    return (
                      <tr key={r.Id} className="align-top" style={{ borderBottom: RULE_SOFT, boxShadow: r.IsOverdue ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}>
                        <td className={`${td} whitespace-nowrap`}><span className="font-heading text-xs font-semibold tabular-nums">{r.RefundNo}</span></td>
                        <td className={td}>
                          <div className="text-xs font-medium">{r.CustomerName}</div>
                          <div className="mt-1 text-[0.6875rem] text-muted-foreground">
                            {SOURCE_LABEL[r.SourceType] || r.SourceType}
                            <span className="font-heading tabular-nums">{r.CancellationNo ? ` · ${r.CancellationNo}` : r.BookingNo ? ` · ${r.BookingNo}` : ""}</span>
                          </div>
                        </td>
                        <td className={`${td} text-right font-heading tabular-nums text-xs`}>{fmt(r.GrossAmount)}</td>
                        <td className={`${td} text-right tabular-nums text-xs`}>{ded > 0 ? <><span className="font-heading">{fmt(ded)}</span> <span className="text-muted-foreground">({r.DeductionPercent}%)</span></> : <span className="text-muted-foreground">—</span>}</td>
                        <td className={`${td} text-right font-heading font-semibold tabular-nums`}>{fmt(r.NetAmount)}</td>
                        <td className={td}>
                          <SheetMark text={statusText(r.Status)} tone={statusTone(r.Status)} />
                          {r.IsOverdue ? <div className="mt-1 text-[0.6875rem] font-semibold text-destructive">RERA overdue</div> : null}
                        </td>
                        <td className={`${td} text-right`}>
                          <div className="inline-flex items-center gap-2 flex-wrap justify-end">
                            {["Draft", "Pending", "Rejected"].includes(r.Status) && (
                              <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} onSuccess={invalidate} extraSubmitStatuses={["Draft"]} submitOnly sheet />
                            )}
                            {(r.Status === "FinancePending" || (r.Status === "Approved" && r.FinanceNewPaymentId == null)) && rights.canEdit && (
                              <button onClick={() => openFinance(r)} className={`${KEY_INK} h-8 px-3`}
                                title="Raises the payout voucher in Finance → Payments, where Finance approves it">Send to Finance</button>
                            )}
                            {r.Status === "FinancePending" && rights.canEdit && (
                              <button onClick={() => financeAction(r.Id, "finance-reject", { note: "Sent back" })} disabled={busyId === r.Id}
                                className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}>Send back</button>
                            )}
                            {r.FinanceNewPaymentId != null && (
                              <button onClick={() => navigate(`/payments?view=${r.FinanceNewPaymentId}`)} className={`${KEY_LINE} h-8 px-3`}>
                                {r.Status === "Paid" ? "Payment" : "Open in Payments"} <ExternalLink size={11} />
                              </button>
                            )}
                            {r.Status === "Paid" && (
                              <button onClick={() => navigate(`/crm/credit-notes?refundId=${r.Id}`)} className={`${KEY_LINE} h-8 px-3`} title="Credit note for this refund">Credit note</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
          </div>
        </div>

        {showNew && <NewRefundDialog onClose={() => setShowNew(false)} onDone={invalidate} />}

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
      </SheetShell>
    </>
  );
};

export default CrmRefunds;
