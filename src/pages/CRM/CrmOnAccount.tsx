import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  TrendingUp, Wallet, Search, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as CRight,
  ArrowRightLeft, CheckCircle2, Clock, SplitSquareHorizontal,
  Building2, User, CreditCard, CalendarDays, ExternalLink, ReceiptText,
  Filter, X, BadgeIndianRupee,
} from "lucide-react";

const API = "/api/crm/payments";

// ── Types ─────────────────────────────────────────────────────────────────────

type DepositStatus = "Unapplied" | "PartiallyApplied" | "Applied";

interface Deposit {
  Id: number;
  ReceiptNo: string | null;
  BookingId: number;
  Amount: number;
  AppliedAmount: number;
  AvailableBalance: number;
  Status: DepositStatus;
  ReceivedDate: string;
  PaymentMode: string | null;
  TransactionRef: string | null;
  Notes: string | null;
  CreatedAt: string;
  DepositBankId: number | null;
  DepositBankName: string | null;
  SourceReceivedPaymentId: number | null;
  BookingNo: string;
  ProjectId: number | null;
  ProjectName: string | null;
  UnitNo: string | null;
  GrandTotal: number | null;
  ApplicantName: string;
  Mobile: string | null;
  CreatedByName: string | null;
}

interface Summary {
  TotalCount: number;
  TotalReceived: number;
  TotalAvailable: number;
  TotalApplied: number;
  UnappliedCount: number;
  PartialCount: number;
  AppliedCount: number;
  UnappliedBalance: number;
  PartialBalance: number;
}

interface Milestone {
  Id: number;
  MilestoneNo: number;
  MilestoneName: string;
  AmountDue: number;
  AmountPaid: number;
  Status: string;
  DueDate: string | null;
}

interface BookingDetail {
  booking: { BookingNo: string; ApplicantName: string; ProjectName: string; UnitNo: string; GrandTotal: number };
  milestones: Milestone[];
  summary: { totalDue: number; totalPaid: number; balance: number; overdue: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fd = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const modeColor: Record<string, string> = {
  Cash:   "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  Cheque: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  NEFT:   "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  RTGS:   "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  UPI:    "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  IMPS:   "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
};

function StatusChip({ s }: { s: DepositStatus }) {
  if (s === "Applied")
    return <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-700 dark:text-emerald-300 whitespace-nowrap"><CheckCircle2 size={9} />Applied</span>;
  if (s === "PartiallyApplied")
    return <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-700 dark:text-blue-300 whitespace-nowrap"><SplitSquareHorizontal size={9} />Partial</span>;
  return <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300 whitespace-nowrap"><Clock size={9} />Unapplied</span>;
}

// ── Adjust Dialog ─────────────────────────────────────────────────────────────

function AdjustDialog({ deposit, onClose, onDone }: { deposit: Deposit; onClose(): void; onDone(): void }) {
  const [selId, setSelId] = useState<number | null>(null);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: bk, isLoading } = useQuery<BookingDetail>({
    queryKey: ["bk-milestones", deposit.BookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/booking/${deposit.BookingId}`);
      if (!r.ok) throw new Error("Failed to load milestones");
      return r.json();
    },
    staleTime: 30_000,
  });

  const outstanding = useMemo(() =>
    (bk?.milestones || []).filter(
      (m) => m.Status !== "Paid" && m.Status !== "Waived" &&
             Number(m.AmountDue) - Number(m.AmountPaid) > 0
    ), [bk]);

  const sel = outstanding.find((m) => m.Id === selId);
  const maxAmt = sel
    ? Math.min(Number(deposit.AvailableBalance), Number(sel.AmountDue) - Number(sel.AmountPaid))
    : Number(deposit.AvailableBalance);

  async function apply() {
    if (!selId) { toast.error("Select a milestone first"); return; }
    const n = amt ? parseFloat(amt) : undefined;
    if (n !== undefined && (isNaN(n) || n <= 0)) { toast.error("Enter a valid amount"); return; }
    if (n && n > deposit.AvailableBalance) { toast.error(`Max: ${formatINR(deposit.AvailableBalance)}`); return; }
    setBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/on-account/${deposit.Id}/apply`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ MilestoneId: selId, ...(n ? { Amount: n } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "Apply failed"); return; }
      toast.success(`${formatINR(data.applied)} applied · Remaining: ${formatINR(data.remaining)}`);
      onDone();
    } catch { toast.error("Network error"); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft size={16} className="text-primary" />
            On Account Adjustment — {deposit.ReceiptNo || `Deposit #${deposit.Id}`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">

          {/* Deposit strip */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Deposited", val: formatINR(deposit.Amount), cls: "border-border bg-muted/20 text-foreground" },
              { label: "Applied",   val: formatINR(deposit.AppliedAmount), cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400" },
              { label: "Available", val: formatINR(deposit.AvailableBalance), cls: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-400" },
            ].map(({ label, val, cls }) => (
              <div key={label} className={`rounded-lg border px-3 py-2 text-center ${cls}`}>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{label}</div>
                <div className="font-bold text-sm">{val}</div>
              </div>
            ))}
          </div>

          {/* Booking context */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/10">
            <Building2 size={12} />
            <span className="font-medium text-foreground">{deposit.ApplicantName}</span>
            <span>·</span>
            <span className="font-mono">{deposit.BookingNo}</span>
            {deposit.ProjectName && <><span>·</span><span>{deposit.ProjectName}</span></>}
            {deposit.UnitNo && <><span>·</span><span>{deposit.UnitNo}</span></>}
          </div>

          {/* Milestone list */}
          <div>
            <div className="text-sm font-medium mb-2">Select Milestone to Apply Against</div>
            {isLoading ? (
              <div className="flex items-center gap-2 py-5 text-muted-foreground text-sm justify-center">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : outstanding.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/10 px-4 py-5 text-center text-sm text-muted-foreground">
                No outstanding milestones on this booking.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {outstanding.map((m) => {
                  const due = Number(m.AmountDue) - Number(m.AmountPaid);
                  const pct = Number(m.AmountDue) > 0 ? (Number(m.AmountPaid) / Number(m.AmountDue)) * 100 : 0;
                  const overdue = m.DueDate && new Date(m.DueDate) < new Date() && m.Status !== "Paid";
                  const sel = selId === m.Id;
                  return (
                    <button key={m.Id}
                      onClick={() => { setSelId(m.Id); setAmt(String(Math.min(deposit.AvailableBalance, due))); }}
                      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-all ${sel ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/40 hover:bg-muted/20"}`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">#{m.MilestoneNo}</span>
                          <span className="text-sm font-medium">{m.MilestoneName}</span>
                          {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-700">Overdue</span>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-amber-600">{formatINR(due)} due</div>
                          <div className="text-[10px] text-muted-foreground">of {formatINR(m.AmountDue)}</div>
                        </div>
                      </div>
                      <div className="h-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      {m.DueDate && <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><CalendarDays size={9} />Due {fd(m.DueDate)}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Amount input */}
          {selId !== null && (
            <div>
              <label className="text-sm font-medium block mb-1.5">
                Amount to Apply <span className="text-muted-foreground font-normal text-xs">(blank = apply full {formatINR(maxAmt)})</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">₹</span>
                <input type="number" value={amt} onChange={(e) => setAmt(e.target.value)}
                  min={0} max={maxAmt} step={0.01}
                  className="w-full pl-7 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted">Cancel</button>
            <button onClick={apply} disabled={!selId || busy}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2">
              {busy ? <><Loader2 size={13} className="animate-spin" />Applying…</> : <><ArrowRightLeft size={13} />Apply to Milestone</>}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Milestone sub-table (expanded row) ────────────────────────────────────────

function MilestoneSubTable({ bookingId, deposit }: { bookingId: number; deposit: Deposit }) {
  const { data: bk, isLoading } = useQuery<BookingDetail>({
    queryKey: ["bk-milestones", bookingId],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 60_000,
  });

  if (isLoading)
    return <div className="flex items-center gap-2 py-3 px-4 text-xs text-muted-foreground"><Loader2 size={11} className="animate-spin" />Loading schedule…</div>;

  const ms = bk?.milestones || [];
  const s = bk?.summary;

  return (
    <div className="px-4 py-3 space-y-3">
      {/* Deposit meta row */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {deposit.PaymentMode && <span className="flex items-center gap-1"><CreditCard size={10} />{deposit.PaymentMode}</span>}
        {deposit.TransactionRef && <span className="flex items-center gap-1"><ReceiptText size={10} />Ref: <span className="font-mono text-foreground">{deposit.TransactionRef}</span></span>}
        {deposit.DepositBankName && <span className="flex items-center gap-1"><Building2 size={10} />{deposit.DepositBankName}</span>}
        {deposit.CreatedByName && <span className="flex items-center gap-1"><User size={10} />By {deposit.CreatedByName}</span>}
        {deposit.Notes && <span className="italic">"{deposit.Notes}"</span>}
      </div>

      {/* Payment schedule mini-table */}
      {ms.length > 0 && (
        <>
          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">
            Payment Schedule — {deposit.BookingNo}
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  {["#","Milestone","Due Date","Amount Due","Paid","Balance","Status"].map((h, i) => (
                    <th key={h} className={`px-2.5 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground ${i >= 3 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ms.map((m) => {
                  const bal = Number(m.AmountDue) - Number(m.AmountPaid);
                  const overdue = m.DueDate && new Date(m.DueDate) < new Date() && m.Status !== "Paid" && m.Status !== "Waived";
                  return (
                    <tr key={m.Id} className="hover:bg-muted/10">
                      <td className="px-2.5 py-1.5 text-muted-foreground font-mono">{m.MilestoneNo}</td>
                      <td className="px-2.5 py-1.5 font-medium">{m.MilestoneName}</td>
                      <td className={`px-2.5 py-1.5 ${overdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>{fd(m.DueDate)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono">{formatINR(m.AmountDue)}</td>
                      <td className="px-2.5 py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{formatINR(m.AmountPaid)}</td>
                      <td className={`px-2.5 py-1.5 text-right font-mono font-semibold ${bal > 0 ? "text-amber-600" : "text-muted-foreground"}`}>{bal > 0 ? formatINR(bal) : "—"}</td>
                      <td className="px-2.5 py-1.5">
                        {m.Status === "Paid" ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Paid</span>
                          : m.Status === "Waived" ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Waived</span>
                          : overdue ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">Overdue</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">Pending</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {s && (
                <tfoot className="border-t border-border bg-muted/20">
                  <tr>
                    <td colSpan={3} className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Total</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-bold">{formatINR(s.totalDue)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-bold text-emerald-600">{formatINR(s.totalPaid)}</td>
                    <td className="px-2.5 py-1.5 text-right font-mono font-bold text-amber-600">{s.balance > 0 ? formatINR(s.balance) : "—"}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── KPI Tile ──────────────────────────────────────────────────────────────────

function KpiTile({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: string }) {
  return (
    <div className={`rounded-lg border ${accent} bg-card px-3 py-3`}>
      <div className="flex items-center gap-2 mb-1.5">{icon}<span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{label}</span></div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CrmOnAccount() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canEdit } = usePageRights("crm-payments");

  // live filter inputs
  const [search, setSearch]     = useState("");
  const [status, setStatus]     = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [mode, setMode]         = useState("");
  const [page, setPage]         = useState(1);
  const PAGE = 50;

  // committed filters (applied on Search click / Enter)
  const [applied, setApplied] = useState({ search: "", status: "", dateFrom: "", dateTo: "" });
  const hasFilters = applied.search || applied.status || applied.dateFrom || applied.dateTo || mode;

  function runSearch() { setApplied({ search, status, dateFrom, dateTo }); setPage(1); }
  function clearAll()  {
    setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setMode("");
    setApplied({ search: "", status: "", dateFrom: "", dateTo: "" }); setPage(1);
  }

  // expanded rows
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  function toggle(id: number) {
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const [adjusting, setAdjusting] = useState<Deposit | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const params = new URLSearchParams({
    page: String(page), pageSize: String(PAGE),
    ...(applied.search   ? { search: applied.search }     : {}),
    ...(applied.status   ? { status: applied.status }     : {}),
    ...(applied.dateFrom ? { dateFrom: applied.dateFrom } : {}),
    ...(applied.dateTo   ? { dateTo: applied.dateTo }     : {}),
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["crm-on-account", applied, page],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/on-account?${params}`);
      if (!r.ok) throw new Error("Failed to load deposits");
      return r.json() as Promise<{ deposits: Deposit[]; total: number }>;
    },
    staleTime: 30_000,
  });

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ["crm-on-account-summary"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/on-account/summary`);
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<Summary>;
    },
    staleTime: 60_000,
  });

  // client-side mode filter (backend doesn't support it)
  const deposits = useMemo(
    () => mode ? (data?.deposits || []).filter((d) => d.PaymentMode === mode) : (data?.deposits || []),
    [data, mode]
  );
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / PAGE);

  // page-level totals for footer
  const pageCR  = deposits.reduce((s, d) => s + Number(d.Amount), 0);
  const pageDR  = deposits.reduce((s, d) => s + Number(d.AppliedAmount), 0);
  const pageBAL = deposits.reduce((s, d) => s + Number(d.AvailableBalance), 0);

  const util = summary && summary.TotalReceived > 0
    ? Math.round((summary.TotalApplied / summary.TotalReceived) * 100) : 0;

  function onAdjustDone() {
    setAdjusting(null);
    qc.invalidateQueries({ queryKey: ["crm-on-account"], exact: false });
    qc.invalidateQueries({ queryKey: ["crm-on-account-summary"] });
    qc.invalidateQueries({ queryKey: ["bk-milestones"], exact: false });
    qc.invalidateQueries({ queryKey: ["crm-booking-on-account"], exact: false });
    qc.invalidateQueries({ queryKey: ["crm-booking-detail"], exact: false });
  }

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "On Account"]} />
      <CrmShell
        title="On Account"
        subtitle="Customer advance deposits — every rupee received, applied, and available across all bookings."
        action={
          <button onClick={() => { refetch(); refetchSummary(); }} disabled={isFetching}
            className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-50">
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />Refresh
          </button>
        }
      >

        {/* ── KPI tiles ─────────────────────────────────────────────────────── */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile icon={<BadgeIndianRupee size={14} className="text-primary" />}
              label="Total Received" value={formatINR(summary.TotalReceived)}
              sub={`${summary.TotalCount} deposits`} accent="border-border" />
            <KpiTile icon={<TrendingUp size={14} className="text-emerald-600" />}
              label="Total Applied" value={formatINR(summary.TotalApplied)}
              sub={`${summary.AppliedCount} fully settled`} accent="border-emerald-200 dark:border-emerald-800" />
            <KpiTile icon={<Wallet size={14} className="text-blue-600" />}
              label="Available Balance" value={formatINR(summary.TotalAvailable)}
              sub={`${summary.UnappliedCount + summary.PartialCount} open`} accent="border-blue-200 dark:border-blue-800" />
            <KpiTile icon={<Clock size={14} className="text-amber-600" />}
              label="Unapplied" value={formatINR(summary.UnappliedBalance)}
              sub={`${summary.UnappliedCount} not yet applied`} accent="border-amber-200 dark:border-amber-800" />

            {/* Utilisation tile */}
            <div className="rounded-lg border border-border bg-card px-3 py-3 col-span-2 lg:col-span-1 flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-2">
                <SplitSquareHorizontal size={14} className="text-indigo-600" />
                <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Utilisation</span>
              </div>
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="font-bold text-lg">{util}%</span>
                  <span className="text-muted-foreground text-[11px] self-end">{formatINR(summary.PartialBalance)} partial</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                    style={{ width: `${Math.min(100, util)}%` }} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Filter bar ────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-52">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Customer · Booking · Project · Unit…"
              className="w-full h-8 pl-8 pr-3 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          <select value={status} onChange={(e) => setStatus(e.target.value)}
            className="h-8 border border-border rounded-lg px-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="">All Status</option>
            <option value="Unapplied">Unapplied</option>
            <option value="PartiallyApplied">Partial</option>
            <option value="Applied">Applied</option>
          </select>

          <select value={mode} onChange={(e) => setMode(e.target.value)}
            className="h-8 border border-border rounded-lg px-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="">All Modes</option>
            {["Cash","Cheque","NEFT","RTGS","UPI","IMPS","Online"].map((m) => <option key={m}>{m}</option>)}
          </select>

          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 border border-border rounded-lg px-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="h-8 border border-border rounded-lg px-2.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary" />

          <button onClick={runSearch}
            className="h-8 flex items-center gap-1.5 px-3 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90">
            <Filter size={12} />Search
          </button>
          {hasFilters && (
            <button onClick={clearAll}
              className="h-8 flex items-center gap-1 px-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
              <X size={12} />Clear
            </button>
          )}
        </div>

        {/* ── Bank-statement ledger ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-border overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[940px]">
              {/* Column headers */}
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="w-7" />
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Date</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Receipt / Ref</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Customer & Booking</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Mode</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wide font-semibold text-emerald-600">CR Deposited</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wide font-semibold text-amber-600">DR Applied</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wide font-semibold text-blue-600">Balance</th>
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Status</th>
                  <th className="px-3 py-2.5 text-center text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={10} className="py-14 text-center">
                    <Loader2 size={18} className="animate-spin mx-auto text-muted-foreground" />
                    <div className="text-xs text-muted-foreground mt-2">Loading deposits…</div>
                  </td></tr>
                ) : deposits.length === 0 ? (
                  <tr><td colSpan={10} className="py-14 text-center">
                    <Wallet size={26} className="mx-auto text-muted-foreground/30 mb-2" />
                    <div className="text-sm text-muted-foreground">{hasFilters ? "No deposits match the current filters." : "No on-account deposits yet."}</div>
                  </td></tr>
                ) : deposits.map((d) => {
                  const isExp = expanded.has(d.Id);
                  const pct   = d.Amount > 0 ? (d.AppliedAmount / d.Amount) * 100 : 0;
                  const cls   = modeColor[d.PaymentMode || ""] || "bg-muted/50 text-muted-foreground";
                  return (
                    <React.Fragment key={d.Id}>
                      <tr onClick={() => toggle(d.Id)}
                        className="hover:bg-muted/20 cursor-pointer transition-colors">

                        {/* expand toggle */}
                        <td className="pl-2 pr-1 text-center text-muted-foreground">
                          {isExp ? <ChevronDown size={12} /> : <CRight size={12} />}
                        </td>

                        {/* Date */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="text-xs font-mono">{fd(d.ReceivedDate)}</div>
                          <div className="text-[10px] text-muted-foreground">{new Date(d.ReceivedDate).toLocaleDateString("en-IN", { weekday: "short" })}</div>
                        </td>

                        {/* Receipt */}
                        <td className="px-3 py-3">
                          <div className="font-mono text-xs font-semibold text-primary">
                            {d.ReceiptNo || <span className="text-muted-foreground font-normal italic">Pending</span>}
                          </div>
                          {d.TransactionRef && (
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate max-w-[130px]">{d.TransactionRef}</div>
                          )}
                        </td>

                        {/* Customer & Booking */}
                        <td className="px-3 py-3 max-w-[220px]">
                          <div className="font-medium text-sm truncate">{d.ApplicantName}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            <span className="font-mono">{d.BookingNo}</span>
                            {d.ProjectName && <> · {d.ProjectName}</>}
                            {d.UnitNo && <> · {d.UnitNo}</>}
                          </div>
                        </td>

                        {/* Mode */}
                        <td className="px-3 py-3">
                          {d.PaymentMode
                            ? <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${cls}`}>{d.PaymentMode}</span>
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>

                        {/* CR */}
                        <td className="px-3 py-3 text-right">
                          <div className="font-semibold text-sm text-emerald-700 dark:text-emerald-400 font-mono">{formatINR(d.Amount)}</div>
                          {/* utilisation bar */}
                          <div className="mt-1.5 h-1 w-20 ml-auto rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-blue-500" : "bg-muted-foreground/20"}`}
                              style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </td>

                        {/* DR */}
                        <td className="px-3 py-3 text-right font-mono text-sm">
                          {d.AppliedAmount > 0
                            ? <span className="text-amber-600 dark:text-amber-400 font-semibold">{formatINR(d.AppliedAmount)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>

                        {/* Balance */}
                        <td className="px-3 py-3 text-right font-mono text-sm">
                          {d.AvailableBalance > 0
                            ? <span className="font-bold text-blue-700 dark:text-blue-400">{formatINR(d.AvailableBalance)}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>

                        {/* Status */}
                        <td className="px-3 py-3"><StatusChip s={d.Status} /></td>

                        {/* Actions */}
                        <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1.5">
                            {canEdit && d.Status !== "Applied" && (
                              <button onClick={() => setAdjusting(d)}
                                className="text-xs px-2.5 py-1 rounded-lg border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 font-medium transition-colors whitespace-nowrap">
                                Adjust
                              </button>
                            )}
                            <button onClick={() => navigate(`/crm/booking/${d.BookingId}`)}
                              title="Open booking"
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                              <ExternalLink size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {isExp && (
                        <tr className="bg-muted/5">
                          <td />
                          <td colSpan={9} className="border-l-2 border-primary/20">
                            <MilestoneSubTable bookingId={d.BookingId} deposit={d} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>

              {/* Page totals footer */}
              {deposits.length > 0 && (
                <tfoot className="border-t-2 border-border bg-muted/30">
                  <tr>
                    <td colSpan={5} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Page Total ({deposits.length} entries)
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400">{formatINR(pageCR)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-sm text-amber-600 dark:text-amber-400">{pageDR > 0 ? formatINR(pageDR) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-bold text-sm text-blue-700 dark:text-blue-400">{pageBAL > 0 ? formatINR(pageBAL) : "—"}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border text-xs text-muted-foreground bg-muted/10">
              <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total} deposits</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-40"><ChevronLeft size={14} /></button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}
                  className="p-1 rounded hover:bg-muted disabled:opacity-40"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      </CrmShell>

      {adjusting && (
        <AdjustDialog deposit={adjusting} onClose={() => setAdjusting(null)} onDone={onAdjustDone} />
      )}
    </>
  );
}
