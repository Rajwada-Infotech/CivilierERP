import React from "react";
import { useState, useEffect, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, ArrowLeftRight, Building2, Landmark, Loader2, RefreshCw,
  CheckCircle2, Clock, FileText, AlertCircle, Search, X, Check,
  History, ArrowUpRight, ArrowDownRight, ChevronRight, ArrowLeft, Wallet,
} from "lucide-react";
import {
  getFundTransfers,
  createFundTransfer,
  approveFundTransfer,
  rejectFundTransfer,
  getLoans,
  getLoan,
  type FundTransferSummary,
  type FundTransferType,
  type LoanSummary,
  type LoanDetail,
  type LoanSide,
  type LoanLedgerEntry,
} from "@/api/fundTransferApi";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getBanks, type BankRecord } from "@/api/bankMasterApi";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";

const STATUS_CFG: Record<string, { text: string; bar: string }> = {
  Draft:    { text: "text-muted-foreground", bar: "bg-border" },
  Pending:  { text: "text-amber-700",  bar: "bg-amber-500" },
  Approved: { text: "text-emerald-700", bar: "bg-emerald-500" },
  Rejected: { text: "text-rose-700",   bar: "bg-rose-500" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.Draft;
  return (
    <span className={cn("inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border border-border bg-card font-mono text-[10px] font-semibold uppercase tracking-wider", cfg.text)}>
      <span className={cn("w-[3px] h-3 rounded-[1px]", cfg.bar)} />
      {status}
    </span>
  );
}

function TypeBadge({ type }: { type: FundTransferType }) {
  const isInter = type === "Inter";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 pl-1.5 pr-2 py-0.5 rounded-sm border font-mono text-[10px] font-semibold uppercase tracking-wider",
        isInter ? "border-violet-300 text-violet-700 bg-violet-50/50" : "border-border text-muted-foreground bg-card",
      )}
    >
      <span className={cn("w-[3px] h-3 rounded-[1px]", isInter ? "bg-violet-500" : "bg-border")} />
      {isInter ? "Inter · Loan" : "Intra"}
    </span>
  );
}

// Signature element: a literal source → amount → destination flow, instead of
// stacked "A (Co) → B (Co)" text. Reused in the desktop table, mobile cards,
// and as a live preview inside the New Transfer dialog. `compact` drops the
// amount chip and shrinks type, for the table's tighter row height.
function FlowConnector({
  sourceLabel,
  destLabel,
  sourceSub,
  destSub,
  amount,
  type,
  compact = false,
}: {
  sourceLabel: string;
  destLabel: string;
  sourceSub?: string | null;
  destSub?: string | null;
  amount?: string;
  type: FundTransferType;
  compact?: boolean;
}) {
  const rail = type === "Inter" ? "border-violet-400" : "border-border";
  const node = type === "Inter" ? "bg-violet-500" : "bg-foreground/40";
  return (
    <div className={cn("flex items-center gap-2 min-w-0 font-mono", amount && "mt-2")}>
      <div className="min-w-0 text-right shrink-0">
        <p className={cn("font-semibold text-foreground truncate", compact ? "text-[11px] max-w-[100px]" : "text-xs max-w-[140px]")}>{sourceLabel}</p>
        {sourceSub && !compact && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{sourceSub}</p>}
      </div>

      <div className="relative flex-1 min-w-[36px] flex items-center">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", node)} />
        <div className={cn("flex-1 border-t border-dashed", rail)} />
        {amount && (
          <span
            className={cn(
              "absolute left-1/2 -translate-x-1/2 -top-2 px-1 bg-card font-semibold tabular-nums whitespace-nowrap",
              compact ? "text-[10px]" : "text-[11px]",
              type === "Inter" ? "text-violet-700" : "text-foreground",
            )}
          >
            {amount}
          </span>
        )}
        <ArrowLeftRight size={compact ? 8 : 9} className={cn("shrink-0", type === "Inter" ? "text-violet-500" : "text-muted-foreground")} />
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", node)} />
      </div>

      <div className="min-w-0 shrink-0">
        <p className={cn("font-semibold truncate", type === "Inter" ? "text-violet-700" : "text-foreground", compact ? "text-[11px] max-w-[100px]" : "text-xs max-w-[140px]")}>{destLabel}</p>
        {destSub && !compact && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{destSub}</p>}
      </div>
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function bankLabel(b: BankRecord) {
  const acct = b.BAccountNumber ? ` — ${b.BAccountNumber}` : "";
  const company = b.BCompanyName ? ` (${b.BCompanyName})` : "";
  return `${b.BName || `Bank #${b.BId}`}${acct}${company}`;
}

function BalancePill({ side }: { side: LoanSide }) {
  const settled = Math.abs(side.NetBalance) < 0.01;
  const owed = side.NetBalance > 0;
  return (
    <div className={cn(
      "flex items-center justify-between gap-2 px-3 py-2 rounded-lg border",
      settled ? "border-border bg-muted/20" : owed ? "border-emerald-400/25 bg-emerald-500/5" : "border-rose-400/25 bg-rose-500/5",
    )}>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground truncate">{side.CompanyName}</p>
        <p className={cn("text-[10px] font-medium mt-0.5", settled ? "text-muted-foreground" : owed ? "text-emerald-700" : "text-rose-700")}>
          {settled ? "Settled" : owed ? "Owed to this company" : "Owes to counterparty"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!settled && (owed ? <ArrowUpRight size={13} className="text-emerald-600" /> : <ArrowDownRight size={13} className="text-rose-600" />)}
        <span className={cn("font-mono text-sm font-bold tabular-nums", settled ? "text-muted-foreground" : owed ? "text-emerald-700" : "text-rose-700")}>
          {formatINR(Math.abs(side.NetBalance))}
        </span>
      </div>
    </div>
  );
}

function LoanRegisterView({
  loans,
  loading,
  onOpen,
}: {
  loans: LoanSummary[];
  loading: boolean;
  onOpen: (lHeadId: number) => void;
}) {
  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
        <p className="text-sm text-muted-foreground mt-2">Loading the loan register…</p>
      </div>
    );
  }
  if (loans.length === 0) {
    return (
      <div className="py-20 text-center rounded-lg border border-border bg-card">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Landmark size={36} className="opacity-20" />
          <p className="text-sm font-medium">No inter-company loans yet</p>
          <p className="text-xs max-w-sm">
            A loan account opens automatically the first time an Inter-Company Fund Transfer is approved between two companies.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md border border-border bg-muted/20 text-[11px] text-muted-foreground border-l-[3px] border-l-violet-500">
        <Wallet size={13} className="shrink-0 mt-0.5 text-violet-600" />
        <span>
          One ledger account per company pair, shared by every Inter-Company transfer between them in either
          direction. Balances are derived live from the General Ledger — a reverse transfer repays the loan
          automatically.
        </span>
      </div>
      {loans.map((loan) => (
        <button
          key={loan.LHeadId}
          onClick={() => onOpen(loan.LHeadId)}
          className="w-full text-left rounded-lg border border-border bg-card p-4 hover:border-violet-400/40 hover:bg-violet-500/[0.02] transition-colors"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0">
                <Landmark size={13} className="text-violet-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{loan.LHeadName}</p>
                <p className="text-[10px] font-mono text-muted-foreground">{loan.LHeadCode}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-right">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">Transfers</p>
                <p className="text-sm font-mono font-semibold text-foreground">{loan.TransferCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-heading">Last Activity</p>
                <p className="text-sm font-mono font-semibold text-foreground">{fmtDate(loan.LastActivity)}</p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {loan.Sides.map((side) => <BalancePill key={side.CompanyId} side={side} />)}
          </div>
        </button>
      ))}
    </div>
  );
}

// Each approved Inter-Company transfer contributes exactly two legs to the
// shared loan head (one per company) — group raw GL entries back into one
// row per real-world transfer event, rather than showing raw debit/credit
// legs, which reads far closer to an actual passbook.
function buildLoanTimeline(entries: LoanLedgerEntry[]) {
  const bySource = new Map<number, LoanLedgerEntry[]>();
  for (const e of entries) {
    if (!bySource.has(e.SourceId)) bySource.set(e.SourceId, []);
    bySource.get(e.SourceId)!.push(e);
  }
  return [...bySource.entries()]
    .map(([sourceId, legs]) => {
      const drLeg = legs.find((l) => Number(l.DebitAmount) > 0);
      const crLeg = legs.find((l) => Number(l.CreditAmount) > 0);
      const first = legs[0];
      return {
        sourceId,
        docNo: first.DocNo,
        date: first.VoucherDate,
        status: first.TransferStatus,
        amount: Number(drLeg?.DebitAmount || crLeg?.CreditAmount || 0),
        fromCompany: drLeg?.CompanyName || "—",
        toCompany: crLeg?.CompanyName || "—",
      };
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sourceId - b.sourceId);
}

function LoanDetailView({
  detail,
  loading,
  onBack,
}: {
  detail: LoanDetail | null;
  loading: boolean;
  onBack: () => void;
}) {
  const timeline = useMemo(() => (detail ? buildLoanTimeline(detail.entries) : []), [detail]);

  // Current balance per company, derived the same way the register's own
  // summary is (net Dr-Cr per CompanyId) — kept in sync with GET /loans
  // without a second round trip, since the raw entries are already here.
  const sides = useMemo(() => {
    if (!detail) return [];
    const byCompany = new Map<number, { CompanyId: number; CompanyName: string; NetBalance: number }>();
    for (const e of detail.entries) {
      if (!byCompany.has(e.CompanyId)) {
        byCompany.set(e.CompanyId, { CompanyId: e.CompanyId, CompanyName: e.CompanyName || `Company ${e.CompanyId}`, NetBalance: 0 });
      }
      const side = byCompany.get(e.CompanyId)!;
      side.NetBalance += Number(e.DebitAmount || 0) - Number(e.CreditAmount || 0);
    }
    return [...byCompany.values()].map((s) => ({ ...s, NetBalance: Math.round(s.NetBalance * 100) / 100 }));
  }, [detail]);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={13} /> Back to Loan Register
      </button>

      {loading || !detail ? (
        <div className="py-16 text-center">
          <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading loan ledger…</p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <Landmark size={15} className="text-violet-600" />
              <h2 className="text-sm font-semibold text-foreground font-heading">{detail.LHeadName}</h2>
            </div>
            <p className="text-[11px] font-mono text-muted-foreground mb-3">
              {detail.LHeadCode} · opened {fmtDate(detail.OpenedAt)}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sides.map((side) => <BalancePill key={side.CompanyId} side={side} />)}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-1.5">
              <History size={13} className="text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Transfer History</h3>
            </div>
            {timeline.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No transfers recorded yet</div>
            ) : (
              <div className="divide-y divide-border">
                {timeline.map((ev) => (
                  <div key={ev.sourceId} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-foreground">{ev.docNo || `FT-${ev.sourceId}`}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(ev.date)}</span>
                        {ev.status && <StatusBadge status={ev.status} />}
                      </div>
                      <p className="text-xs text-foreground mt-1 truncate">
                        <span className="font-medium">{ev.fromCompany}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="font-medium">{ev.toCompany}</span>
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatINR(ev.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function FundTransfer() {
  const rights = usePageRights("fund-transfer");
  const [activeTab, setActiveTab] = useState<"transfers" | "loans">("transfers");
  const [transfers, setTransfers] = useState<FundTransferSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<FundTransferType | null>(null);

  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [loansLoading, setLoansLoading] = useState(true);
  const [loanDetail, setLoanDetail] = useState<LoanDetail | null>(null);
  const [loanDetailLoading, setLoanDetailLoading] = useState(false);

  const [companies, setCompanies] = useState<{ id: number; label: string }[]>([]);
  const [banks, setBanks] = useState<BankRecord[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transferType, setTransferType] = useState<FundTransferType>("Intra");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sourceCompanyId, setSourceCompanyId] = useState("");
  const [destCompanyId, setDestCompanyId] = useState("");
  const [sourceBankId, setSourceBankId] = useState("");
  const [destBankId, setDestBankId] = useState("");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");

  const [acting, setActing] = useState<{ id: number; action: "approve" | "reject" } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getFundTransfers();
      setTransfers(data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load fund transfers");
    } finally {
      setLoading(false);
    }
  };

  const loadLoans = async () => {
    setLoansLoading(true);
    try {
      const data = await getLoans();
      setLoans(data);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load the loan register");
    } finally {
      setLoansLoading(false);
    }
  };

  const openLoanDetail = async (lHeadId: number) => {
    setActiveTab("loans");
    setLoanDetailLoading(true);
    try {
      const detail = await getLoan(lHeadId);
      setLoanDetail(detail);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load loan ledger");
    } finally {
      setLoanDetailLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadLoans();
    getEnterpriseOptions(undefined, "C")
      .then((rows) => setCompanies(rows.map((r) => ({ id: r.id, label: r.label }))))
      .catch(() => setCompanies([]));
    getBanks()
      .then((rows) => setBanks(rows.filter((b) => b.BStatus)))
      .catch(() => setBanks([]));
  }, []);

  // Intra-company: destination company is always the same as source — the
  // whole point is moving cash between two of the SAME company's banks.
  // Switching type resets whichever destination fields no longer apply,
  // rather than leaving a stale selection from a previous mode behind.
  useEffect(() => {
    if (transferType === "Intra") {
      setDestCompanyId(sourceCompanyId);
      setDestBankId("");
    } else {
      setDestCompanyId("");
      setDestBankId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transferType]);

  useEffect(() => {
    if (transferType === "Intra") setDestCompanyId(sourceCompanyId);
  }, [sourceCompanyId, transferType]);

  const resetForm = () => {
    setTransferType("Intra");
    setTransferDate(new Date().toISOString().slice(0, 10));
    setSourceCompanyId("");
    setDestCompanyId("");
    setSourceBankId("");
    setDestBankId("");
    setAmount("");
    setNarration("");
  };

  const handleApprove = async (id: number) => {
    setActing({ id, action: "approve" });
    try {
      await approveFundTransfer(id);
      toast.success("Fund Transfer approved and posted to GL");
      load();
      loadLoans();
    } catch (err: any) {
      toast.error(err?.message || "Approval failed");
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (id: number) => {
    setActing({ id, action: "reject" });
    try {
      await rejectFundTransfer(id);
      toast.success("Fund Transfer rejected");
      load();
    } catch (err: any) {
      toast.error(err?.message || "Rejection failed");
    } finally {
      setActing(null);
    }
  };

  const submit = async () => {
    if (!sourceCompanyId) { toast.error("Select the source company."); return; }
    if (!destCompanyId) { toast.error("Select the destination company."); return; }
    if (!sourceBankId || !destBankId) { toast.error("Select both the source and destination bank accounts."); return; }
    if (sourceBankId === destBankId) { toast.error("Source and destination bank accounts must differ."); return; }
    if (transferType === "Intra" && sourceCompanyId !== destCompanyId) {
      toast.error("Intra-company transfer requires the same company on both sides.");
      return;
    }
    if (transferType === "Inter" && sourceCompanyId === destCompanyId) {
      toast.error("Inter-company transfer requires two different companies — pick a destination company.");
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error("Enter an amount greater than 0."); return; }

    setSaving(true);
    try {
      await createFundTransfer({
        TransferDate: transferDate,
        TransferType: transferType,
        SourceCompanyId: parseInt(sourceCompanyId, 10),
        DestinationCompanyId: parseInt(destCompanyId, 10),
        SourceBankId: parseInt(sourceBankId, 10),
        DestinationBankId: parseInt(destBankId, 10),
        Amount: amt,
        Narration: narration || undefined,
      });
      toast.success("Fund Transfer created and submitted for approval");
      setDialogOpen(false);
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create Fund Transfer");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => ({
    total:    transfers.length,
    approved: transfers.filter((t) => t.Status === "Approved").length,
    pending:  transfers.filter((t) => t.Status === "Pending").length,
    inter:    transfers.filter((t) => t.TransferType === "Inter").length,
  }), [transfers]);

  const filtered = useMemo(() => {
    let rows = transfers;
    if (statusFilter) rows = rows.filter((t) => t.Status === statusFilter);
    if (typeFilter) rows = rows.filter((t) => t.TransferType === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (t) =>
          (t.DocNo || "").toLowerCase().includes(q) ||
          (t.Narration || "").toLowerCase().includes(q) ||
          (t.SourceCompanyName || "").toLowerCase().includes(q) ||
          (t.DestinationCompanyName || "").toLowerCase().includes(q) ||
          (t.Status || "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [transfers, search, statusFilter, typeFilter]);

  const toggleStatusFilter = (status: string) =>
    setStatusFilter((prev) => (prev === status ? null : status));
  const toggleTypeFilter = (type: FundTransferType) =>
    setTypeFilter((prev) => (prev === type ? null : type));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Fund Transfer"]} />
      <FinanceShell
        title="Fund Transfer"
        subtitle="Move cash between bank accounts — intra-company, or inter-company as a loan"
        icon={ArrowLeftRight}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={loading}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-colors text-muted-foreground disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && (
              <button
                onClick={() => setDialogOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg gradient-accent text-white text-sm font-semibold transition-all"
              >
                <Plus size={14} />
                New Fund Transfer
              </button>
            )}
          </div>
        }
      >
        {/* ── Section tabs ── */}
        <div className="flex items-center gap-1 border-b border-border mb-5">
          <button
            onClick={() => setActiveTab("transfers")}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors font-heading",
              activeTab === "transfers" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <ArrowLeftRight size={13} /> Transfers
          </button>
          <button
            onClick={() => { setActiveTab("loans"); setLoanDetail(null); }}
            className={cn(
              "flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors font-heading",
              activeTab === "loans" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Landmark size={13} /> Loan Ledger
            {loans.length > 0 && (
              <span className="px-1.5 py-0 rounded-full bg-violet-500/10 text-violet-700 text-[10px] font-mono">{loans.length}</span>
            )}
          </button>
        </div>

        {activeTab === "transfers" && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-card mb-5">
            {[
              { label: "Total Transfers", value: stats.total,    color: "text-foreground", onClick: () => { setStatusFilter(null); setTypeFilter(null); }, active: !statusFilter && !typeFilter },
              { label: "Approved",        value: stats.approved, color: "text-foreground", onClick: () => toggleStatusFilter("Approved"), active: statusFilter === "Approved" },
              { label: "Pending",         value: stats.pending,  color: stats.pending > 0 ? "text-amber-700" : "text-foreground", onClick: () => toggleStatusFilter("Pending"), active: statusFilter === "Pending" },
              { label: "Inter-Company",   value: stats.inter,    color: stats.inter > 0 ? "text-violet-700" : "text-foreground", onClick: () => toggleTypeFilter("Inter"), active: typeFilter === "Inter" },
            ].map(({ label, value, color, onClick, active }) => (
              <button
                key={label}
                onClick={onClick}
                className={cn("px-4 py-3 text-left transition-colors hover:bg-muted/40", active && "bg-primary/5")}
              >
                <p className={cn("text-2xl font-bold leading-none tabular-nums font-mono", color)}>{value}</p>
                <p className={cn("text-[10px] font-semibold uppercase tracking-wider mt-1.5 font-heading", active ? "text-primary" : "text-muted-foreground")}>{label}</p>
              </button>
            ))}
          </div>
        )}

        {activeTab === "transfers" && <>
        <div className="relative mb-4">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by doc no, company, narration, or status…"
            className="w-full pl-8 pr-8 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>

        {(statusFilter || typeFilter) && (
          <div className="flex items-center gap-1.5 mb-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground font-heading">Filtered by:</span>
            {statusFilter && (
              <button onClick={() => setStatusFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-muted text-[11px] font-medium text-foreground hover:bg-muted/60">
                {statusFilter} <X size={10} />
              </button>
            )}
            {typeFilter && (
              <button onClick={() => setTypeFilter(null)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-400/30 bg-violet-500/10 text-[11px] font-medium text-violet-700 hover:bg-violet-500/20">
                {typeFilter === "Inter" ? "Inter-Company" : "Intra-Company"} <X size={10} />
              </button>
            )}
          </div>
        )}

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="md:hidden divide-y divide-border">
            {loading ? (
              <div className="py-16 text-center">
                <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Loading transfers…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-20 text-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <ArrowLeftRight size={36} className="opacity-20" />
                  <p className="text-sm font-medium">
                    {search ? "No transfers match your search" : "No fund transfers yet"}
                  </p>
                </div>
              </div>
            ) : (
              filtered.map((t) => (
                <div key={t.FTId} className="px-4 py-3.5 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {t.DocNo || `FT-${t.FTId}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(t.TransferDate)}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-foreground tabular-nums shrink-0">
                      {formatINR(t.Amount || 0)}
                    </span>
                  </div>
                  <div className="mb-2 overflow-x-auto">
                    <FlowConnector
                      sourceLabel={t.SourceBankName || "—"}
                      sourceSub={t.SourceCompanyName}
                      destLabel={t.DestinationBankName || "—"}
                      destSub={t.DestinationCompanyName}
                      type={t.TransferType}
                    />
                  </div>
                  {t.TransferType === "Inter" && t.LoanHeadName && t.LoanHeadId && (
                    <button
                      onClick={() => openLoanDetail(t.LoanHeadId!)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-violet-400/20 bg-violet-500/5 text-[10px] font-mono text-violet-600 mb-2 hover:bg-violet-500/15 transition-colors"
                    >
                      <Landmark size={9} /> {t.LoanHeadName} <ChevronRight size={9} />
                    </button>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <TypeBadge type={t.TransferType} />
                      <StatusBadge status={t.Status} />
                    </div>
                    {t.Status === "Pending" && rights.canEdit && (
                      <div className="flex gap-1">
                        <button
                          disabled={acting?.id === t.FTId}
                          onClick={() => handleApprove(t.FTId)}
                          title="Approve"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                        >
                          {acting?.id === t.FTId && acting.action === "approve" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button
                          disabled={acting?.id === t.FTId}
                          onClick={() => handleReject(t.FTId)}
                          title="Reject"
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                        >
                          {acting?.id === t.FTId && acting.action === "reject" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Doc No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">From → To</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground font-heading">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <Loader2 className="h-6 w-6 animate-spin inline text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mt-2">Loading transfers…</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <ArrowLeftRight size={36} className="opacity-20" />
                      <p className="text-sm font-medium">
                        {search ? "No transfers match your search" : "No fund transfers yet"}
                      </p>
                      {!search && rights.canCreate && (
                        <button
                          onClick={() => setDialogOpen(true)}
                          className="flex items-center gap-1.5 mt-1 px-4 py-2 rounded-lg gradient-accent text-white text-xs font-semibold"
                        >
                          <Plus size={12} /> Create First Transfer
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.FTId} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                        {t.DocNo || `FT-${t.FTId}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(t.TransferDate)}</td>
                    <td className="px-4 py-3"><TypeBadge type={t.TransferType} /></td>
                    <td className="px-4 py-3 text-sm">
                      <FlowConnector
                        sourceLabel={t.SourceBankName || "—"}
                        destLabel={t.DestinationBankName || "—"}
                        type={t.TransferType}
                        compact
                      />
                      {t.TransferType === "Inter" && t.LoanHeadName && t.LoanHeadId && (
                        <button
                          onClick={() => openLoanDetail(t.LoanHeadId!)}
                          className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border border-violet-400/20 bg-violet-500/5 text-[10px] font-mono text-violet-600 hover:bg-violet-500/15 transition-colors"
                        >
                          <Landmark size={9} /> {t.LoanHeadName} <ChevronRight size={9} />
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground tabular-nums">
                      {formatINR(t.Amount || 0)}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={t.Status} /></td>
                    <td className="px-4 py-3 text-right">
                      {t.Status === "Pending" && rights.canEdit && (
                        <div className="flex justify-end gap-1">
                          <button
                            disabled={acting?.id === t.FTId}
                            onClick={() => handleApprove(t.FTId)}
                            title="Approve"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors disabled:opacity-40"
                          >
                            {acting?.id === t.FTId && acting.action === "approve" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                          </button>
                          <button
                            disabled={acting?.id === t.FTId}
                            onClick={() => handleReject(t.FTId)}
                            title="Reject"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                          >
                            {acting?.id === t.FTId && acting.action === "reject" ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <X size={13} />
                            )}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!loading && filtered.length > 0 && (search || statusFilter || typeFilter) && (
            <div className="px-4 py-2.5 border-t border-border bg-muted/20">
              <p className="text-xs text-muted-foreground">
                Showing {filtered.length} of {transfers.length} transfers
              </p>
            </div>
          )}
        </div>
        </>}

        {activeTab === "loans" && (
          loanDetail || loanDetailLoading ? (
            <LoanDetailView
              detail={loanDetail}
              loading={loanDetailLoading}
              onBack={() => setLoanDetail(null)}
            />
          ) : (
            <LoanRegisterView
              loans={loans}
              loading={loansLoading}
              onOpen={openLoanDetail}
            />
          )
        )}
      </FinanceShell>

      {/* ── New Fund Transfer Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ArrowLeftRight size={15} className="text-primary" />
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold font-heading">New Fund Transfer</DialogTitle>
                <DialogDescription className="text-[11px] mt-0.5">
                  Inter-company transfers book automatically as a loan between the two companies.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="px-5 py-4 space-y-4">
            {/* Type toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTransferType("Intra")}
                className={cn(
                  "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors",
                  transferType === "Intra" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Building2 size={13} /> Intra-Company
              </button>
              <button
                type="button"
                onClick={() => setTransferType("Inter")}
                className={cn(
                  "flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors",
                  transferType === "Inter" ? "border-violet-500 bg-violet-500/10 text-violet-600" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Landmark size={13} /> Inter-Company (Loan)
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Source Company *</label>
                <Select value={sourceCompanyId} onValueChange={setSourceCompanyId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select company…" />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Destination Company *</label>
                <Select
                  value={destCompanyId}
                  onValueChange={setDestCompanyId}
                  disabled={transferType === "Intra"}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={transferType === "Intra" ? "Same as source" : "Select company…"} />
                  </SelectTrigger>
                  <SelectContent>
                    {companies
                      .filter((c) => transferType === "Inter" ? String(c.id) !== sourceCompanyId : true)
                      .map((c) => (
                        <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Source Bank *</label>
                <Select value={sourceBankId} onValueChange={setSourceBankId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select bank…" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.map((b) => (
                      <SelectItem key={b.BId} value={String(b.BId)} className="text-sm">{bankLabel(b)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Destination Bank *</label>
                <Select value={destBankId} onValueChange={setDestBankId}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select bank…" />
                  </SelectTrigger>
                  <SelectContent>
                    {banks.filter((b) => String(b.BId) !== sourceBankId).map((b) => (
                      <SelectItem key={b.BId} value={String(b.BId)} className="text-sm">{bankLabel(b)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Date *</label>
                <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Amount *</label>
                <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
            </div>

            {(sourceBankId || destBankId) && (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5 overflow-x-auto">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground font-heading mb-1.5">Preview</p>
                <FlowConnector
                  sourceLabel={banks.find((b) => String(b.BId) === sourceBankId)?.BName || "Source bank"}
                  destLabel={banks.find((b) => String(b.BId) === destBankId)?.BName || "Destination bank"}
                  amount={amount && Number(amount) > 0 ? formatINR(Number(amount)) : undefined}
                  type={transferType}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground font-heading">Narration</label>
              <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="Reason for this transfer" />
            </div>

            {transferType === "Inter" && (
              <div className="flex items-start gap-2.5 pl-3 pr-3 py-2.5 rounded-md border border-border bg-muted/20 text-[11px] text-muted-foreground border-l-[3px] border-l-violet-500">
                <Landmark size={13} className="shrink-0 mt-0.5 text-violet-600" />
                <span>
                  <span className="font-semibold text-foreground">Books as an inter-company loan on approval.</span> The
                  source company's books record a receivable, the destination company's a payable, against a shared
                  loan account for this company pair. A reverse-direction transfer later repays it automatically.
                </span>
              </div>
            )}
          </div>

          <DialogFooter className="px-5 py-3.5 border-t border-border bg-muted/20">
            <button
              onClick={() => setDialogOpen(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg gradient-accent text-white text-sm font-semibold transition-all disabled:opacity-50"
            >
              {saving && <Loader2 size={13} className="animate-spin" />}
              Submit for Approval
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}