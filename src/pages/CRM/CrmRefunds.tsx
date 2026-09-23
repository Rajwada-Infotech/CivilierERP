import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Plus, CheckCircle2, AlertTriangle, ExternalLink, ArrowRightLeft, X, Wallet, Landmark, ReceiptText, Banknote, Building2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { SelectedBankCard, findBank } from "@/components/crm/SelectedBankCard";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";

const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
const PAGE_SIZE = 20;

const STATUS_TABS = ["All", "Draft", "Pending", "FinancePending", "FinanceApproved", "Paid", "Rejected"] as const;
const statusColor: Record<string, string> = {
  Draft: "text-slate-600 bg-slate-50 border-slate-200",
  Pending: "text-orange-600 bg-orange-50 border-orange-200",
  FinancePending: "text-purple-600 bg-purple-50 border-purple-200",
  FinanceApproved: "text-blue-600 bg-blue-50 border-blue-200",
  Paid: "text-green-600 bg-green-50 border-green-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
};
const SOURCE_LABEL: Record<string, string> = {
  CancellationHeldCredit: "Cancelled booking",
  OverpaymentOnAccount: "Overpayment",
  Manual: "Manual",
};
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
async function fetchCustomerBankDetail(bookingId?: number | null): Promise<any | null> {
  if (bookingId == null) return null;
  try { const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
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
        active ? "bg-primary text-primary-foreground border-primary shadow-sm" : "border-border bg-background text-muted-foreground hover:bg-muted"
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
  const { data: customerBank } = useQuery({
    queryKey: ["crm-refund-customer-bank", picked?.BookingId],
    queryFn: () => fetchCustomerBankDetail(picked?.BookingId),
    enabled: picked?.BookingId != null,
  });
  // Pre-fill the payout bank details from the customer's on-file KYC the
  // moment a source is picked — staff shouldn't have to retype what's
  // already on record. Fields stay fully editable so a bank account that's
  // changed since KYC was captured can be corrected right here, at the
  // moment of refund, without going back to update KYC first.
  useEffect(() => {
    if (!customerBank) return;
    setCbName(customerBank.BankName || "");
    setCbAcc(customerBank.AccountNo || "");
    setCbIfsc(customerBank.IfscCode || "");
  }, [customerBank]);

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
              <select value={picked ? String(picked.OnAccountId) : ""} onChange={(e) => {
                const s = (sources as any[]).find((x) => String(x.OnAccountId) === e.target.value) || null;
                setPicked(s); setAmount(s ? String(Number(s.Remaining)) : ""); setBankLHeadId("");
                setCbName(""); setCbAcc(""); setCbIfsc("");
              }} className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-background">
                <option value="">Select a held credit or overpayment…</option>
                {(sources as any[]).map((s) => (
                  <option key={`${s.SourceType}-${s.OnAccountId}`} value={String(s.OnAccountId)}>
                    {SOURCE_LABEL[s.SourceType]} · {s.CustomerName} · {s.BookingNo}{s.CancellationNo ? ` (${s.CancellationNo})` : ""} · {fmt(s.Remaining)} left
                  </option>
                ))}
              </select>
              {!sources.length ? (
                <p className="text-[11px] text-muted-foreground mt-1.5">No held credits or unapplied overpayments right now — a refund can only be raised against one.</p>
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
                className="w-full text-sm border border-border rounded-lg pl-7 pr-24 py-2.5 bg-background" />
              {picked && (
                <button type="button" onClick={() => setAmount(String(remaining))}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-medium px-2 py-1 rounded-md border border-border text-muted-foreground hover:bg-muted">
                  Use max
                </button>
              )}
            </div>
            {picked && <p className="text-[11px] text-muted-foreground mt-1">Up to {fmt(remaining)} available from this source.</p>}

            {mode === "refund" && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide block">Gross</span>
                  <span className="text-sm font-semibold tabular-nums">{fmt(amt)}</span>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide block">Deduction{pct ? ` (${pct}%)` : ""}</span>
                  <span className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">{fmt(deduction)}</span>
                </div>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2">
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 uppercase tracking-wide block">Net to Customer</span>
                  <span className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(net)}</span>
                </div>
              </div>
            )}
          </Section>

          {/* Step 4 — destination: re-booking target, or payout details */}
          {mode === "rebook" ? (
            <Section icon={ArrowRightLeft} title="Apply to booking">
              <select value={toBookingId} onChange={(e) => setToBookingId(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2.5 bg-background">
                <option value="">Select target booking (same customer)…</option>
                {heldRebookTargets.map((b) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ProjectName || b.UnitNo || ""} · {b.CompanyId === picked?.CompanyId ? "same company" : "cross-company"}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">A cross-company target raises an Inter-Company Fund Transfer for Finance to approve; the credit lands afterwards.</p>
            </Section>
          ) : (
            <Section icon={Landmark} title="Payout details">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Company bank (disburses from)</label>
                <select value={bankLHeadId} onChange={(e) => setBankLHeadId(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">Finance will pick at approval</option>
                  {(banks as any[]).map((b) => (
                    <option key={b.BId} value={String(b.BId)}>
                      {b.BName}{b.BBranch ? ` — ${b.BBranch}` : ""}{b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}
                    </option>
                  ))}
                </select>
                <SelectedBankCard bank={findBank(banks as any[], bankLHeadId)} />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-muted-foreground">Customer payout account</label>
                  {customerBank && (cbName || cbAcc || cbIfsc) && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Pre-filled from KYC — edit if it's changed</span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input value={cbName} onChange={(e) => setCbName(e.target.value)} placeholder="Bank name" className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                  <input value={cbAcc} onChange={(e) => setCbAcc(e.target.value)} placeholder="Account No" className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                  <input value={cbIfsc} onChange={(e) => setCbIfsc(e.target.value)} placeholder="IFSC" className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
                </div>
                {picked?.BookingId != null && !customerBank?.BankName && !customerBank?.AccountNo && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">No bank details on file for this customer — enter them manually before raising the refund.</p>
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Reason</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this refund is being raised"
                  className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
              </div>
            </Section>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-3.5 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1.5">
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
      setFinanceDialog(null); setFinanceBank("");
      invalidate();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "RefundNo", header: "Refund No", size: 130, cell: (i) => <span className="font-mono text-xs font-semibold">{i.getValue() as string}</span> },
    { accessorKey: "CustomerName", header: "Customer", size: 160, cell: (i) => (
      <div><div className="text-sm font-medium">{i.row.original.CustomerName}</div>
        <div className="text-[11px] text-muted-foreground">{SOURCE_LABEL[i.row.original.SourceType]}{i.row.original.CancellationNo ? ` · ${i.row.original.CancellationNo}` : i.row.original.BookingNo ? ` · ${i.row.original.BookingNo}` : ""}</div></div>
    ) },
    { accessorKey: "GrossAmount", header: "Gross", size: 100, cell: (i) => <span className="text-xs font-mono">{fmt(i.getValue() as number)}</span> },
    { accessorKey: "DeductionAmount", header: "Deduction", size: 100, cell: (i) => {
      const d = Number(i.getValue()) || 0;
      return d > 0 ? <span className="text-xs font-mono text-amber-700">{fmt(d)} ({i.row.original.DeductionPercent}%)</span> : <span className="text-xs text-muted-foreground">—</span>;
    } },
    { accessorKey: "NetAmount", header: "Net", size: 100, cell: (i) => <span className="text-xs font-mono font-semibold text-green-700">{fmt(i.getValue() as number)}</span> },
    { accessorKey: "Status", header: "Status", size: 120, cell: (i) => {
      const s = i.getValue() as string;
      return (
        <div className="flex flex-col gap-1">
          <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium w-fit ${statusColor[s] || "text-muted-foreground bg-muted/50 border-border"}`}>{s}</span>
          {i.row.original.IsOverdue ? <span className="flex items-center gap-1 text-[10px] text-red-600"><AlertTriangle size={10} /> RERA overdue</span> : null}
        </div>
      );
    } },
    { id: "actions", header: "", size: 220, enableSorting: false, cell: (i) => {
      const r = i.row.original;
      return (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {["Draft", "Pending", "Rejected"].includes(r.Status) && (
            <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} onSuccess={invalidate} extraSubmitStatuses={["Draft"]} />
          )}
          {r.Status === "FinancePending" && rights.canEdit && (
            <>
              <button onClick={() => { setFinanceDialog(r); setFinanceBank(r.RefundBankLHeadId != null ? String(r.RefundBankLHeadId) : ""); }}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200">Finance Approve</button>
              <button onClick={() => financeAction(r.Id, "finance-reject", { note: "Sent back" })}
                className="text-xs px-2 py-1 text-red-600 hover:underline">Send back</button>
            </>
          )}
          {r.FinanceNewPaymentId != null && (
            <button onClick={() => navigate(`/payments?view=${r.FinanceNewPaymentId}`)}
              className="text-xs text-primary hover:underline flex items-center gap-1">Payment <ExternalLink size={11} /></button>
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
                className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg transition-all">
                <Plus size={14} /> New Refund
              </button>
            )}
          </div>
        }
      >
        <div className="flex gap-3 flex-wrap items-center mb-3">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }}
              placeholder="Search customer, refund no, booking, cancellation… (Enter)"
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
          <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((s) => (
              <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${status === s ? "bg-primary text-primary-foreground border-transparent" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <DataTable data={rows} columns={columns} searchable={false} loading={isLoading}
          emptyMessage="No refunds yet. Cancelling a booking auto-creates a draft refund; you can also raise one for an overpayment or manually."
          className="rounded-xl border border-border overflow-hidden bg-card" />
        <CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />

        {showNew && <NewRefundDialog onClose={() => setShowNew(false)} onDone={invalidate} />}

        <Dialog open={!!financeDialog} onOpenChange={(o) => { if (!o) { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-heading">Finance-approve refund {financeDialog?.RefundNo}</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border bg-muted/20 p-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground block">Customer</span>{financeDialog?.CustomerName}</div>
                <div><span className="text-muted-foreground block">Net payout</span><span className="font-bold text-green-700">{fmt(financeDialog?.NetAmount)}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground block">To</span>{financeDialog?.CustomerBankName || "—"} {financeDialog?.CustomerAccountNo || ""} {financeDialog?.CustomerIfscCode || ""}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Company bank to disburse from *</label>
                <select value={financeBank} onChange={(e) => setFinanceBank(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">Select…</option>
                  {(financeBanks as any[]).map((b) => (
                    <option key={b.BId} value={String(b.BId)}>
                      {b.BName}{b.BBranch ? ` — ${b.BBranch}` : ""}{b.BAccountLast4 ? ` (••${b.BAccountLast4})` : ""}
                    </option>
                  ))}
                </select>
                <SelectedBankCard bank={findBank(financeBanks as any[], financeBank)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Payment mode (optional — can be set later)</label>
                <select value={financeMode} onChange={(e) => setFinanceMode(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                  <option value="">Not set yet</option>
                  <option value="NEFT">NEFT</option>
                  <option value="RTGS">RTGS</option>
                  <option value="IMPS">IMPS</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>
              <p className="text-[11px] text-muted-foreground">Approving raises a Finance payment voucher. The refund is marked Paid when that voucher is approved.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setFinanceDialog(null); setFinanceBank(""); setFinanceMode(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={() => financeAction(financeDialog.Id, "finance-approve", { RefundBankLHeadId: financeBank || undefined, PaymentMode: financeMode || undefined })}
                  disabled={!financeBank}
                  className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">Raise Payout</button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmRefunds;
