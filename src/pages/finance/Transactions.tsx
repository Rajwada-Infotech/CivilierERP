import { useEffect, useState, useMemo } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { useUserMap } from "@/hooks/useUserMap";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  IndianRupee,
  RefreshCw,
} from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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

function buildColumns(
  resolveUser: (id?: string) => string,
): ColumnDef<Transaction, unknown>[] {
  return [
    {
      accessorKey: "id",
      header: "ID",
      cell: ({ getValue }) => (
        <span className="text-primary font-heading text-xs">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "date",
      header: "Date",
      cell: ({ getValue }) => (
        <span className="text-foreground whitespace-nowrap">
          {getValue()
            ? new Date(getValue() as string).toLocaleDateString("en-IN")
            : "—"}
        </span>
      ),
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-heading ${TYPE_STYLE[v] || "bg-muted text-muted-foreground"}`}
          >
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "party",
      header: "Party",
      cell: ({ getValue }) => (
        <span className="text-foreground font-medium whitespace-nowrap">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "description",
      header: "Description",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground max-w-[200px] truncate block">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ getValue }) => (
        <span className="text-foreground font-heading font-medium whitespace-nowrap">
          {fmt(getValue() as number)}
        </span>
      ),
    },
    {
      accessorKey: "mode",
      header: "Mode",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-heading ${STATUS_STYLE[v] || "bg-muted text-muted-foreground"}`}
          >
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "createdBy",
      header: "Created By",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground whitespace-nowrap">
          {resolveUser(getValue() as string | undefined)}
        </span>
      ),
    },
  ];
}

export default function Transactions() {
  usePageRights("transactions");
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
      const res = await fetchWithAuth(
        `/api/transactions?page=${pg}&limit=${PAGE_SIZE}`,
      );
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
          sub: "outgoing",
          icon: ArrowUpRight,
          ring: "ring-rose-500/20",
          bg: "bg-rose-500/10",
          blob: "bg-rose-500",
          borderL: "border-l-rose-500",
          color: "text-rose-500",
        },
        {
          label: "Purchase Orders",
          value: fmt(summary.totalPOs),
          sub: "incoming",
          icon: ArrowDownLeft,
          ring: "ring-emerald-500/20",
          bg: "bg-emerald-500/10",
          blob: "bg-emerald-500",
          borderL: "border-l-emerald-500",
          color: "text-emerald-500",
        },
        {
          label: "Net Cash Flow",
          value: fmt(Math.abs(summary.netCashFlow)),
          sub: "net total",
          icon: IndianRupee,
          ring: "ring-primary/20",
          bg: "bg-primary/10",
          blob: "bg-primary",
          borderL: "border-l-primary",
          color: "text-primary",
        },
        {
          label: "Pending Txns",
          value: String(summary.pendingCount),
          sub: "awaiting action",
          icon: CreditCard,
          ring: "ring-amber-500/20",
          bg: "bg-amber-500/10",
          blob: "bg-amber-500",
          borderL: "border-l-amber-500",
          color: "text-amber-500",
        },
      ]
    : [];

  const columns = useMemo(() => buildColumns(resolveUser), [resolveUser]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Transactions"]} />
      <FinanceShell
        title="Transactions"
        subtitle="All payments, purchase orders, receipts and journal entries"
        action={
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
            style={{ color: "#818cf8" }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        }
      >
        {error && (
          <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            {error}
          </div>
        )}

        {/* ── Stats ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loading && !summary
            ? Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="glass rounded-xl px-4 py-3.5 h-[76px] animate-pulse ring-1 ring-border"
                />
              ))
            : statCards.map(({ label, value, sub, icon: Icon, ring, bg, blob, borderL, color }) => (
                <div
                  key={label}
                  className={`relative glass rounded-xl px-4 py-3.5 flex items-center gap-3.5 ring-1 overflow-hidden border-l-2 ${ring} ${borderL}`}
                >
                  <div className={`absolute top-0 right-0 w-20 h-20 rounded-full opacity-10 -translate-y-4 translate-x-4 ${blob}`} />
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-lg font-bold font-heading text-foreground leading-none">
                      {value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                      {label}
                    </p>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                      {sub}
                    </p>
                  </div>
                </div>
              ))}
        </div>

        {/* ── Table ────────────────────────────────────────────────────────── */}
        <div className="rounded-xl bg-card border border-border overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border">
            <h2 className="font-heading font-semibold text-foreground text-sm">
              Recent Transactions
            </h2>
          </div>
          <DataTable
            data={transactions}
            columns={columns}
            loading={loading}
            paginated={false}
            searchable={false}
            emptyMessage="No transactions found."
          />
        </div>

        {/* ── Pagination ───────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-foreground tabular-nums">
              Page {page} of {totalPages} · {totalRecords} total transactions
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
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
                className="p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

      </FinanceShell>
    </>
  );
}