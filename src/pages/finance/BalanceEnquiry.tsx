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
import { SheetShell } from "@/components/sheet/Sheet";
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
import { X, RefreshCw, ChevronDown, Loader2, Eye, EyeOff } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

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

const SOURCE_LABEL: Record<string, string> = {
  NewPayment: "Payment",
  PaymentPosting: "Payment",
  BounceChargePosting: "Bounce Charge",
  ReceivedPayment: "Received Payment",
  FundTransfer: "Fund Transfer",
  JournalVoucher: "Journal Voucher",
};

function sourceMeta(sourceType: string) {
  return { label: SOURCE_LABEL[sourceType] || sourceType };
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

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const selectCls =
  "w-full h-9 pl-2.5 pr-7 bg-card border border-foreground/40 text-xs text-foreground focus:border-foreground outline-none appearance-none disabled:opacity-50";
const dateCls = "mt-1 w-full lg:w-auto h-9 px-2.5 border border-foreground/40 bg-card text-xs text-foreground focus:border-foreground outline-none";
const RULE = "1px solid hsl(var(--foreground))";

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
    staleTime: 5 * 60 * 1000,
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
    queryFn: () => getPassbook(bankId as number, { from: fromDate || undefined, to: toDate || undefined, limit: 2000 }),
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

  const sum = summaryQuery.data;
  const balance = sum?.currentBalance ?? 0;
  const overdrawn = balance < -0.005;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Balance Enquiry"]} />
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Balance enquiry"
        subtitle="A bank account's passbook: every payment, receipt, transfer and voucher, with the balance after each."
        action={
          <button
            onClick={refreshAll}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> <span className="hidden sm:inline">Refresh</span>
          </button>
        }
      >
        {/* ── Company / Bank selectors ─────────────────────────────────────── */}
        <div className="bg-card px-4 py-4 space-y-4" style={{ border: RULE }}>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 min-w-0">
              <label className={LBL}>Company</label>
              <div className="relative mt-1">
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={selectCls}>
                  <option value="">All Companies</option>
                  {companies.map((c) => (
                    <option key={c.id} value={String(c.id)}>{c.label}</option>
                  ))}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="flex-1 sm:flex-[2] min-w-0">
              <label className={LBL}>Bank account</label>
              <div className="relative mt-1">
                <select
                  value={bankId ?? ""}
                  onChange={(e) => setBankId(e.target.value ? Number(e.target.value) : null)}
                  disabled={loadingBanks || banks.length === 0}
                  className={`${selectCls} font-semibold`}
                  style={{ borderColor: "hsl(var(--foreground))" }}
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

          {/* Range keys + custom From/To */}
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="flex-1 min-w-0">
              <label className={LBL}>Range</label>
              <div className="mt-1">
                <div className="seg flex-wrap">
                  {([
                    ["today", "Today"],
                    ["week", "7 days"],
                    ["month", "This month"],
                    ["fy", "This year"],
                    ["all", "All time"],
                  ] as const).map(([key, label]) => (
                    <button key={key} onClick={() => applyPreset(key)} aria-pressed={activePreset === key} className={activePreset === key ? "on" : undefined}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px] lg:flex-none">
                <label className={LBL}>From</label>
                <DateInput
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setActivePreset("custom"); }}
                  max={toDate || undefined}
                  className={dateCls}
                />
              </div>
              <div className="flex-1 min-w-[140px] lg:flex-none">
                <label className={LBL}>To</label>
                <DateInput
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setActivePreset("custom"); }}
                  min={fromDate || undefined}
                  className={dateCls}
                />
              </div>
              {(fromDate || toDate) && (
                <button
                  onClick={() => { setFromDate(""); setToDate(""); setActivePreset("all"); }}
                  title="Clear dates"
                  aria-label="Clear dates"
                  className="h-9 w-9 shrink-0 flex items-center justify-center border border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {!bankId ? (
          <div className="bg-card py-16 px-4 text-center text-sm text-muted-foreground" style={{ border: RULE }}>
            {loadingBanks ? "Loading bank accounts…" : "No bank account to show. Select a company with a bank account, or add one in Bank Master."}
          </div>
        ) : (
          <>
            {/* ── The balance, the account it belongs to, and the period's movement ── */}
            <div className="bg-card" style={{ border: RULE }}>
              <div className="flex flex-col md:flex-row">
                <div className="flex-1 min-w-0 px-4 py-5">
                  <div className="flex items-center gap-2">
                    <p className="label" style={overdrawn ? { color: "var(--red)" } : undefined}>{overdrawn ? "Current balance · overdrawn" : "Current balance"}</p>
                    <button
                      onClick={() => setShowBalance((v) => !v)}
                      title={showBalance ? "Hide balance" : "Show balance"}
                      aria-label={showBalance ? "Hide balance" : "Show balance"}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showBalance ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                  </div>
                  <p className="figure break-all" style={{ fontSize: "clamp(28px, 4vw, 44px)", marginTop: 8, color: overdrawn && showBalance ? "var(--red)" : undefined }}>
                    {summaryQuery.isFetching && !sum ? (
                      <Loader2 size={26} className="animate-spin text-muted-foreground" />
                    ) : showBalance ? (
                      formatINR(balance)
                    ) : (
                      "•••••••"
                    )}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--graphite)", marginTop: 8 }}>
                    {sum?.lastTransactionDate ? `Last activity ${fmtDate(sum.lastTransactionDate)}` : "No activity yet"}
                  </p>
                </div>

                {/* Account particulars */}
                <div className="md:w-[300px] shrink-0 px-4 py-5 border-t md:border-t-0 md:border-l border-foreground space-y-3">
                  {[
                    { l: bank?.BAccountType || "Bank account", v: [bank?.BName, bank?.BBranch].filter(Boolean).join(" · ") || "—", fig: false },
                    { l: "Account number", v: maskAccountNumber(bank?.BAccountNumber), fig: true },
                    { l: "IFSC", v: bank?.BIfscCode || "—", fig: true },
                  ].map((x) => (
                    <div key={x.l} className="min-w-0">
                      <p className={LBL}>{x.l}</p>
                      <p className={`mt-1 text-[0.8125rem] text-foreground break-words ${x.fig ? "font-heading font-semibold tabular-nums tracking-wide" : "font-medium"}`}>{x.v}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="statrow four" style={{ padding: "16px 16px 18px", borderTop: RULE }}>
                {[
                  { label: "Opening balance", value: formatINR(sum?.windowOpeningBalance ?? 0), note: "at the start of the range" },
                  // Bank is an asset account (see backend/routes/balanceEnquiry.js) —
                  // a Debit increases it (money in), a Credit decreases it (money out).
                  { label: "Money in", value: formatINR(sum?.periodDebit ?? 0), note: "receipts and transfers in" },
                  { label: "Money out", value: formatINR(sum?.periodCredit ?? 0), note: "payments and transfers out" },
                  { label: "Transactions", value: String(sum?.periodTxnCount ?? 0), note: "in the range" },
                ].map((x) => (
                  <div key={x.label}>
                    <p className="label">{x.label}</p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Passbook ───────────────────────────────────────────────────── */}
            <div className="bg-card overflow-hidden" style={{ border: RULE }}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: RULE }}>
                <p className="flex items-baseline gap-2.5">
                  <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Passbook</span>
                  <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{transactions.length} entries</span>
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
                <>
                {transactions.length >= 2000 && (
                  <div className="px-4 py-2 text-xs text-foreground" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                    Showing the first 2,000 transactions. Narrow the date range to see the rest.
                  </div>
                )}

                {/* Phone: one entry per line */}
                <div className="md:hidden divide-y divide-border/60 max-h-[560px] overflow-y-auto">
                  {transactions.map((t) => {
                    const meta = sourceMeta(t.SourceType);
                    const isDebit = Number(t.DebitAmount) > 0; // Dr = money in for a bank (asset)
                    const amount = isDebit ? Number(t.DebitAmount) : Number(t.CreditAmount);
                    const ref = docRefFor(t);
                    return (
                      <div key={t.EntryId} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate">{t.Narration || meta.label}</p>
                          <p className="text-[0.625rem] text-muted-foreground mt-1 tabular-nums">
                            {fmtDate(t.VoucherDate)} · {meta.label}{ref ? ` · ${ref}` : ""}{t.CostCenterName ? ` · ${t.CostCenterName}` : ""}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-heading text-sm font-semibold tabular-nums text-foreground">
                            {isDebit ? "+" : "−"}{formatINR(amount)}
                          </p>
                          <p className={`font-heading text-[0.625rem] mt-0.5 tabular-nums ${Number(t.RunningBalance) < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                            Bal {formatINR(t.RunningBalance)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Wider screens: ruled the way a passbook is */}
                <div className="hidden md:block max-h-[620px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr>
                        <th className="px-4 py-2.5 text-left w-[104px]">Date</th>
                        <th className="px-3 py-2.5 text-left">Particulars</th>
                        <th className="px-3 py-2.5 text-left w-[150px]">Reference</th>
                        <th className="px-3 py-2.5 text-right w-[130px] border-l border-border/60">Money in</th>
                        <th className="px-3 py-2.5 text-right w-[130px]">Money out</th>
                        <th className="px-4 py-2.5 text-right w-[140px] border-l border-border/60">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((t) => {
                        const meta = sourceMeta(t.SourceType);
                        const debit = Number(t.DebitAmount);
                        const credit = Number(t.CreditAmount);
                        const ref = docRefFor(t);
                        return (
                          <tr key={t.EntryId} className="align-top">
                            <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{fmtDate(t.VoucherDate)}</td>
                            <td className="px-3 py-2.5 min-w-0">
                              <p className="text-foreground font-medium leading-snug">{t.Narration || meta.label}</p>
                              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground mt-1">
                                {meta.label}{t.CostCenterName ? ` · ${t.CostCenterName}` : ""}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 font-heading text-[0.6875rem] font-semibold tabular-nums text-foreground break-all">{ref || "—"}</td>
                            <td className="px-3 py-2.5 text-right font-heading tabular-nums text-foreground border-l border-border/60">{debit > 0 ? formatINR(debit) : ""}</td>
                            <td className="px-3 py-2.5 text-right font-heading tabular-nums text-foreground">{credit > 0 ? formatINR(credit) : ""}</td>
                            <td className={`px-4 py-2.5 text-right font-heading font-semibold tabular-nums border-l border-border/60 ${Number(t.RunningBalance) < 0 ? "text-destructive" : "text-foreground"}`}>
                              {formatINR(t.RunningBalance)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetShell>
    </>
  );
}
