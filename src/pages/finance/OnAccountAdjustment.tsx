import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Wallet, Loader2, TrendingUp, Users } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import { FinanceShell } from "@/components/finance/FinanceShell";

interface PartySummary {
  PartyId: number;
  PartyName: string;
  PartyType: string;
  Balance: number;
}

interface CreditEntry {
  OAId: number;
  PartyId: number;
  PartyName: string;
  PartyTypeCode: string;
  PaymentDate: string;
  PaymentDocNo: string;
  ExcessAmount: number;
  InvoiceRef: string | null;
  PaymentAmount: number | null;
  InvoiceAmount: number | null;
  InvoiceTotalPaid: number | null;
  InvoiceDocNo: string | null;
  AvailableBalance: number;
  Notes: string | null;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function PartyTypePill({ code }: { code: string }) {
  const label = code === "S" ? "Supplier" : code === "C" ? "Contractor" : code;
  const cls = code === "S"
    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
    : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

// Small horizontal bar chart for party balance distribution
function BalanceBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function OnAccountAdjustment() {
  const navigate = useNavigate();
  const [selectedPartyId, setSelectedPartyId] = useState<string>("all");

  const { data: parties = [], isLoading: partiesLoading } = useQuery<PartySummary[]>({
    queryKey: ["oa-party-summary"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/on-account/party-summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const {
    data: credits = [],
    isLoading: creditsLoading,
    refetch,
  } = useQuery<CreditEntry[]>({
    queryKey: ["oa-adjustable", selectedPartyId],
    queryFn: async () => {
      const url = selectedPartyId !== "all"
        ? `/api/on-account/adjustable?partyId=${selectedPartyId}`
        : "/api/on-account/adjustable";
      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  // Client-side guard: ensure rows match the selected party even if backend returns extras
  const filteredCredits = selectedPartyId === "all"
    ? credits
    : credits.filter((c) => String(c.PartyId) === selectedPartyId);

  const isLoading = partiesLoading || creditsLoading;

  const balanceMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of parties) m.set(p.PartyId, p.Balance);
    return m;
  }, [parties]);

  const totalBalance = useMemo(() => parties.reduce((s, p) => s + p.Balance, 0), [parties]);
  const maxBalance = useMemo(() => Math.max(...parties.map((p) => p.Balance), 0), [parties]);
  const selectedParty = parties.find((p) => String(p.PartyId) === selectedPartyId);

  function handleAdjust(entry: CreditEntry) {
    const partyBalance = balanceMap.get(entry.PartyId) ?? entry.AvailableBalance;
    const totalPaid = entry.InvoiceTotalPaid ?? entry.PaymentAmount;
    const invoiceRemaining = entry.InvoiceAmount != null && totalPaid != null
      ? Math.max(0, entry.InvoiceAmount - totalPaid)
      : null;
    navigate("/payments", {
      state: {
        oaAdjust: {
          partyId: entry.PartyId,
          partyName: entry.PartyName,
          partyTypeCode: entry.PartyTypeCode,
          availableBalance: partyBalance,
          sourceDocNo: entry.PaymentDocNo,
          invoiceDocNo: entry.InvoiceDocNo || entry.InvoiceRef || null,
          invoiceRemaining,
        },
      },
    });
  }

  const displayParties = selectedPartyId === "all" ? parties : parties.filter((p) => String(p.PartyId) === selectedPartyId);

  return (
    <FinanceShell title="On A/C Adjustment" subtitle="Excess payments available for adjustment against future invoices">
      <div className="space-y-6">

        {/* ── Top stat cards + party panel ──────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Left: big stat cards */}
          <div className="flex flex-col gap-4">
            {/* Total Balance card */}
            <div className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-500/70">Total On A/C Balance</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15">
                  <Wallet size={16} className="text-emerald-600 dark:text-emerald-500" />
                </div>
              </div>
              <div className="mt-1">
                {partiesLoading ? (
                  <div className="h-10 w-40 rounded bg-muted/40 animate-pulse" />
                ) : (
                  <span className="text-4xl font-black tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                    {formatINR(totalBalance)}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Across {parties.length} {parties.length === 1 ? "party" : "parties"}
              </p>
            </div>

            {/* Party count card */}
            <div className="rounded-2xl border border-border bg-card p-6 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Parties with Balance</span>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                  <Users size={16} className="text-blue-500" />
                </div>
              </div>
              <span className="text-3xl font-black tabular-nums text-foreground">
                {partiesLoading ? "—" : parties.length}
              </span>
              <div className="flex gap-3 mt-1">
                <span className="text-xs text-muted-foreground">
                  {parties.filter((p) => p.PartyType === "Supplier" || p.PartyType === "S").length} Suppliers
                </span>
                <span className="text-xs text-muted-foreground">
                  {parties.filter((p) => p.PartyType === "Contractor" || p.PartyType === "C").length} Contractors
                </span>
              </div>
            </div>

            {/* Refresh */}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading} className="w-fit gap-1.5">
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </Button>
          </div>

          {/* Right: party breakdown panel */}
          <div className="sm:col-span-2 lg:col-span-2 rounded-2xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <TrendingUp size={15} className="text-emerald-500" />
                <span className="text-sm font-semibold">Party Balances</span>
              </div>
              {selectedPartyId !== "all" && (
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => setSelectedPartyId("all")}
                >
                  Show all
                </button>
              )}
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {partiesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="h-4 w-32 rounded bg-muted/50 animate-pulse" />
                    <div className="flex-1 h-1.5 rounded bg-muted/50 animate-pulse" />
                    <div className="h-4 w-20 rounded bg-muted/50 animate-pulse" />
                  </div>
                ))
              ) : parties.length === 0 ? (
                <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                  No On A/C balances found
                </div>
              ) : (
                displayParties.map((p) => (
                  <button
                    key={p.PartyId}
                    onClick={() => setSelectedPartyId(selectedPartyId === String(p.PartyId) ? "all" : String(p.PartyId))}
                    className={`w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/30 transition-colors ${
                      selectedPartyId === String(p.PartyId) ? "bg-emerald-500/5 border-l-2 border-emerald-500" : ""
                    }`}
                  >
                    <div className="min-w-0 w-36">
                      <p className="text-xs font-medium truncate">{p.PartyName}</p>
                      <p className="text-[10px] text-muted-foreground">{p.PartyType}</p>
                    </div>
                    <BalanceBar value={p.Balance} max={maxBalance} />
                    <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {formatINR(p.Balance)}
                    </span>
                  </button>
                ))
              )}
            </div>
            {selectedParty && (
              <div className="px-5 py-3 border-t border-border bg-emerald-500/5 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Filtered to:</span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{selectedParty.PartyName}</span>
                <span className="font-mono text-xs font-bold text-emerald-500 ml-auto">{formatINR(selectedParty.Balance)}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Credits table ──────────────────────────────────────── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <p className="text-sm font-semibold">On A/C Credit Entries</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedPartyId === "all" ? "All parties" : `Filtered to ${selectedParty?.PartyName ?? ""}`}
                {filteredCredits.length > 0 && ` · ${filteredCredits.length} entr${filteredCredits.length === 1 ? "y" : "ies"}`}
              </p>
            </div>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Loading…
            </div>
          ) : filteredCredits.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Wallet size={32} className="opacity-20" />
              <p>No On Account balances available for adjustment</p>
              {selectedPartyId !== "all" && (
                <button className="text-xs underline" onClick={() => setSelectedPartyId("all")}>
                  Show all parties
                </button>
              )}
            </div>
          ) : (
            <>
              {/* ── Mobile cards (< md) ───────────────────────────────── */}
              <div className="md:hidden divide-y divide-border">
                {filteredCredits.map((entry) => (
                  <div key={entry.OAId} className="px-4 py-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{entry.PartyName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <PartyTypePill code={entry.PartyTypeCode} />
                          <span className="font-mono text-[10px] text-blue-600 dark:text-blue-400">{entry.PaymentDocNo || "—"}</span>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 h-7 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                        onClick={() => handleAdjust(entry)}
                      >
                        Adjust <ArrowRight size={11} />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Date</p>
                        <p>{fmtDate(entry.PaymentDate)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Invoice Ref</p>
                        <p className="font-mono text-muted-foreground truncate">{entry.InvoiceDocNo || entry.InvoiceRef || "—"}</p>
                      </div>
                    </div>
                    {/* Net Payable / Total Paid breakdown */}
                    {entry.InvoiceAmount != null && (
                      <div className="rounded-xl border border-border overflow-hidden text-xs">
                        <div className="flex items-center justify-between px-3 py-2 bg-muted/10">
                          <p className="text-muted-foreground">Net Payable</p>
                          <p className="font-mono font-semibold tabular-nums">{formatINR(entry.InvoiceAmount)}</p>
                        </div>
                        {(entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null && (
                          <div className="flex items-center justify-between px-3 py-2 border-t border-border/60">
                            <p className="text-emerald-600 dark:text-emerald-400">Total Paid</p>
                            <p className="font-mono font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                              {formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0)}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">On A/C Amt</p>
                        <p className="font-mono text-sm font-bold text-amber-600 dark:text-amber-400">{formatINR(entry.ExcessAmount)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Party Balance</p>
                        <p className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {formatINR(balanceMap.get(entry.PartyId) ?? entry.AvailableBalance)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Desktop table (md+) ──────────────────────────────── */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      {["Party", "Payment Voucher", "Date", "Invoice Ref", "Net Payable", "Total Paid", "On A/C Amt", "Party Balance", ""].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredCredits.map((entry) => (
                      <tr key={entry.OAId} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-xs">{entry.PartyName}</span>
                            <PartyTypePill code={entry.PartyTypeCode} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-blue-600 dark:text-blue-400">{entry.PaymentDocNo || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {fmtDate(entry.PaymentDate)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-muted-foreground">{entry.InvoiceDocNo || entry.InvoiceRef || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums text-right">
                          {entry.InvoiceAmount != null ? formatINR(entry.InvoiceAmount) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums text-right text-emerald-600 dark:text-emerald-400 font-medium">
                          {(entry.InvoiceTotalPaid ?? entry.PaymentAmount) != null
                            ? formatINR(entry.InvoiceTotalPaid ?? entry.PaymentAmount ?? 0)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">{formatINR(entry.ExcessAmount)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {formatINR(balanceMap.get(entry.PartyId) ?? entry.AvailableBalance)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleAdjust(entry)}
                          >
                            Adjust
                            <ArrowRight size={12} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </FinanceShell>
  );
}
