import { useState, useCallback, useEffect } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { formatINR } from "@/utils/formatCurrency";
import {
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { getOAReport, getOAPartySummary } from "@/api/onAccountApi";
import type { OAReportRow, OAPartySummary } from "@/api/onAccountApi";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PARTY_LABEL: Record<string, string> = { S: "Supplier", C: "Contractor", A: "Customer" };
const partyTypeColor: Record<string, string> = {
  Supplier: "bg-violet-500/10 text-violet-600",
  Contractor: "bg-blue-500/10 text-blue-600",
  Customer: "bg-emerald-500/10 text-emerald-600",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnAccountReport() {
  usePageRights("on-account-report");

  const [tab, setTab] = useState<"transactions" | "summary">("transactions");

  // filters
  const [partyType, setPartyType] = useState("");
  const [partyName, setPartyName] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [txnType, setTxnType] = useState("");

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [rows, setRows] = useState<OAReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summaryRows, setSummaryRows] = useState<OAPartySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadTransactions = useCallback(async (p = 1) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await getOAReport({
        partyType: partyType || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page: p,
        pageSize: PAGE_SIZE,
      });
      setRows(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [partyType, dateFrom, dateTo]);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await getOAPartySummary();
      setSummaryRows(data);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    if (tab === "transactions") loadTransactions(1);
    else loadSummary();
  };

  // initial load
  useEffect(() => { loadTransactions(1); }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // filter rows by partyName client-side (name filter isn't exposed in backend yet)
  const filtered = rows.filter((r) =>
    !partyName || r.PartyName?.toLowerCase().includes(partyName.toLowerCase())
  ).filter((r) =>
    !txnType || r.TxnType === txnType
  );

  return (
    <>
    <Breadcrumbs items={["Dashboard", "Finance", "On Account Report"]} />
    <FinanceShell title="On Account Report" subtitle="Excess payment credits stored on account per party">
      <div className="p-4 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div />
          <button
            onClick={handleSearch}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border">
          {(["transactions", "summary"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === "summary") loadSummary();
                else loadTransactions(1);
              }}
              className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "transactions" ? "Transactions" : "Party Summary"}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <select
            value={partyType}
            onChange={(e) => setPartyType(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card text-sm px-2 text-foreground"
          >
            <option value="">All Party Types</option>
            <option value="S">Supplier</option>
            <option value="C">Contractor</option>
            <option value="A">Customer</option>
          </select>
          <input
            type="text"
            placeholder="Party name..."
            value={partyName}
            onChange={(e) => setPartyName(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card text-sm px-2.5 text-foreground w-44"
          />
          {tab === "transactions" && (
            <select
              value={txnType}
              onChange={(e) => setTxnType(e.target.value)}
              className="h-8 rounded-lg border border-border bg-card text-sm px-2 text-foreground"
            >
              <option value="">All Types</option>
              <option value="CREDIT">Credit (Stored)</option>
              <option value="DEBIT">Debit (Adjusted)</option>
            </select>
          )}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card text-sm px-2 text-foreground"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card text-sm px-2 text-foreground"
          />
          <button
            onClick={handleSearch}
            className="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-border bg-card text-sm hover:bg-accent"
          >
            <Search className="w-3.5 h-3.5" />
            Search
          </button>
        </div>

        {err && (
          <div className="text-sm text-red-500 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {/* Transactions Tab */}
        {!loading && tab === "transactions" && (
          <>
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Date</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Party</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Type</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Ref Doc</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Credit</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Debit</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Balance</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-muted-foreground text-sm">
                        No records found
                      </td>
                    </tr>
                  ) : filtered.map((r) => (
                    <tr key={r.OAId} className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                        {r.TxnDate?.slice(0, 10) ?? "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-foreground text-[13px]">{r.PartyName ?? "—"}</div>
                        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5 ${partyTypeColor[PARTY_LABEL[r.PartyType] ?? r.PartyType] ?? ""}`}>
                          {PARTY_LABEL[r.PartyType] ?? r.PartyType}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.TxnType === "CREDIT" ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">
                            <TrendingUp className="w-3 h-3" /> Stored
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                            <TrendingDown className="w-3 h-3" /> Adjusted
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs text-foreground font-mono">{r.RefDocNo ?? "—"}</div>
                        {r.AdjRefDocNo && (
                          <div className="text-[10px] text-muted-foreground">→ {r.AdjRefDocNo}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-600 text-[13px]">
                        {r.OnAccountCreated > 0 ? formatINR(r.OnAccountCreated) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-600 text-[13px]">
                        {r.OnAccountAdjusted > 0 ? formatINR(r.OnAccountAdjusted) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-foreground font-semibold text-[13px]">
                        {formatINR(r.RunningBalance ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">
                        {r.Notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{total} total entries</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadTransactions(page - 1)}
                    disabled={page <= 1 || loading}
                    className="p-1 rounded hover:bg-accent disabled:opacity-40"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2">Page {page} of {totalPages}</span>
                  <button
                    onClick={() => loadTransactions(page + 1)}
                    disabled={page >= totalPages || loading}
                    className="p-1 rounded hover:bg-accent disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Party Summary Tab */}
        {!loading && tab === "summary" && (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Party</th>
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Type</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Total Stored</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Total Adjusted</th>
                  <th className="text-right px-3 py-2.5 font-medium text-muted-foreground text-[11px] uppercase tracking-wide">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {summaryRows
                  .filter((r) => !partyType || r.PartyType === partyType)
                  .filter((r) => !partyName || r.PartyName?.toLowerCase().includes(partyName.toLowerCase()))
                  .length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-10 text-muted-foreground text-sm">
                      No on account balances found
                    </td>
                  </tr>
                ) : summaryRows
                    .filter((r) => !partyType || r.PartyType === partyType)
                    .filter((r) => !partyName || r.PartyName?.toLowerCase().includes(partyName.toLowerCase()))
                    .map((r) => (
                  <tr key={r.PartyId} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-3">
                      <div className="font-medium text-foreground">{r.PartyName}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${partyTypeColor[PARTY_LABEL[r.PartyType] ?? r.PartyType] ?? ""}`}>
                        {PARTY_LABEL[r.PartyType] ?? r.PartyType}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-emerald-600">
                      {formatINR(r.TotalCredit)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-amber-600">
                      {formatINR(r.TotalDebit)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-foreground">
                        <Wallet className="w-3.5 h-3.5 text-primary" />
                        {formatINR(r.Balance)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </FinanceShell>
    </>
  );
}
