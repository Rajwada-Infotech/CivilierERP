import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Plus, CheckCircle2, AlertTriangle, ExternalLink, ArrowRightLeft, Wallet, Landmark, ReceiptText, Banknote, Building2, PenLine } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BankNamePicker } from "@/components/finance/BankNamePicker";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SelectedBankCard, findBank } from "@/components/crm/SelectedBankCard";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PAGE_SIZE = 20;

const LABEL = "text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-wide block mb-1.5";
const FIELD = "w-full h-9 text-sm border border-border rounded-lg px-2.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-shadow";

const STATUS_TABS = ["All", "Draft", "Pending", "FinancePending", "FinanceApproved", "Paid", "Rejected"] as const;
const statusColor: Record<string, string> = {
  Draft: "text-slate-600 bg-slate-50 border-slate-200",
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  FinancePending: "text-purple-600 bg-purple-50 border-purple-200",
  FinanceApproved: "text-blue-600 bg-blue-50 border-blue-200",
  Paid: "text-green-600 bg-green-50 border-green-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
};
// What each status means to a reader. A refund has one Finance step: CRM
// approval raises its payout voucher, which Finance approves in Payments.
const STATUS_LABEL: Record<string, string> = {
  Pending: "Awaiting CRM approval",
  FinancePending: "Voucher not raised",
  FinanceApproved: "With Finance",
};
const SOURCE_LABEL: Record<string, string> = {
  CancellationHeldCredit: "Cancelled booking",
  OverpaymentOnAccount: "Overpayment",
  Manual: "Manual",
};
const PAY_MODES = ["NEFT", "RTGS", "IMPS", "UPI", "Cheque"];
const fmt = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

interface Filters { search: string; companyId: string; projectId: string; blockId: string; status: string }
async function fetchList(f: Filters, page: number): Promise<{ rows: any[]; total: number }> {
  const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (f.search) p.set("search", f.search);
  if (f.companyId) p.set("companyId", f.companyId);
  if (f.projectId) p.set("projectId", f.projectId);
  if (f.blockId) p.set("blockId", f.blockId);
  if (f.status && f.status !== "All") p.set("status", f.status);
  try {
    const r = await fetchWithAuth(`${API}?${p}`);
    if (!r.ok) return { rows: [], total: 0 };
    const d = await r.json();
    return { rows: d.rows || [], total: d.total || 0 };
  } catch { return { rows: [], total: 0 }; }
}
async function fetchEligibleSources(customerId?: number): Promise<any[]> {
  const q = customerId ? `?customerId=${customerId}` : "";
  try { const r = await fetchWithAuth(`${API}/eligible-sources${q}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (projectId == null) return [];
  // excludeCash=1 — a refund is always disbursed as a bank transfer to the
  // customer's own account; Cash in Hand (selectable elsewhere, e.g. a cash
  // payment mode on NewPayment) has no business appearing as a refund's
  // disbursing bank. See crmProjectBanks.js's /for-project comment.
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}?excludeCash=1`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
// Fetch ALL bank accounts on file for this booking's customer — lets staff
// pick from a dropdown rather than typing from memory. Falls back to manual
// entry if none exist.
async function fetchCustomerBanks(bookingId?: number | null): Promise<any[]> {
  if (bookingId == null) return [];
  try {
    const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`);
    if (!r.ok) return [];
    const d = await r.json();
    // Endpoint may return a single object or an array
    if (Array.isArray(d)) return d;
    if (d && (d.BankName || d.AccountNo)) return [d];
    return [];
  } catch { return []; }
}

// ── New refund / re-booking dialog ─────────────────────────────────────────

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 text-muted-foreground">
        <Icon size={13} /> {title}
      </h3>
      {children}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick(): void; icon: any; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
        active ? "btn-module text-white border-primary shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-muted"
      }`}>
      <Icon size={14} />{children}
    </button>
  );
}

function NewRefundDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"refund" | "rebook">("refund");
  const [picked, setPicked] = useState<any | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankLHeadId, setBankLHeadId] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  // Customer bank: either a picked bank ID from dropdown, or manual entry
  const [selectedBankId, setSelectedBankId] = useState<string>(""); // "__manual__" = manual entry
  const [cbName, setCbName] = useState("");
  const [cbAcc, setCbAcc] = useState("");
  const [cbIfsc, setCbIfsc] = useState("");
  const [toBookingId, setToBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: sources = [] } = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: () => fetchEligibleSources() });
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

  // When customer banks load: if exactly one bank on file, auto-select it.
  // If multiple, leave blank so staff consciously picks one.
  useEffect(() => {
    if (!picked) return;
    if (customerBanks.length === 1) {
      const b = customerBanks[0];
      setSelectedBankId("__bank_0__");
      setCbName(b.BankName || "");
      setCbAcc(b.AccountNo || "");
      setCbIfsc(b.IfscCode || "");
    } else if (customerBanks.length === 0) {
      // No bank on file — open manual entry immediately
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
  const heldRebookTargets = (bookings as any[]).filter(
    (b) => picked && String(b.CustomerId ?? "") === String(picked.CustomerId ?? "") && !["Cancelled", "Rejected"].includes(b.Status),
  );

  const canRebook = picked?.SourceType === "CancellationHeldCredit";
  useEffect(() => { if (!canRebook && mode === "rebook") setMode("refund"); }, [canRebook, mode]);

  const isManual = selectedBankId === "__manual__";
  const hasBanks = customerBanks.length > 0;

  // When a bank is picked from the dropdown, pre-fill the fields
  const handleBankSelect = (val: string) => {
    setSelectedBankId(val);
    if (val === "__manual__") {
      setCbName(""); setCbAcc(""); setCbIfsc("");
      return;
    }
    const idx = parseInt(val.replace("__bank_", "").replace("__", ""));
    const b = customerBanks[idx];
    if (b) { setCbName(b.BankName || ""); setCbAcc(b.AccountNo || ""); setCbIfsc(b.IfscCode || ""); }
  };

  const submit = async () => {
    setSaving(true);
    try {
      if (mode === "rebook") {
        if (!picked || !toBookingId || amt <= 0) { toast.error("Pick a held credit, a target booking and an amount"); return; }
        const r = await fetchWithAuth(`${API}/rebooking-transfer`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ heldOnAccountId: picked.OnAccountId, toBookingId: Number(toBookingId), amount: amt }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        toast.success(d.crossCompany
          ? `Inter-company transfer ${d.fundTransferDocNo || ""} raised — credit lands once Finance approves it`
          : "Held credit applied to the booking");
      } else {
        if (!picked) { toast.error("Pick a source"); return; }
        const body: any = { GrossAmount: amt, Reason: reason || null, RefundBankLHeadId: bankLHeadId || null,
          CustomerBankName: cbName || null, CustomerAccountNo: cbAcc || null, CustomerIfscCode: cbIfsc || null,
          PreferredPaymentMode: paymentMode || null,
          SourceType: picked.SourceType, SourceOnAccountId: picked.OnAccountId };
        const r = await fetchWithAuth(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        toast.success(`${d.RefundNo} raised — net ${fmt(d.NetAmount)}${d.DeductionAmount ? `, deduction ${fmt(d.DeductionAmount)}` : ""}`);
      }
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading flex items-center gap-2">
            <Wallet size={16} className="text-primary" /> New Refund / Re-booking Credit
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Step 1 — where the money comes from */}
          <Section icon={Wallet} title="Source of funds">
            <div>
              <label className={LABEL}>Select held credit or overpayment</label>
              <Select
                value={picked ? String(picked.OnAccountId) : "__none__"}
                onValueChange={(v) => {
                  const s = v === "__none__" ? null : (sources as any[]).find((x) => String(x.OnAccountId) === v) || null;
                  setPicked(s);
                  setAmount(s ? String(Number(s.Remaining)) : "");
                  setBankLHeadId("");
                  // Fix: clear bank fields synchronously so stale data never shows
                  setSelectedBankId("");
                  setCbName(""); setCbAcc(""); setCbIfsc("");
                }}
              >
                <SelectTrigger className="h-9 w-full text-sm">
                  <SelectValue placeholder="Select a held credit or overpayment…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select a held credit or overpayment…</SelectItem>
                  {(sources as any[]).map((s) => (
                    <SelectItem key={`${s.SourceType}-${s.OnAccountId}`} value={String(s.OnAccountId)}>
                      {SOURCE_LABEL[s.SourceType]} · {s.CustomerName} · {s.BookingNo}{s.CancellationNo ? ` (${s.CancellationNo})` : ""} · {fmt(s.Remaining)} left
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!sources.length ? (
                <p className="text-[0.6875rem] text-muted-foreground mt-1.5">No held credits or unapplied overpayments right now — a refund can only be raised against one.</p>
              ) : picked && (
                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="flex items-center gap-1.5 font-medium text-foreground"><Building2 size={12} />{picked.CustomerName}</span>
                  <span className="font-mono">{picked.BookingNo}</span>
                  {picked.CancellationNo && <span className="font-mono">{picked.CancellationNo}</span>}
                  <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-semibold">{fmt(picked.Remaining)} available</span>
                </div>
              )}
            </div>
          </Section>

          {/* Step 2 — refund vs re-book (only when the source allows it) */}
          {canRebook && (
            <div className="flex gap-2">
              <TabButton icon={Banknote} active={mode === "refund"} onClick={() => setMode("refund")}>Refund to Customer</TabButton>
              <TabButton icon={ArrowRightLeft} active={mode === "rebook"} onClick={() => setMode("rebook")}>Apply to Re-booking</TabButton>
            </div>
          )}

          {/* Step 3 — amount */}
          <Section icon={ReceiptText} title="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                className={`${FIELD} pl-7 pr-20`} />
              {picked && (
                <button type="button" onClick={() => setAmount(String(remaining))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[0.6875rem] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted">
                  Use max
                </button>
              )}
            </div>
            {picked && <p className="text-[0.6875rem] text-muted-foreground mt-1">Up to {fmt(remaining)} available from this source.</p>}

            {mode === "refund" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide block">Gross</span>
                  <span className="text-sm font-semibold tabular-nums">{fmt(amt)}</span>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="text-[0.625rem] text-muted-foreground uppercase tracking-wide block">Deduction{pct ? ` (${pct}%)` : ""}</span>
                  <span className="text-sm font-semibold tabular-nums text-sky-600 dark:text-sky-400">{fmt(deduction)}</span>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
                  <span className="text-[0.625rem] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide block">Net to Customer</span>
                  <span className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(net)}</span>
                </div>
              </div>
            )}
          </Section>

          {/* Step 4 — destination: re-booking target, or payout details */}
          {mode === "rebook" ? (
            <Section icon={ArrowRightLeft} title="Apply to booking">
              <SearchableNativeSelect value={toBookingId} onChange={(e) => setToBookingId(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-background">
                <option value="">Select target booking (same customer)…</option>
                {heldRebookTargets.map((b) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ProjectName || b.UnitNo || ""} · {b.CompanyId === picked?.CompanyId ? "same company" : "cross-company"}</option>
                ))}
              </SearchableNativeSelect>
              <p className="text-[0.6875rem] text-muted-foreground">A cross-company target raises an Inter-Company Fund Transfer for Finance to approve; the credit lands afterwards.</p>
            </Section>
          ) : (
            <Section icon={Landmark} title="Payout details">
              {/* Company bank */}
              <div>
                <label className={LABEL}>Company bank (disburses from)</label>
                <Select value={bankLHeadId || "__none__"} onValueChange={(v) => setBankLHeadId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue placeholder="Finance will pick at approval" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Finance will pick at approval</SelectItem>
                    {(banks as any[]).map((b) => (
                      <SelectItem key={b.BId} value={String(b.BId)}>
                        {b.BName}{b.BBranch ? ` — ${b.BBranch}` : ""}{b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SelectedBankCard bank={findBank(banks as any[], bankLHeadId)} />
              </div>

              {/* Payment mode */}
              <div>
                <label className={LABEL}>Payment mode <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">(optional — Finance can set this later)</span></label>
                <Select value={paymentMode || "__none__"} onValueChange={(v) => setPaymentMode(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue placeholder="Not set yet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set yet</SelectItem>
                    {PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Customer payout account — dropdown if banks on file, manual entry otherwise */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={LABEL + " mb-0"}>Customer payout account</label>
                  {hasBanks && selectedBankId && selectedBankId !== "__manual__" && (
                    <button type="button" onClick={() => setSelectedBankId("__manual__")}
                      className="text-[0.625rem] flex items-center gap-1 text-primary hover:underline">
                      <PenLine size={10} /> Enter manually instead
                    </button>
                  )}
                  {isManual && hasBanks && (
                    <button type="button" onClick={() => setSelectedBankId("")}
                      className="text-[0.625rem] flex items-center gap-1 text-primary hover:underline">
                      ← Pick from saved banks
                    </button>
                  )}
                </div>

                {/* Bank picker dropdown — shown when customer has banks on file AND not in manual mode */}
                {hasBanks && !isManual && (
                  <Select value={selectedBankId || "__none__"} onValueChange={handleBankSelect}>
                    <SelectTrigger className="h-9 w-full text-sm">
                      <SelectValue placeholder="Select customer's bank account…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select customer's bank account…</SelectItem>
                      {(customerBanks as any[]).map((b, i) => (
                        <SelectItem key={i} value={`__bank_${i}__`}>
                          {b.BankName || "—"}{b.BranchName ? ` · ${b.BranchName}` : ""} · A/C {b.AccountNo ? `••${String(b.AccountNo).slice(-4)}` : "—"}
                          {b.IfscCode ? ` · ${b.IfscCode}` : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value="__manual__"><span className="flex items-center gap-1.5"><PenLine size={11} />Enter different account manually</span></SelectItem>
                    </SelectContent>
                  </Select>
                )}

                {/* Selected bank preview card */}
                {selectedBankId && selectedBankId !== "__manual__" && selectedBankId !== "__none__" && (cbName || cbAcc) && (
                  <div className="mt-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                    {cbName && <><span className="text-muted-foreground">Bank</span><span className="font-medium">{cbName}</span></>}
                    {cbAcc && <><span className="text-muted-foreground">A/C No.</span><span className="font-mono font-medium">{cbAcc}</span></>}
                    {cbIfsc && <><span className="text-muted-foreground">IFSC</span><span className="font-mono font-medium">{cbIfsc}</span></>}
                    <span className="col-span-2 text-emerald-600 dark:text-emerald-400 text-[0.625rem] mt-0.5">Pre-filled from KYC — switch to manual if account has changed</span>
                  </div>
                )}

                {/* Manual entry fields — shown when: no banks on file, or staff clicked "Enter manually" */}
                {(!hasBanks || isManual) && (
                  <div className="space-y-2">
                    <div>
                      <BankNamePicker
                        value={cbName}
                        onChange={(v) => setCbName(v)}
                        placeholder="Select customer's bank…"
                        otherPlaceholder="Bank name (if not listed)"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input value={cbAcc} onChange={(e) => setCbAcc(e.target.value)} placeholder="Account No" className={FIELD} />
                      <input value={cbIfsc} onChange={(e) => setCbIfsc(e.target.value.toUpperCase())} placeholder="IFSC" className={FIELD} />
                    </div>
                    {!hasBanks && picked?.BookingId != null && (
                      <p className="text-[0.6875rem] text-amber-600 dark:text-amber-400">
                        ⚠ No bank details on file for this customer — enter them here before raising the refund.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Reason */}
              <div>
                <label className={LABEL}>Reason</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this refund is being raised"
                  className={FIELD} />
              </div>
            </Section>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="h-9 px-4 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={submit} disabled={saving} className="h-9 px-5 text-sm btn-module text-white rounded-lg font-medium hover:shadow-lg disabled:opacity-40 flex items-center gap-1.5">
              {saving ? "Saving…" : mode === "rebook" ? <><ArrowRightLeft size={14} />Apply Credit</> : <><Banknote size={14} />Raise Refund</>}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CrmRefunds: React.FC = () => {
  const rights = usePageRights("crm-refunds");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [status, setStatus] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [financeDialog, setFinanceDialog] = useState<any | null>(null);
  const [financeBank, setFinanceBank] = useState("");
  const [financeMode, setFinanceMode] = useState("");

  const filters = useMemo<Filters>(() => ({ search, status, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }), [search, status, cpb]);
  const { data: result, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["crm-refunds", filters, page],
    queryFn: () => fetchList(filters, page),
    staleTime: 20_000,
  });
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;

  const { data: financeBanks = [] } = useQuery({
    queryKey: ["crm-refund-project-banks", financeDialog?.ProjectId],
    queryFn: () => fetchProjectBanks(financeDialog?.ProjectId),
    enabled: !!financeDialog?.ProjectId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["crm-refunds"] });

  const financeAction = async (id: number, action: "finance-approve" | "finance-reject", body?: object) => {
    try {
      const r = await fetchWithAuth(`${API}/${id}/${action}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      toast.success(action === "finance-approve" ? `Payout voucher ${d.docNo || ""} raised` : "Sent back to CRM");
      setFinanceDialog(null); setFinanceBank(""); setFinanceMode("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "RefundNo", header: "Refund No", size: 130, cell: (i) => <span className="font-mono text-xs font-semibold">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 160, cell: (i) => (
      <div><div className="text-sm font-medium">{i.row.original.CustomerName}</div>
        <div className="text-[0.6875rem] text-muted-foreground">{SOURCE_LABEL[i.row.original.SourceType]}{i.row.original.CancellationNo ? ` · ${i.row.original.CancellationNo}` : i.row.original.BookingNo ? ` · ${i.row.original.BookingNo}` : ""}</div></div>
    ) },
    { accessorKey: "GrossAmount", header: "Gross", size: 100, cell: (i) => <span className="text-xs font-mono">{fmt(i.getValue() as number)}</span> },
    { accessorKey: "DeductionAmount", header: "Deduction", size: 100, cell: (i) => {
      const d = Number(i.getValue()) || 0;
      return d > 0 ? <span className="text-xs font-mono text-sky-700">{fmt(d)} ({i.row.original.DeductionPercent}%)</span> : <span className="text-xs text-muted-foreground">—</span>;
    } },
    { accessorKey: "NetAmount", header: "Net", size: 100, cell: (i) => <span className="text-xs font-mono font-semibold text-green-700">{fmt(i.getValue() as number)}</span> },
    { accessorKey: "Status", header: "Status", size: 120, cell: (i) => {
      const s = i.getValue() as string;
      return (
        <div className="flex flex-col gap-1">
          <span className={`text-[0.6875rem] px-2 py-0.5 rounded-full border font-medium w-fit ${statusColor[s] || "text-muted-foreground bg-muted/50 border-border"}`}>{STATUS_LABEL[s] || s}</span>
          {i.row.original.IsOverdue ? <span className="flex items-center gap-1 text-[0.625rem] text-red-600"><AlertTriangle size={10} /> RERA overdue</span> : null}
        </div>
      );
    } },
    { id: "actions", header: "", size: 220, enableSorting: false, cell: (i) => {
      const r = i.row.original;
      return (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {["Draft", "Pending", "Rejected"].includes(r.Status) && (
            <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} onSuccess={invalidate} extraSubmitStatuses={["Draft"]} submitOnly />
          )}
          {r.Status === "FinancePending" && rights.canEdit && (
            <>
              <button onClick={() => { setFinanceDialog(r); setFinanceBank(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : ""); setFinanceMode(r.PreferredPaymentMode || ""); }}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200" title="Raises the payout voucher in Finance → Payments, where Finance approves it">Send to Finance</button>
              <button onClick={() => financeAction(r.Id, "finance-reject", { note: "Sent back" })}
                className="text-xs px-2 py-1 text-red-600 hover:underline">Send back</button>
            </>
          )}
          {r.FinanceNewPaymentId != null && (
            <button onClick={() => navigate(`/payments?view=${r.FinanceNewPaymentId}`)}
              className="text-xs text-primary hover:underline flex items-center gap-1">{r.Status === "Paid" ? "Payment" : "Open in Payments"} <ExternalLink size={11} /></button>
          )}
          {r.Status === "Paid" && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> Paid</span>}
        </div>
      );
    } },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Refunds"]} />
      <CrmShell
        title="CRM — Refunds"
        subtitle="Refund held credit from cancelled bookings or overpayments — or apply held credit to a re-booking"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            {rights.canCreate && (
              <button onClick={() => setShowNew(true)}
                className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-4 py-1.5 rounded-lg btn-module hover:shadow-lg transition-all">
                <Plus size={14} /> New Refund
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-2 mb-3">
          {/* Row 1: search + status tabs */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
                placeholder="Search customer, refund no, booking, cancellation… (Enter)"
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-sky-500/40" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_TABS.map((s) => (
                <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${status === s ? "btn-module text-white border-transparent" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}>
                  {STATUS_LABEL[s] || s}
                </button>
              ))}
            </div>
          </div>
          {/* Row 2: company / project / block */}
          <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
        </div>

        <DataTable data={rows} columns={columns} searchable={false} loading={isLoading}
          emptyMessage="No refunds yet. Cancelling a booking auto-creates a draft refund; you can also raise one for an overpayment or manually."
          className="rounded-xl border border-border overflow-hidden bg-card" />
        <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

        {showNew && <NewRefundDialog onClose={() => setShowNew(false)} onDone={invalidate} />}

        {/* Finance approve dialog */}
        <Dialog open={!!financeDialog} onOpenChange={(o) => { if (!o) { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-heading">Send refund {financeDialog?.RefundNo} to Finance</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground block">Customer</span>{financeDialog?.CustomerName}</div>
                <div><span className="text-muted-foreground block">Net payout</span><span className="font-bold text-green-700">{fmt(financeDialog?.NetAmount)}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground block">To</span>{financeDialog?.CustomerBankName || "—"} {financeDialog?.CustomerAccountNo || ""} {financeDialog?.CustomerIfscCode || ""}</div>
              </div>
              <div>
                <label className={LABEL}>Company bank to disburse from *</label>
                <Select value={financeBank || "__none__"} onValueChange={(v) => setFinanceBank(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select…</SelectItem>
                    {(financeBanks as any[]).map((b) => (
                      <SelectItem key={b.BId} value={String(b.BId)}>
                        {b.BName}{b.BBranch ? ` — ${b.BBranch}` : ""}{b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <SelectedBankCard bank={findBank(financeBanks as any[], financeBank)} />
              </div>
              <div>
                <label className={LABEL}>Payment mode <span className="text-muted-foreground/60 normal-case font-normal tracking-normal">(optional — can be set later)</span></label>
                <Select value={financeMode || "__none__"} onValueChange={(v) => setFinanceMode(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 w-full text-sm">
                    <SelectValue placeholder="Not set yet" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set yet</SelectItem>
                    {PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground">Approving raises a Finance payment voucher. The refund is marked Paid when that voucher is approved.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); }}
                  className="h-9 px-4 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={() => financeAction(financeDialog.Id, "finance-approve", { RefundBankLHeadId: financeBank || undefined, PaymentMode: financeMode || undefined })}
                  disabled={!financeBank}
                  className="h-9 px-4 text-sm btn-module text-white rounded-lg font-medium disabled:opacity-40">Raise Payout</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmRefunds;
