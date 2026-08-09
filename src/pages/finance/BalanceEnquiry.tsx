/**
 * BalanceEnquiry.tsx — Finance → Balance Enquiry
 *
 * A bank "passbook": pick a company, pick one of its bank accounts (a
 * company can have several, even at the same bank), see the opening
 * balance, a running transaction history sourced from every module that
 * ever touches this bank (Payments, Received Payments, Journal Vouchers,
 * Fund Transfers), and a robustly-computed current balance. See
 * backend/routes/balanceEnquiry.js for why dbo.GeneralLedgerEntry is a
 * provably-complete source for this.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { getCompanyOptions } from "@/api/bankMasterApi";
import {
  getEnquiryBanks,
  getBalanceSummary,
  getPassbook,
  type EnquiryBank,
  type BalanceSummary,
  type PassbookEntry,
} from "@/api/balanceEnquiryApi";
import {
  Wallet,
  Landmark,
  X,
  RefreshCw,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  FileText,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Receipt,
  Loader2,
  CreditCard,
  Eye,
  EyeOff,
} from "lucide-react";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

function maskAccountNumber(acc: string | null | undefined): string {
  if (!acc) return "•••• ••••";
  const clean = acc.replace(/\s+/g, "");
  if (clean.length <= 4) return clean;
  return `•••• •••• ${clean.slice(-4)}`;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Quick date-range presets — one tap sets both From/To instead of hand-picking.
function datePreset(key: "today" | "week" | "month" | "fy" | "all"): { from: string; to: string } {
  const now = new Date();
  const to = toISODate(now);
  if (key === "today") return { from: to, to };
  if (key === "week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return { from: toISODate(d), to };
  }
  if (key === "month") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toISODate(d), to };
  }
  if (key === "fy") {
    // Indian financial year: Apr 1 – Mar 31.
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: toISODate(new Date(fyStartYear, 3, 1)), to };
  }
  return { from: "", to: "" };
}

const SOURCE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  NewPayment: { label: "Payment", icon: ArrowUpRight, color: "text-rose-500", bg: "bg-rose-500/10" },
  PaymentPosting: { label: "Payment", icon: ArrowUpRight, color: "text-rose-500", bg: "bg-rose-500/10" },
  BounceChargePosting: { label: "Bounce Charge", icon: ArrowUpRight, color: "text-rose-500", bg: "bg-rose-500/10" },
  ReceivedPayment: { label: "Received Payment", icon: ArrowDownLeft, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  FundTransfer: { label: "Fund Transfer", icon: ArrowLeftRight, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  JournalVoucher: { label: "Journal Voucher", icon: FileText, color: "text-amber-500", bg: "bg-amber-500/10" },
};

function sourceMeta(sourceType: string) {
  return SOURCE_META[sourceType] || { label: sourceType, icon: Receipt, color: "text-muted-foreground", bg: "bg-muted" };
}

function docRefFor(t: PassbookEntry): string | null {
  return t.NewPaymentDocNo || t.ReceivedPaymentDocNo || t.JournalVoucherNo || t.FundTransferDocNo || t.VoucherNo || null;
}

const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Date", accessor: (r) => fmtDate(r.VoucherDate as string) },
  { header: "Voucher No", accessor: "VoucherNo" },
  { header: "Type", accessor: (r) => sourceMeta(r.SourceType as string).label },
  { header: "Reference", accessor: (r) => docRefFor(r as unknown as PassbookEntry) ?? "—" },
  { header: "Narration", accessor: "Narration" },
  { header: "Cost Centre", accessor: (r) => (r.CostCenterName as string) ?? "—" },
  { header: "Debit", accessor: (r) => (Number(r.DebitAmount) > 0 ? Number(r.DebitAmount).toFixed(2) : "") },
  { header: "Credit", accessor: (r) => (Number(r.CreditAmount) > 0 ? Number(r.CreditAmount).toFixed(2) : "") },
  { header: "Balance", accessor: (r) => Number(r.RunningBalance).toFixed(2) },
];

const selectCls =
  "w-full h-8 pl-8 pr-7 bg-input/70 border border-border rounded-lg text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none appearance-none";

export default function BalanceEnquiry() {
  const rights = usePageRights("balance-enquiry");

  const [companyId, setCompanyId] = useState<string>("");
  const [bankId, setBankId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [showBalance, setShowBalance] = useState(true);
  const [activePreset, setActivePreset] = useState<"today" | "week" | "month" | "fy" | "all" | "custom">("all");

  const applyPreset = (key: "today" | "week" | "month" | "fy" | "all") => {
    setActivePreset(key);
    const { from, to } = datePreset(key);
    setFromDate(from);
    setToDate(to);
  };

  const { data: companies = [] } = useQuery({
    queryKey: ["company-options-balance-enquiry"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60 * 1000,
  });

  const selectedCompanyName = useMemo(
    () => companies.find((c) => String(c.id) === companyId)?.label ?? "",
    [companies, companyId],
  );

  const { data: banks = [], isLoading: loadingBanks } = useQuery({
    queryKey: ["balance-enquiry-banks", selectedCompanyName],
    queryFn: () => getEnquiryBanks(selectedCompanyName || undefined),
  });

  // Auto-select the first bank whenever the filtered list changes and
  // nothing (or something no longer in the list) is currently selected.
  useEffect(() => {
    if (banks.length === 0) {
      setBankId(null);
      return;
    }
    if (!bankId || !banks.some((b) => b.BId === bankId)) {
      setBankId(banks[0].BId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banks]);

  const summaryQuery = useQuery<BalanceSummary>({
    queryKey: ["balance-enquiry-summary", bankId, fromDate, toDate],
    queryFn: () => getBalanceSummary(bankId as number, { from: fromDate || undefined, to: toDate || undefined }),
    enabled: !!bankId,
  });

  const passbookQuery = useQuery({
    queryKey: ["balance-enquiry-passbook", bankId, fromDate, toDate],
    queryFn: () => getPassbook(bankId as number, { from: fromDate || undefined, to: toDate || undefined, limit: 500 }),
    enabled: !!bankId,
  });

  const bank = summaryQuery.data?.bank;
  const transactions = passbookQuery.data?.transactions ?? [];
  const loading = summaryQuery.isFetching || passbookQuery.isFetching;

  const refreshAll = () => {
    summaryQuery.refetch();
    passbookQuery.refetch();
  };

  useEffect(() => {
    if (summaryQuery.error) toast.error((summaryQuery.error as Error).message);
    if (passbookQuery.error) toast.error((passbookQuery.error as Error).message);
  }, [summaryQuery.error, passbookQuery.error]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Balance Enquiry"]} />
      <FinanceShell
        title="Balance Enquiry"
        subtitle="Bank passbook — running balance across every payment, receipt, transfer and voucher"
        icon={Wallet}
        action={
          <button
            onClick={refreshAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        {/* ── Company / Bank selectors ─────────────────────────────────────── */}
        <div className="glass rounded-xl px-4 sm:px-5 py-4 ring-1 ring-border/60 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">Company</label>
              <div className="relative mt-1">
                <Landmark size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className={selectCls}
                >
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 sm:flex-[2] min-w-0">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">Bank Account</label>
              <div className="relative mt-1">
                <CreditCard size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <select
                  value={bankId ?? ""}
                  onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingBanks || banks.length === 0}
                  className={selectCls}
                >
                  {banks.length === 0 && <option value="">No bank accounts found</option>}
                  {banks.map((b) => (
                    <option key={b.BId} value={b.BId}>
                      {b.BName} — {maskAccountNumber(b.BAccountNumber)}{b.BCompanyName ? ` · ${b.BCompanyName}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Quick date-range presets + custom From/To — horizontally
              scrollable on narrow screens so nothing wraps awkwardly. */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 min-w-0 overflow-x-auto">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">Range</label>
              <div className="flex items-center gap-1.5 mt-1.5 pb-0.5">
                {([
                  ["today", "Today"],
                  ["week", "7 Days"],
                  ["month", "This Month"],
                  ["fy", "This FY"],
                  ["all", "All Time"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all whitespace-nowrap ${
                      activePreset === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 sm:flex-none">
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setActivePreset("custom"); }}
                  max={toDate || undefined}
                  className="mt-1 w-full sm:w-auto h-8 px-2.5 rounded-lg border border-border bg-input/70 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
                />
              </div>
              <div className="flex-1 sm:flex-none">
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setActivePreset("custom"); }}
                  min={fromDate || undefined}
                  className="mt-1 w-full sm:w-auto h-8 px-2.5 rounded-lg border border-border bg-input/70 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
                />
              </div>
              {(fromDate || toDate) && (
                <button
                  onClick={() => { setFromDate(""); setToDate(""); setActivePreset("all"); }}
                  className="h-8 shrink-0 flex items-center gap-1 px-2.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>
        </div>

        {!bankId ? (
          <div className="glass rounded-xl ring-1 ring-border/60 py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <Wallet size={22} className="opacity-40" />
            <p className="text-sm">{loadingBanks ? "Loading bank accounts…" : "No bank account to show — select a company with a bank account, or add one in Bank Master."}</p>
          </div>
        ) : (
          <>
            {/* ── Hero: current balance + account card ─────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 glass rounded-2xl ring-1 ring-border/60 p-4 sm:p-5 flex flex-col justify-center relative overflow-hidden">
                <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/10 blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between relative">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">Current Balance</p>
                  <button
                    onClick={() => setShowBalance((v) => !v)}
                    title={showBalance ? "Hide balance" : "Show balance"}
                    className="p-1.5 rounded-full border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                  >
                    {showBalance ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                </div>
                <p className="text-3xl sm:text-4xl font-bold font-heading text-foreground mt-1 tabular-nums relative break-all">
                  {summaryQuery.isFetching && !summaryQuery.data ? (
                    <Loader2 size={26} className="animate-spin text-muted-foreground" />
                  ) : showBalance ? (
                    formatINR(summaryQuery.data?.currentBalance ?? 0)
                  ) : (
                    "•••••••"
                  )}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 relative">
                  {bank?.BName}{bank?.BBranch ? ` · ${bank.BBranch}` : ""}
                  {summaryQuery.data?.lastTransactionDate ? ` · Last activity ${fmtDate(summaryQuery.data.lastTransactionDate)}` : ""}
                </p>
              </div>

              {/* Account "card" */}
              <div className="rounded-2xl p-4 sm:p-5 relative overflow-hidden text-white flex flex-col justify-between min-h-[128px]"
                   style={{ background: "linear-gradient(135deg, #1e1b4b 0%, #4c1d95 55%, #6d28d9 100%)" }}>
                <div className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
                <div className="flex items-center justify-between relative">
                  <span className="text-[10px] uppercase tracking-widest text-white/60 font-heading">{bank?.BAccountType || "Bank Account"}</span>
                  <Landmark size={16} className="text-white/70" />
                </div>
                <div className="relative">
                  <p className="font-mono text-sm tracking-wider">{maskAccountNumber(bank?.BAccountNumber)}</p>
                  <p className="text-[10px] text-white/60 mt-1">{bank?.BIfscCode || "—"}</p>
                </div>
              </div>
            </div>

            {/* ── Stat tiles ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Opening Balance", value: formatINR(summaryQuery.data?.windowOpeningBalance ?? 0), icon: Wallet, color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/15", borderL: "border-l-primary" },
                { label: "Money In", value: formatINR(summaryQuery.data?.periodCredit ?? 0), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10", ring: "ring-emerald-500/15", borderL: "border-l-emerald-500" },
                { label: "Money Out", value: formatINR(summaryQuery.data?.periodDebit ?? 0), icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10", ring: "ring-rose-500/15", borderL: "border-l-rose-500" },
                { label: "Transactions", value: String(summaryQuery.data?.periodTxnCount ?? 0), icon: Receipt, color: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-500/15", borderL: "border-l-amber-500" },
              ].map(({ label, value, icon: Icon, color, bg, ring, borderL }) => (
                <div key={label} className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}>
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold font-heading text-foreground leading-none truncate">{value}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 font-heading uppercase tracking-wide">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Passbook ───────────────────────────────────────────────────── */}
            <div className="glass rounded-xl ring-1 ring-border/60 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-border/60">
                <p className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                  <Receipt size={12} /> Transactions
                  <span className="ml-1 text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal font-normal">
                    {transactions.length}
                  </span>
                </p>
                <ExportMenu
                  data={transactions as unknown as Record<string, unknown>[]}
                  columns={EXPORT_COLUMNS}
                  title={`Balance Enquiry — ${bank?.BName ?? ""}`}
                  filename="balance-enquiry"
                  disabled={passbookQuery.isFetching || !transactions.length || !rights.canExport}
                />
              </div>

              {passbookQuery.isFetching && !passbookQuery.data ? (
                <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                  <span className="text-sm">Loading passbook…</span>
                </div>
              ) : transactions.length === 0 ? (
                <div className="text-center py-14 text-sm text-muted-foreground">No transactions in this range.</div>
              ) : (
                <div className="divide-y divide-border/50 max-h-[560px] overflow-y-auto">
                  {transactions.map((t) => {
                    const meta = sourceMeta(t.SourceType);
                    const Icon = meta.icon;
                    const isCredit = Number(t.DebitAmount) > 0; // Dr = money in for a bank (asset)
                    const amount = isCredit ? Number(t.DebitAmount) : Number(t.CreditAmount);
                    const ref = docRefFor(t);
                    return (
                      <div key={t.EntryId} className="flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-3 hover:bg-muted/20 transition-colors">
                        <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 ${meta.bg} ${meta.color}`}>
                          <Icon size={15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">
                            {t.Narration || meta.label}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1 flex-wrap">
                            <span>{fmtDate(t.VoucherDate)}</span>
                            <span className="opacity-60">· {meta.label}</span>
                            {ref && <span className="opacity-60 font-mono">· {ref}</span>}
                            {t.CostCenterName && <span className="opacity-60">· {t.CostCenterName}</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-bold font-heading tabular-nums ${isCredit ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {isCredit ? "+" : "−"}{formatINR(amount)}
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                            Bal {formatINR(t.RunningBalance)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </FinanceShell>
    </>
  );
}
