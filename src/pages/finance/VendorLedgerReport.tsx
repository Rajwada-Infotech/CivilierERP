/**
 * VendorLedgerReport.tsx — Reports → Vendor Ledger Report
 *
 * Search any party or GL head by name — supplier, customer, contractor,
 * broker, loan counterparty, bank, whatever — and see every transaction ever
 * posted against it: invoices, payments, loans, journal vouchers, fund
 * transfers, GRNs. Same running-balance passbook pattern as Balance Enquiry,
 * just searched by name across every ledger head instead of picked from a
 * bank-only dropdown. See backend/routes/vendorLedger.js.
 *
 * Before a party is searched/selected, shows every transaction across every
 * party (newest first) instead of an empty placeholder — the "all" view then
 * narrows to one party's own passbook (with running balance and summary
 * tiles) once one is picked. `VendorLedgerReportBody` is the reusable core
 * (no page chrome), embedded directly into Reports.tsx's report catalog;
 * the default export below just wraps it for the standalone route.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import { toast } from "sonner";
import { formatINR } from "@/utils/formatCurrency";
import { format, parseISO } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import {
  searchLedgerHeads,
  getLedgerSummary,
  getLedgerTransactions,
  getAllLedgerTransactions,
  type LedgerHead,
  type LedgerEntry,
} from "@/api/vendorLedgerApi";
import {
  Users,
  Search,
  X,
  RefreshCw,
  ArrowLeftRight,
  FileText,
  Receipt,
  Loader2,
  Wallet,
  TrendingUp,
  TrendingDown,
  Building2,
  Landmark,
  CircleDollarSign,
} from "lucide-react";

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "dd MMM yyyy");
  } catch {
    return d;
  }
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return { from: toISODate(new Date(fyStartYear, 3, 1)), to };
  }
  return { from: "", to: "" };
}

// LHeadType codes used across this app's AccountHeadMaster.
const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  S: { label: "Supplier", icon: Building2, color: "text-orange-500" },
  C: { label: "Customer", icon: Users, color: "text-sky-500" },
  A: { label: "Customer", icon: Users, color: "text-sky-500" },
  BR: { label: "Broker", icon: Users, color: "text-violet-500" },
  B: { label: "Bank", icon: Landmark, color: "text-emerald-500" },
  LN: { label: "Loan", icon: CircleDollarSign, color: "text-amber-500" },
  GL: { label: "GL Account", icon: FileText, color: "text-muted-foreground" },
};
function typeMeta(type: string | null | undefined) {
  return TYPE_META[type || ""] || { label: type || "Account", icon: FileText, color: "text-muted-foreground" };
}

const SOURCE_META: Record<string, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  GRN: { label: "GRN", icon: Receipt, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  GRNPosting: { label: "GRN", icon: Receipt, color: "text-cyan-500", bg: "bg-cyan-500/10" },
  ExpenseBooking: { label: "Invoice", icon: FileText, color: "text-orange-500", bg: "bg-orange-500/10" },
  InvoicePosting: { label: "Invoice", icon: FileText, color: "text-orange-500", bg: "bg-orange-500/10" },
  NewPayment: { label: "Payment", icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10" },
  PaymentPosting: { label: "Payment", icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10" },
  BounceChargePosting: { label: "Bounce Charge", icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10" },
  ReceivedPayment: { label: "Received Payment", icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  CrmPaymentReceipt: { label: "CRM Payment Receipt", icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  CrmOnAccountPayment: { label: "CRM On A/C Payment", icon: TrendingUp, color: "text-teal-500", bg: "bg-teal-500/10" },
  CrmSalesDeed: { label: "CRM Sales Deed", icon: FileText, color: "text-sky-500", bg: "bg-sky-500/10" },
  FundTransfer: { label: "Fund Transfer", icon: ArrowLeftRight, color: "text-indigo-500", bg: "bg-indigo-500/10" },
  JournalVoucher: { label: "Journal Voucher", icon: FileText, color: "text-amber-500", bg: "bg-amber-500/10" },
  LoanPosting: { label: "Loan", icon: CircleDollarSign, color: "text-violet-500", bg: "bg-violet-500/10" },
  LoanRepayment: { label: "Loan Repayment", icon: CircleDollarSign, color: "text-violet-500", bg: "bg-violet-500/10" },
  DebitNoteAdjustment: { label: "Debit Note", icon: FileText, color: "text-red-500", bg: "bg-red-500/10" },
  QualityRejectionDebitNote: { label: "Debit Note", icon: FileText, color: "text-red-500", bg: "bg-red-500/10" },
  OnAccountAdjustment: { label: "On A/C Adjustment", icon: FileText, color: "text-teal-500", bg: "bg-teal-500/10" },
  // Standalone advance / excess payment sitting in the pooled Company On
  // Account A/c until applied — dbo.OnAccountLedger, not a GeneralLedgerEntry.
  OnAccountAdvance: { label: "Advance / On A/C", icon: TrendingUp, color: "text-teal-500", bg: "bg-teal-500/10" },
  OnAccountApplied: { label: "On A/C Applied to Invoice", icon: TrendingDown, color: "text-teal-500", bg: "bg-teal-500/10" },
};
function sourceMeta(sourceType: string) {
  return SOURCE_META[sourceType] || { label: sourceType, icon: Receipt, color: "text-muted-foreground", bg: "bg-muted" };
}

function docRefFor(t: LedgerEntry): string | null {
  return (
    t.ExpenseBookingDocNo ||
    t.LoanDocNo ||
    t.ReceivedPaymentDocNo ||
    t.NewPaymentDocNo ||
    t.JournalVoucherNo ||
    t.FundTransferDocNo ||
    t.VoucherNo ||
    null
  );
}

function exportColumns(showParty: boolean, showBalance: boolean): ExportColumn[] {
  const cols: ExportColumn[] = [
    { header: "Date", accessor: (r) => fmtDate(r.VoucherDate as string) },
  ];
  if (showParty) cols.push({ header: "Party", accessor: (r) => (r.PartyName as string) ?? "—" });
  cols.push(
    { header: "Voucher No", accessor: "VoucherNo" },
    { header: "Type", accessor: (r) => sourceMeta(r.SourceType as string).label },
    { header: "Reference", accessor: (r) => docRefFor(r as unknown as LedgerEntry) ?? "—" },
    { header: "Narration", accessor: "Narration" },
    { header: "Cost Centre", accessor: (r) => (r.CostCenterName as string) ?? "—" },
    { header: "Debit", accessor: (r) => (Number(r.DebitAmount) > 0 ? Number(r.DebitAmount).toFixed(2) : "") },
    { header: "Credit", accessor: (r) => (Number(r.CreditAmount) > 0 ? Number(r.CreditAmount).toFixed(2) : "") },
  );
  if (showBalance) cols.push({ header: "Balance", accessor: (r) => Number(r.RunningBalance).toFixed(2) });
  return cols;
}

// ── Reusable core — no page chrome, so Reports.tsx can embed it directly ──
export function VendorLedgerReportBody() {
  const rights = usePageRights("vendor-ledger");

  // ── Search ──
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedHead, setSelectedHead] = useState<LedgerHead | null>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setShowResults(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["vendor-ledger-search", debouncedQuery],
    queryFn: () => searchLedgerHeads(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  // ── Date range ──
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activePreset, setActivePreset] = useState<"today" | "week" | "month" | "fy" | "all" | "custom">("all");
  const applyPreset = (key: "today" | "week" | "month" | "fy" | "all") => {
    setActivePreset(key);
    const { from, to } = datePreset(key);
    setFromDate(from);
    setToDate(to);
  };

  const headId = selectedHead?.Id ?? null;

  // Party-scoped queries — only run once a specific head is picked.
  const summaryQuery = useQuery({
    queryKey: ["vendor-ledger-summary", headId, fromDate, toDate],
    queryFn: () => getLedgerSummary(headId as number, { from: fromDate || undefined, to: toDate || undefined }),
    enabled: !!headId,
  });
  const transactionsQuery = useQuery({
    queryKey: ["vendor-ledger-transactions", headId, fromDate, toDate],
    queryFn: () => getLedgerTransactions(headId as number, { from: fromDate || undefined, to: toDate || undefined, limit: 2000 }),
    enabled: !!headId,
  });

  // Unfiltered, all-parties view — the default before anything is picked.
  const allTransactionsQuery = useQuery({
    queryKey: ["vendor-ledger-all-transactions", fromDate, toDate],
    queryFn: () => getAllLedgerTransactions({ from: fromDate || undefined, to: toDate || undefined, limit: 1000 }),
    enabled: !headId,
  });

  // Export must pull every matching transaction, not just the 1000/2000-row
  // display cap (see the warning banner below) — re-requests with a much
  // higher limit instead of reusing the already-capped query data.
  const fetchAllTransactionsForExport = React.useCallback(async (): Promise<Record<string, unknown>[]> => {
    if (headId) {
      const res = await getLedgerTransactions(headId, { from: fromDate || undefined, to: toDate || undefined, limit: 100000 });
      return res.transactions as unknown as Record<string, unknown>[];
    }
    const res = await getAllLedgerTransactions({ from: fromDate || undefined, to: toDate || undefined, limit: 10000 });
    return res.transactions as unknown as Record<string, unknown>[];
  }, [headId, fromDate, toDate]);

  const showParty = !headId;
  const transactions: LedgerEntry[] = showParty
    ? allTransactionsQuery.data?.transactions ?? []
    : transactionsQuery.data?.transactions ?? [];
  const loading = showParty ? allTransactionsQuery.isFetching : summaryQuery.isFetching || transactionsQuery.isFetching;

  const refreshAll = () => {
    if (showParty) allTransactionsQuery.refetch();
    else {
      summaryQuery.refetch();
      transactionsQuery.refetch();
    }
  };

  useEffect(() => {
    if (summaryQuery.error) toast.error((summaryQuery.error as Error).message);
    if (transactionsQuery.error) toast.error((transactionsQuery.error as Error).message);
    if (allTransactionsQuery.error) toast.error((allTransactionsQuery.error as Error).message);
  }, [summaryQuery.error, transactionsQuery.error, allTransactionsQuery.error]);

  const meta = useMemo(() => typeMeta(selectedHead?.Type), [selectedHead]);
  const MetaIcon = meta.icon;

  return (
    <div className="space-y-4">
      {/* ── Search ──
          relative z-30: .glass uses backdrop-blur, which creates a new
          stacking context per card — without an explicit z-index here, this
          card and the Range card below it are sibling stacking contexts
          with no elevation, so DOM order alone decides paint order and the
          later Range card would render on top of this card's absolutely-
          positioned search-results dropdown regardless of the dropdown's
          own z-20. */}
      <div className="relative z-30 glass rounded-xl px-4 sm:px-5 py-4 ring-1 ring-border/60">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">
            Search Party / General Ledger
          </label>
          <button
            onClick={refreshAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border text-[10px] text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
          >
            <RefreshCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div ref={searchBoxRef} className="relative mt-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
            onFocus={() => setShowResults(true)}
            placeholder="Type a vendor, customer, contractor, broker, or GL account name…"
            className="w-full h-9 pl-8 pr-8 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
          />
          {(query || selectedHead) && (
            <button
              onClick={() => { setQuery(""); setShowResults(false); setSelectedHead(null); }}
              title="Clear — back to all transactions"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}

          {showResults && debouncedQuery.length >= 2 && (
            <div className="absolute z-20 mt-1 w-full max-h-80 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
              {searching ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
                  <Loader2 size={13} className="animate-spin" /> Searching…
                </div>
              ) : searchResults.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">No matching party or GL account found.</p>
              ) : (
                searchResults.map((h) => {
                  const m = typeMeta(h.Type);
                  const Icon = m.icon;
                  return (
                    <button
                      key={h.Id}
                      onClick={() => {
                        setSelectedHead(h);
                        setQuery(h.Name || "");
                        setShowResults(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors"
                    >
                      <Icon size={14} className={`shrink-0 ${m.color}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-foreground truncate">{h.Name}</span>
                        {h.CompanyName && <span className="block text-[10px] text-muted-foreground truncate">{h.CompanyName}</span>}
                      </span>
                      <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted ${m.color}`}>
                        {m.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Selected-party header (hidden in the all-parties view) ── */}
      {selectedHead && (
        <div className="glass rounded-xl px-4 sm:px-5 py-4 ring-1 ring-border/60 space-y-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0 ${meta.color}`}>
              <MetaIcon size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{selectedHead.Name}</p>
              <p className="text-[11px] text-muted-foreground">
                {meta.label}{selectedHead.CompanyName ? ` · ${selectedHead.CompanyName}` : ""}{selectedHead.Code ? ` · ${selectedHead.Code}` : ""}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Date range (applies to both views) ── */}
      <div className="glass rounded-xl px-4 sm:px-5 py-4 ring-1 ring-border/60">
        <div className="flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">Range</label>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
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
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[140px] lg:flex-none">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => { setFromDate(e.target.value); setActivePreset("custom"); }}
                max={toDate || undefined}
                className="mt-1 w-full lg:w-auto h-8 px-2.5 rounded-lg border border-border bg-input/70 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
            <div className="flex-1 min-w-[140px] lg:flex-none">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground font-heading">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => { setToDate(e.target.value); setActivePreset("custom"); }}
                min={fromDate || undefined}
                className="mt-1 w-full lg:w-auto h-8 px-2.5 rounded-lg border border-border bg-input/70 text-xs focus:ring-1 focus:ring-primary focus:border-primary outline-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert"
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

      {/* ── Stat tiles — party view only ── */}
      {selectedHead && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Opening Balance", value: formatINR(summaryQuery.data?.windowOpeningBalance ?? 0), icon: Wallet, color: "text-primary", bg: "bg-primary/10", ring: "ring-primary/15", borderL: "border-l-primary" },
            { label: "Total Debit", value: formatINR(summaryQuery.data?.periodDebit ?? 0), icon: TrendingUp, color: "text-emerald-500", bg: "bg-emerald-500/10", ring: "ring-emerald-500/15", borderL: "border-l-emerald-500" },
            { label: "Total Credit", value: formatINR(summaryQuery.data?.periodCredit ?? 0), icon: TrendingDown, color: "text-rose-500", bg: "bg-rose-500/10", ring: "ring-rose-500/15", borderL: "border-l-rose-500" },
            { label: "Closing Balance", value: formatINR(summaryQuery.data?.currentBalance ?? 0), icon: CircleDollarSign, color: "text-amber-500", bg: "bg-amber-500/10", ring: "ring-amber-500/15", borderL: "border-l-amber-500" },
          ].map(({ label, value, icon: Icon, color, bg, ring, borderL }) => (
            <div key={label} className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}>
              <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                <Icon size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold font-heading text-foreground leading-none truncate">
                  {summaryQuery.isFetching && !summaryQuery.data ? <Loader2 size={14} className="animate-spin" /> : value}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1 font-heading uppercase tracking-wide">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Ledger ── */}
      <div className="glass rounded-xl ring-1 ring-border/60 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-border/60">
          <p className="text-xs font-heading font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Receipt size={12} /> {selectedHead ? "Transactions" : "All Transactions"}
            <span className="ml-1 text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full normal-case tracking-normal font-normal">
              {transactions.length}
            </span>
          </p>
          <ExportMenu
            data={transactions as unknown as Record<string, unknown>[]}
            fetchData={fetchAllTransactionsForExport}
            columns={exportColumns(showParty, !showParty)}
            title={selectedHead ? `Vendor Ledger — ${selectedHead.Name ?? ""}` : "Vendor Ledger — All Transactions"}
            filename="vendor-ledger-report"
            disabled={loading || !transactions.length || !rights.canExport}
          />
        </div>

        {loading && transactions.length === 0 ? (
          <div className="flex items-center justify-center py-14 gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Loading ledger…</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-14 text-sm text-muted-foreground">No transactions in this range.</div>
        ) : (
          <>
            {transactions.length >= (showParty ? 1000 : 2000) && (
              <div className="px-5 py-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border-b border-amber-500/20">
                Showing the most recent {transactions.length.toLocaleString("en-IN")} transactions — apply a date filter to narrow results.
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[760px]">
                <thead>
                  <tr className="border-b border-border/60 text-muted-foreground uppercase tracking-wide text-[10px] font-heading">
                    <th className="text-left px-4 sm:px-5 py-2.5">Date</th>
                    {showParty && <th className="text-left px-3 py-2.5">Party</th>}
                    <th className="text-left px-3 py-2.5">Type</th>
                    <th className="text-left px-3 py-2.5">Reference</th>
                    <th className="text-left px-3 py-2.5">Narration</th>
                    <th className="text-right px-3 py-2.5">Debit</th>
                    <th className="text-right px-3 py-2.5">Credit</th>
                    {!showParty && <th className="text-right px-4 sm:px-5 py-2.5">Balance</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {transactions.map((t) => {
                    const m = sourceMeta(t.SourceType);
                    const Icon = m.icon;
                    const ref = docRefFor(t);
                    const partyMeta = showParty ? typeMeta(t.PartyType) : null;
                    return (
                      <tr key={t.EntryId} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 sm:px-5 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(t.VoucherDate)}</td>
                        {showParty && (
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button
                              onClick={() => t.LHeadId && setSelectedHead({ Id: t.LHeadId, Name: t.PartyName ?? null, Type: t.PartyType ?? null, Code: null, CompanyName: null })}
                              className={`hover:underline ${partyMeta?.color ?? "text-foreground"}`}
                              title="View this party's own ledger"
                            >
                              {t.PartyName ?? "—"}
                            </button>
                          </td>
                        )}
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${m.bg} ${m.color}`}>
                            <Icon size={11} /> {m.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-muted-foreground">{ref ?? "—"}</td>
                        <td className="px-3 py-2.5 text-foreground max-w-[280px] truncate" title={t.Narration ?? ""}>
                          {t.Narration || "—"}
                          {t.CostCenterName && <span className="text-muted-foreground"> · {t.CostCenterName}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {Number(t.DebitAmount) > 0 ? formatINR(Number(t.DebitAmount)) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-rose-600 dark:text-rose-400">
                          {Number(t.CreditAmount) > 0 ? formatINR(Number(t.CreditAmount)) : "—"}
                        </td>
                        {!showParty && (
                          <td className="px-4 sm:px-5 py-2.5 text-right tabular-nums font-semibold text-foreground">
                            {formatINR(Number(t.RunningBalance ?? 0))}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Standalone page wrapper (kept for direct linking; the primary entry
//    point is now Reports.tsx's catalog, via VendorLedgerReportBody). ──
export default function VendorLedgerReport() {
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Reports", "Vendor Ledger Report"]} />
      <FinanceShell
        title="Vendor Ledger Report"
        subtitle="Every transaction posted against a supplier, customer, contractor, broker or any GL head"
        icon={Users}
      >
        <VendorLedgerReportBody />
      </FinanceShell>
    </>
  );
}
