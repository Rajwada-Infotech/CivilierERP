import React, { useEffect, useState } from "react";
import { useUserMap } from "@/hooks/useUserMap";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  IndianRupee,
  RefreshCw,
} from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";

interface Transaction {
  id: string;
  date: string;
  type: string;
  party: string;
  description: string;
  amount: number;
  mode: string;
  status: string;
  createdBy?: string;
}

interface Summary {
  totalPayments: number;
  totalPOs: number;
  netCashFlow: number;
  pendingCount: number;
}

const TYPE_STYLE: Record<string, string> = {
  Payment: "bg-destructive/15 text-destructive",
  "Purchase Order": "bg-blue-500/15 text-blue-500",
  Receipt: "bg-green-500/15 text-green-500",
  Journal: "bg-primary/15 text-primary",
  Contra: "bg-secondary/15 text-secondary",
};

const STATUS_STYLE: Record<string, string> = {
  Completed: "bg-green-500/15 text-green-500",
  Approved: "bg-green-500/15 text-green-500",
  Pending: "bg-yellow-500/15 text-yellow-500",
  Draft: "bg-muted text-muted-foreground",
  Rejected: "bg-destructive/15 text-destructive",
  Posted: "bg-primary/15 text-primary",
};

const fmt = (n: number) => formatINR(n);

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const PAGE_SIZE = 20;

  const resolveUser = useUserMap();

  const fetchData = async (pg = page) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/transactions?page=${pg}&limit=${PAGE_SIZE}`);
      if (!res.ok) throw new Error("Failed to load transactions");
      const data = await res.json();
      setTransactions(data.transactions);
      setSummary(data.summary);
      setTotalPages(data.totalPages ?? 1);
      setTotalRecords(data.total ?? 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(page);
  }, [page]);

  const statCards = summary
    ? [
        {
          label: "Total Payments",
          value: fmt(summary.totalPayments),
          icon: ArrowUpRight,
          color: "hsl(0, 72%, 51%)",
        },
        {
          label: "Total Purchase Orders",
          value: fmt(summary.totalPOs),
          icon: ArrowDownLeft,
          color: "hsl(142, 71%, 45%)",
        },
        {
          label: "Net Cash Flow",
          value: fmt(Math.abs(summary.netCashFlow)),
          icon: IndianRupee,
          color: "hsl(var(--primary))",
        },
        {
          label: "Pending Txns",
          value: String(summary.pendingCount),
          icon: CreditCard,
          color: "hsl(var(--secondary))",
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Transactions"]} />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-heading font-bold text-foreground">
          Transactions
        </h1>
  <button
    onClick={() => fetchData()}
    disabled={loading}
    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm hover:bg-accent transition disabled:opacity-50"
  >
    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
    Refresh
  </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl bg-card border border-border p-4 h-20 animate-pulse"
              />
            ))
          : statCards.map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-card border border-border p-4 flex items-center gap-4"
                style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
              >
                <div
                  className="p-2 rounded-lg"
                  style={{ background: `${s.color}20` }}
                >
                  <s.icon size={20} style={{ color: s.color }} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-heading">
                    {s.label}
                  </p>
                  <p className="text-base sm:text-lg font-heading font-bold text-foreground">
                    {s.value}
                  </p>
                </div>
              </div>
            ))}
      </div>

      {/* Transactions Table */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-heading font-semibold text-foreground text-sm">
            Recent Transactions
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {[
                  "ID",
                  "Date",
                  "Type",
                  "Party",
                  "Description",
                  "Amount",
                  "Mode",
                  "Status",
                "Created By",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-heading text-muted-foreground font-semibold whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-muted rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : transactions.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-muted-foreground text-sm"
                  >
                    No transactions found.
                  </td>
                </tr>
              ) : (
                transactions.map((txn, i) => (
                  <tr
                    key={txn.id}
                    className={`border-b border-border transition-colors hover:bg-muted/50 ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                  >
                    <td className="px-4 py-3 text-primary font-heading text-xs">
                      {txn.id}
                    </td>
                    <td className="px-4 py-3 text-foreground whitespace-nowrap">
                      {txn.date
                        ? new Date(txn.date).toLocaleDateString("en-IN")
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${TYPE_STYLE[txn.type] || "bg-muted text-muted-foreground"}`}
                      >
                        {txn.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground font-medium whitespace-nowrap">
                      {txn.party}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                      {txn.description}
                    </td>
                    <td className="px-4 py-3 text-foreground font-heading font-medium whitespace-nowrap">
                      {fmt(txn.amount)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {txn.mode}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-heading ${STATUS_STYLE[txn.status] || "bg-muted text-muted-foreground"}`}
                      >
                        {txn.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {resolveUser(txn.createdBy)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} &middot; {totalRecords} total transactions
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = page <= 3 ? i + 1 : page - 2 + i;
              if (pg < 1 || pg > totalPages) return null;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                    pg === page
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

