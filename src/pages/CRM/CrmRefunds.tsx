import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Plus, CheckCircle2, AlertTriangle, ExternalLink, ArrowRightLeft, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApprovalActions } from "@/components/ApprovalActions";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";

const API = "/api/crm/refunds";
const BKG_API = "/api/crm/bookings";
const PROJECT_BANK_API = "/api/crm/project-banks";
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
  if (!projectId) return [];
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

// ── New refund / re-booking dialog ─────────────────────────────────────────
function NewRefundDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"refund" | "rebook">("refund");
  const [sourceKind, setSourceKind] = useState<"picked" | "manual">("picked");
  const [picked, setPicked] = useState<any | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankLHeadId, setBankLHeadId] = useState("");
  const [cbName, setCbName] = useState("");
  const [cbAcc, setCbAcc] = useState("");
  const [cbIfsc, setCbIfsc] = useState("");
  const [manualCustomerId, setManualCustomerId] = useState("");
  const [toBookingId, setToBookingId] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: sources = [] } = useQuery({ queryKey: ["crm-refund-eligible-sources"], queryFn: () => fetchEligibleSources() });
  const { data: banks = [] } = useQuery({
    queryKey: ["crm-refund-project-banks", picked?.ProjectId],
    queryFn: () => fetchProjectBanks(picked?.ProjectId),
    enabled: !!picked?.ProjectId,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, enabled: mode === "rebook", staleTime: 5 * 60_000 });

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
        const body: any = { GrossAmount: amt, Reason: reason || null, RefundBankLHeadId: bankLHeadId || null,
          CustomerBankName: cbName || null, CustomerAccountNo: cbAcc || null, CustomerIfscCode: cbIfsc || null };
        if (sourceKind === "manual") { body.SourceType = "Manual"; body.CustomerId = Number(manualCustomerId) || null; }
        else {
          if (!picked) { toast.error("Pick a source"); return; }
          body.SourceType = picked.SourceType;
          body.SourceOnAccountId = picked.OnAccountId;
        }
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-heading">New Refund / Re-booking Credit</DialogTitle></DialogHeader>

        <div className="flex gap-2 text-xs">
          <button onClick={() => setSourceKind("picked")} className={`px-2.5 py-1 rounded-lg border ${sourceKind === "picked" ? "bg-primary text-primary-foreground" : "border-border"}`}>From held / on-account</button>
          <button onClick={() => { setSourceKind("manual"); setPicked(null); setMode("refund"); }} className={`px-2.5 py-1 rounded-lg border ${sourceKind === "manual" ? "bg-primary text-primary-foreground" : "border-border"}`}>Manual refund</button>
        </div>

        {sourceKind === "picked" ? (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Source</label>
            <select value={picked ? String(picked.OnAccountId) : ""} onChange={(e) => {
              const s = (sources as any[]).find((x) => String(x.OnAccountId) === e.target.value) || null;
              setPicked(s); setAmount(s ? String(Number(s.Remaining)) : ""); setBankLHeadId("");
            }} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
              <option value="">Select held credit or overpayment…</option>
              {(sources as any[]).map((s) => (
                <option key={`${s.SourceType}-${s.OnAccountId}`} value={String(s.OnAccountId)}>
                  {SOURCE_LABEL[s.SourceType]} · {s.CustomerName} · {s.BookingNo}{s.CancellationNo ? ` (${s.CancellationNo})` : ""} · {fmt(s.Remaining)} left
                </option>
              ))}
            </select>
            {!sources.length && <p className="text-[11px] text-muted-foreground mt-1">No held credits or unapplied overpayments right now.</p>}
          </div>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Customer Id *</label>
            <input value={manualCustomerId} onChange={(e) => setManualCustomerId(e.target.value)} placeholder="CrmCustomer.Id"
              className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
          </div>
        )}

        {canRebook && (
          <div className="flex gap-2 text-xs">
            <button onClick={() => setMode("refund")} className={`px-2.5 py-1 rounded-lg border ${mode === "refund" ? "bg-primary text-primary-foreground" : "border-border"}`}>Refund to customer</button>
            <button onClick={() => setMode("rebook")} className={`px-2.5 py-1 rounded-lg border ${mode === "rebook" ? "bg-primary text-primary-foreground" : "border-border"}`}><ArrowRightLeft size={11} className="inline mr-1" />Apply to a re-booking</button>
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground block mb-1">Amount *{picked ? ` (max ${fmt(remaining)})` : ""}</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
        </div>

        {mode === "rebook" ? (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Target booking (same customer) *</label>
            <select value={toBookingId} onChange={(e) => setToBookingId(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
              <option value="">Select booking…</option>
              {heldRebookTargets.map((b) => (
                <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ProjectName || b.UnitNo || ""} · {b.CompanyId === picked?.CompanyId ? "same company" : "cross-company"}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">A cross-company target raises an Inter-Company Fund Transfer for Finance to approve; the credit lands afterwards.</p>
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-muted/20 p-2.5 text-xs grid grid-cols-3 gap-2">
              <div><span className="text-muted-foreground block">Gross</span><span className="font-semibold">{fmt(amt)}</span></div>
              <div><span className="text-muted-foreground block">Deduction {pct ? `(${pct}%)` : ""}</span><span className="font-semibold text-amber-700">{fmt(deduction)}</span></div>
              <div><span className="text-muted-foreground block">Net to customer</span><span className="font-bold text-green-700">{fmt(net)}</span></div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Company bank (disburses from)</label>
              <select value={bankLHeadId} onChange={(e) => setBankLHeadId(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background">
                <option value="">Finance will pick at approval</option>
                {(banks as any[]).map((b) => <option key={b.BankLHeadId ?? b.LHeadId} value={String(b.BankLHeadId ?? b.LHeadId)}>{b.LHeadName ?? b.BankName}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[11px] text-muted-foreground block mb-1">Customer bank</label><input value={cbName} onChange={(e) => setCbName(e.target.value)} placeholder="from KYC" className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background" /></div>
              <div><label className="text-[11px] text-muted-foreground block mb-1">Account No</label><input value={cbAcc} onChange={(e) => setCbAcc(e.target.value)} className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background" /></div>
              <div><label className="text-[11px] text-muted-foreground block mb-1">IFSC</label><input value={cbIfsc} onChange={(e) => setCbIfsc(e.target.value)} className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background" /></div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-background" />
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
            {saving ? "Saving…" : mode === "rebook" ? "Apply Credit" : "Raise Refund"}
          </button>
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
            <ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} onSuccess={invalidate} />
          )}
          {r.Status === "FinancePending" && rights.canEdit && (
            <>
              <button onClick={() => { setFinanceDialog(r); setFinanceBank(r.RefundBankLHeadId ? String(r.RefundBankLHeadId) : ""); }}
                className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200">Finance Approve</button>
              <button onClick={() => financeAction(r.Id, "finance-reject", { note: "Sent back" })}
                className="text-xs px-2 py-1 text-red-600 hover:underline">Send back</button>
            </>
          )}
          {r.FinanceNewPaymentId && (
            <button onClick={() => navigate(`/finance/payments?view=${r.FinanceNewPaymentId}`)}
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
        subtitle="Refund held credit from cancelled bookings, overpayments, or ad-hoc — or apply held credit to a re-booking"
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

        <Dialog open={!!financeDialog} onOpenChange={(o) => { if (!o) { setFinanceDialog(null); setFinanceBank(""); } }}>
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
                  {(financeBanks as any[]).map((b) => <option key={b.BankLHeadId ?? b.LHeadId} value={String(b.BankLHeadId ?? b.LHeadId)}>{b.LHeadName ?? b.BankName}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-muted-foreground">Approving raises a Finance payment voucher. The refund is marked Paid when that voucher is approved.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setFinanceDialog(null); setFinanceBank(""); }} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
                <button onClick={() => financeAction(financeDialog.Id, "finance-approve", { RefundBankLHeadId: financeBank || undefined })}
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
