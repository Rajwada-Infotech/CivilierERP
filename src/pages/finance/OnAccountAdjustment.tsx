import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw, Wallet, Loader2 } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  PaidAmount: number | null;
  InvoiceAmount: number | null;
  InvoiceDocNo: string | null;
  AvailableBalance: number;
  Notes: string | null;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function PartyTypePill({ code }: { code: string }) {
  const label = code === "S" ? "Supplier" : code === "C" ? "Contractor" : code;
  const cls =
    code === "S"
      ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
      : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}
    >
      {label}
    </span>
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

  const partyIdParam = selectedPartyId !== "all" ? `?partyId=${selectedPartyId}` : "";
  const {
    data: credits = [],
    isLoading: creditsLoading,
    refetch,
  } = useQuery<CreditEntry[]>({
    queryKey: ["oa-adjustable", selectedPartyId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/on-account/adjustable${partyIdParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });

  const isLoading = partiesLoading || creditsLoading;

  const balanceMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of parties) m.set(p.PartyId, p.Balance);
    return m;
  }, [parties]);

  const selectedParty = parties.find((p) => String(p.PartyId) === selectedPartyId);

  function handleAdjust(entry: CreditEntry) {
    navigate("/payments", {
      state: {
        oaAdjust: {
          partyId: entry.PartyId,
          partyName: entry.PartyName,
          partyTypeCode: entry.PartyTypeCode,
          availableBalance: balanceMap.get(entry.PartyId) ?? entry.AvailableBalance,
          sourceDocNo: entry.PaymentDocNo,
        },
      },
    });
  }

  return (
    <FinanceShell title="On A/C Adjustment" subtitle="Excess payments available for adjustment against future invoices">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <Wallet size={20} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold">On A/C Adjustment</h1>
              <p className="text-xs text-muted-foreground">
                View excess payments available for adjustment against future invoices
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </Button>
        </div>

        {/* Filter row */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Filter by party:</span>
          <Select value={selectedPartyId} onValueChange={setSelectedPartyId}>
            <SelectTrigger className="w-72">
              <SelectValue placeholder="All parties with balance" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All parties with balance</SelectItem>
              {parties.map((p) => (
                <SelectItem key={p.PartyId} value={String(p.PartyId)}>
                  {p.PartyName} — {formatINR(p.Balance)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedParty && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-1.5">
              <span className="text-xs text-muted-foreground">Available balance:</span>
              <span className="font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400">
                {formatINR(selectedParty.Balance)}
              </span>
            </div>
          )}
        </div>

        {/* Party summary pills (no filter active) */}
        {selectedPartyId === "all" && parties.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {parties.map((p) => (
              <button
                key={p.PartyId}
                onClick={() => setSelectedPartyId(String(p.PartyId))}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
              >
                <div>
                  <p className="text-xs font-medium">{p.PartyName}</p>
                  <p className="text-[10px] text-muted-foreground">{p.PartyType}</p>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  {formatINR(p.Balance)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Loading…
              </div>
            ) : credits.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Wallet size={32} className="opacity-20" />
                <p>No On Account balances available for adjustment</p>
                {selectedPartyId !== "all" && (
                  <button
                    className="text-xs underline"
                    onClick={() => setSelectedPartyId("all")}
                  >
                    Show all parties
                  </button>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {[
                      "Party",
                      "Payment Voucher",
                      "Payment Date",
                      "Invoice Ref",
                      "Invoice Amt",
                      "Paid Amt",
                      "On A/C Amt",
                      "Party Balance",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {credits.map((entry) => (
                    <tr key={entry.OAId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-xs">{entry.PartyName}</span>
                          <PartyTypePill code={entry.PartyTypeCode} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-blue-600 dark:text-blue-400">
                          {entry.PaymentDocNo || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmtDate(entry.PaymentDate)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {entry.InvoiceDocNo || entry.InvoiceRef || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums text-right">
                        {entry.InvoiceAmount != null ? formatINR(entry.InvoiceAmount) : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-right">
                        {entry.PaidAmount != null ? formatINR(entry.PaidAmount) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                          {formatINR(entry.ExcessAmount)}
                        </span>
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
                          className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
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
            )}
          </div>
        </div>
      </div>
    </FinanceShell>
  );
}
