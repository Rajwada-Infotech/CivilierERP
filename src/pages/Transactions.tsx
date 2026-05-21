import { useEffect, useState, useMemo } from "react";
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

  const columns = useMemo(() => buildColumns(resolveUser), [resolveUser]);

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

      {/* Table — server-side pagination, DataTable search operates on current page */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="p-4 border-b border-border">
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalRecords} total transactions
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
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${pg === page ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
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
