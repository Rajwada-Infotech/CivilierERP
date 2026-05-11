import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  Package,
  Truck,
  FileText,
  HardHat,
  ShoppingCart,
  Receipt,
  Layers,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  ClipboardList,
  Ruler,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DashboardData {
  items: { count: number; groupCount: number };
  grns: {
    total: number;
    thisMonth: number;
    today: number;
    totalValue: number;
    thisMonthValue: number;
  };
  purchaseOrders: {
    total: number;
    open: number;
    approved: number;
    pending: number;
    totalValue: number;
    openValue: number;
  };
  workOrders: {
    total: number;
    open: number;
    thisMonth: number;
    totalValue: number;
  };
  expenses: {
    total: number;
    pending: number;
    approved: number;
    totalAmount: number;
    pendingAmount: number;
  };
  stock: {
    totalEntries: number;
    totalIn: number;
    totalOut: number;
    uniqueItems: number;
  };
  uom: { total: number };
  recentGRNs: any[];
  recentPOs: any[];
  recentWOs: any[];
  recentExpenses: any[];
  poStatusBreakdown: { Status: string; Count: number; TotalValue: number }[];
  woStatusBreakdown: { Status: string; Count: number; TotalValue: number }[];
  topItems: {
    ItemID: string;
    ItemName: string;
    TotalIn: number;
    TotalOut: number;
    NetStock: number;
  }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const fmtDate = (d: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

// ─── Status badge ─────────────────────────────────────────────────────────────
const statusColors: Record<string, string> = {
  Approved: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Closed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "Fully Received": "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Draft: "bg-muted text-muted-foreground border-border",
  Open: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  "Partially Received": "bg-blue-500/10 text-blue-600 border-blue-400/20",
  Rejected: "bg-red-500/10 text-red-500 border-red-400/20",
  Cancelled: "bg-red-500/10 text-red-500 border-red-400/20",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    statusColors[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      {status || "Draft"}
    </span>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-emerald-600",
  iconBg = "bg-emerald-500/10",
  trend,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-border bg-card p-5 flex flex-col gap-3 transition-all duration-200 ${
        onClick
          ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
          : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-heading uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <div
          className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}
        >
          <Icon size={15} className={iconColor} />
        </div>
      </div>
      <div>
        <div className="text-2xl font-bold font-heading text-foreground">
          {value}
        </div>
        <div className="flex items-center gap-1 mt-1">
          {trend === "up" && (
            <ArrowUpRight size={12} className="text-emerald-500" />
          )}
          {trend === "down" && (
            <ArrowDownRight size={12} className="text-red-500" />
          )}
          <span className="text-xs text-muted-foreground">{sub}</span>
        </div>
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="h-3 w-24 bg-muted rounded" />
        <div className="w-8 h-8 bg-muted rounded-lg" />
      </div>
      <div className="h-7 w-20 bg-muted rounded mb-2" />
      <div className="h-3 w-32 bg-muted rounded" />
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({
  icon: Icon,
  title,
  sub,
  action,
  onAction,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon size={15} className="text-muted-foreground" />
        <span className="text-sm font-heading font-semibold text-foreground">
          {title}
        </span>
        {sub && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {sub}
          </span>
        )}
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-xs text-primary hover:underline font-heading"
        >
          {action} →
        </button>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <ClipboardList size={28} className="mb-2 opacity-30" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

// ─── Table skeleton ───────────────────────────────────────────────────────────
function TableSkeleton({ rows = 4, cols = 4 }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-6 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────
function StatusBreakdown({
  data,
  label,
}: {
  data: { Status: string; Count: number; TotalValue: number }[];
  label: string;
}) {
  const total = data.reduce((s, r) => s + r.Count, 0) || 1;
  return (
    <div className="space-y-2">
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">No {label} yet</p>
      ) : (
        data.map((r) => {
          const pct = Math.round((r.Count / total) * 100);
          const barColor =
            r.Status === "Approved" || r.Status === "Closed"
              ? "bg-emerald-500"
              : r.Status === "Pending" || r.Status === "Draft"
                ? "bg-amber-500"
                : r.Status === "Rejected" || r.Status === "Cancelled"
                  ? "bg-red-500"
                  : "bg-blue-500";

          return (
            <div key={r.Status} className="space-y-0.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground font-medium">
                  {r.Status || "Draft"}
                </span>
                <span className="text-muted-foreground">
                  {r.Count} · {pct}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${barColor} transition-all duration-500`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function makeRecentCols(
  docNoKey: string,
  docNoFallback: string,
  partyKey: string,
  dateKey: string,
  amountKey: string,
  statusKey: string,
  defaultStatus = "Draft",
): ColumnDef<any, unknown>[] {
  return [
    {
      accessorKey: docNoKey,
      header: "Doc No",
      cell: ({ row }: any) => (
        <span className="font-mono text-xs font-medium text-primary">
          {row.original[docNoKey] || `#${row.original[docNoFallback]}`}
        </span>
      ),
    },
    {
      accessorKey: partyKey,
      header: "Party / Project",
      cell: ({ getValue }: any) => (
        <span className="text-xs text-muted-foreground max-w-[110px] truncate block">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      accessorKey: dateKey,
      header: "Date",
      cell: ({ getValue }: any) => (
        <span className="text-xs text-muted-foreground">
          {fmtDate(getValue() as string)}
        </span>
      ),
    },
    {
      accessorKey: amountKey,
      header: "Amount",
      cell: ({ getValue }: any) => {
        const v = getValue() as number | null;
        return (
          <span className="text-xs font-medium">
            {v != null ? fmt(v) : "—"}
          </span>
        );
      },
    },
    {
      accessorKey: statusKey,
      header: "Status",
      cell: ({ getValue }: any) => (
        <StatusBadge status={(getValue() as string) || defaultStatus} />
      ),
    },
  ];
}

const GRN_DASH_COLS = makeRecentCols(
  "GRNNo",
  "GRNID",
  "SupplierName",
  "GRNDate",
  "TotalAmount",
  "Status",
);
const PO_DASH_COLS = makeRecentCols(
  "PurchaseOrderNo",
  "PurchaseOrderID",
  "SupplierName",
  "PODate",
  "TotalAmount",
  "Status",
);
const WO_DASH_COLS = makeRecentCols(
  "DocumentNumber",
  "Id",
  "ProjectName",
  "DocumentDate",
  "TotalAmount",
  "Status",
);
const EXP_DASH_COLS = makeRecentCols(
  "EDocNo",
  "Eid",
  "EProjectName",
  "EDocDate",
  "EAmount",
  "EStatus",
  "Pending",
);

export default function MaterialDashboard() {
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<DashboardData>({
      queryKey: ["materialDashboard"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/material-dashboard");
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error || `HTTP ${res.status}`);
        }
        const raw = await res.json();

        return {
          items: raw.items ?? { count: 0, groupCount: 0 },
          grns: raw.grns ?? {
            total: 0,
            thisMonth: 0,
            today: 0,
            totalValue: 0,
            thisMonthValue: 0,
          },
          purchaseOrders: raw.purchaseOrders ?? {
            total: 0,
            open: 0,
            approved: 0,
            pending: 0,
            totalValue: 0,
            openValue: 0,
          },
          workOrders: raw.workOrders ?? {
            total: 0,
            open: 0,
            thisMonth: 0,
            totalValue: 0,
          },
          expenses: raw.expenses ?? {
            total: 0,
            pending: 0,
            approved: 0,
            totalAmount: 0,
            pendingAmount: 0,
          },
          stock: raw.stock ?? {
            totalEntries: 0,
            totalIn: 0,
            totalOut: 0,
            uniqueItems: 0,
          },
          uom: raw.uom ?? { total: 0 },
          recentGRNs: raw.recentGRNs ?? [],
          recentPOs: raw.recentPOs ?? [],
          recentWOs: raw.recentWOs ?? [],
          recentExpenses: raw.recentExpenses ?? [],
          poStatusBreakdown: raw.poStatusBreakdown ?? [],
          woStatusBreakdown: raw.woStatusBreakdown ?? [],
          topItems: raw.topItems ?? [],
        } as DashboardData;
      },
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      retry: 1,
    });

  // ── Stat cards config ────────────────────────────────────────────────
  const statCards = data
    ? [
        {
          label: "Total Items",
          value: fmtNum(data.items.count),
          sub: `${data.items.groupCount} item groups`,
          icon: Package,
          iconColor: "text-emerald-600",
          iconBg: "bg-emerald-500/10",
          trend: "neutral" as const,
          onClick: () => navigate("/masters/items"), // Correct route
        },
        {
          label: "GRNs This Month",
          value: fmtNum(data.grns.thisMonth),
          sub: `${data.grns.today} today · ${fmt(data.grns.thisMonthValue)}`,
          icon: Truck,
          iconColor: "text-blue-600",
          iconBg: "bg-blue-500/10",
          trend: "up" as const,
          onClick: () => navigate("/material/grn"),
        },
        {
          label: "Open Purchase Orders",
          value: fmtNum(data.purchaseOrders.open),
          sub: `${fmt(data.purchaseOrders.openValue)} outstanding`,
          icon: ShoppingCart,
          iconColor: "text-amber-600",
          iconBg: "bg-amber-500/10",
          trend:
            data.purchaseOrders.open > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => navigate("/material/purchase-order"),
        },
        {
          label: "Work Orders",
          value: fmtNum(data.workOrders.total),
          sub: `${data.workOrders.open} open · ${fmt(data.workOrders.totalValue)}`,
          icon: HardHat,
          iconColor: "text-purple-600",
          iconBg: "bg-purple-500/10",
          trend: "neutral" as const,
          onClick: () => navigate("/material/work-order"),
        },
        {
          label: "Pending Expenses",
          value: fmtNum(data.expenses.pending),
          sub: `${fmt(data.expenses.pendingAmount)} pending approval`,
          icon: Receipt,
          iconColor: "text-red-600",
          iconBg: "bg-red-500/10",
          trend:
            data.expenses.pending > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => navigate("/material/expense-booking"),
        },
        {
          label: "Net Stock Movements",
          value: fmtNum(data.stock.totalIn - data.stock.totalOut),
          sub: `${fmtNum(data.stock.uniqueItems)} items tracked`,
          icon: Layers,
          iconColor: "text-teal-600",
          iconBg: "bg-teal-500/10",
          trend:
            data.stock.totalIn > data.stock.totalOut
              ? ("up" as const)
              : ("down" as const),
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material"]} />
      <div className="relative p-6 space-y-6">
        <DashboardBackground />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Material Overview
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time data from GRNs, Purchase Orders, Work Orders, Expenses &
              Stock
            </p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {isError && !data && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load dashboard data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}.
            Please refresh.
          </div>
        )}

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <StatSkeleton key={i} />)
            : statCards.map((s) => <StatCard key={s.label} {...s} />)}
        </div>

        {/* Summary Strip */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Total GRN Value",
                value: fmt(data.grns.totalValue),
                icon: TrendingUp,
                color: "text-emerald-600",
              },
              {
                label: "Total PO Value",
                value: fmt(data.purchaseOrders.totalValue),
                icon: FileText,
                color: "text-blue-600",
              },
              {
                label: "Total WO Value",
                value: fmt(data.workOrders.totalValue),
                icon: HardHat,
                color: "text-purple-600",
              },
              {
                label: "Total Expense Amount",
                value: fmt(data.expenses.totalAmount),
                icon: Receipt,
                color: "text-amber-600",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3"
              >
                <s.icon size={18} className={s.color} />
                <div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-sm font-heading font-bold text-foreground">
                    {s.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recent GRNs + Recent POs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent GRNs */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Truck}
                title="Recent GRNs"
                sub="Last 6 goods receipts"
                action="View all"
                onAction={() => navigate("/material/grn")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentGRNs.length ? (
              <EmptyState label="No GRNs recorded yet" />
            ) : (
              <DataTable
                data={data.recentGRNs}
                columns={GRN_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent GRNs."
              />
            )}
          </div>

          {/* Recent Purchase Orders */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={ShoppingCart}
                title="Recent Purchase Orders"
                sub="Last 6 POs"
                action="View all"
                onAction={() => navigate("/material/purchase-order")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentPOs.length ? (
              <EmptyState label="No purchase orders yet" />
            ) : (
              <DataTable
                data={data.recentPOs}
                columns={PO_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent POs."
              />
            )}
          </div>
        </div>

        {/* Recent Work Orders + Recent Expenses */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Work Orders */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={HardHat}
                title="Recent Work Orders"
                sub="Last 6 WOs"
                action="View all"
                onAction={() => navigate("/material/work-order")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentWOs.length ? (
              <EmptyState label="No work orders yet" />
            ) : (
              <DataTable
                data={data.recentWOs}
                columns={WO_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent Work Orders."
              />
            )}
          </div>

          {/* Recent Expense Bookings */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Receipt}
                title="Recent Expense Bookings"
                sub="Last 6 entries"
                action="View all"
                onAction={() => navigate("/material/expense-booking")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentExpenses.length ? (
              <EmptyState label="No expense bookings yet" />
            ) : (
              <DataTable
                data={data.recentExpenses}
                columns={EXP_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent Expenses."
              />
            )}
          </div>
        </div>

        {/* Status Breakdowns + Top Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* PO Status Breakdown */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={ShoppingCart}
              title="PO Status Breakdown"
              onAction={() => navigate("/material/purchase-order")}
            />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBreakdown
                data={data?.poStatusBreakdown ?? []}
                label="purchase orders"
              />
            )}
          </div>

          {/* WO Status Breakdown */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader
              icon={HardHat}
              title="WO Status Breakdown"
              onAction={() => navigate("/material/work-order")}
            />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : (
              <StatusBreakdown
                data={data?.woStatusBreakdown ?? []}
                label="work orders"
              />
            )}
          </div>

          {/* Top Items */}
          <div className="rounded-xl border border-border bg-card p-5">
            <SectionHeader icon={Package} title="Top Items by Receipts" />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-6 bg-muted rounded" />
                ))}
              </div>
            ) : !data?.topItems.length ? (
              <p className="text-xs text-muted-foreground py-2">
                No stock movements yet
              </p>
            ) : (
              <div className="space-y-2">
                {data.topItems.map((item, idx) => (
                  <div
                    key={item.ItemID || idx}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-xs text-foreground truncate">
                        {item.ItemName || item.ItemID || "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <span className="text-[10px] text-emerald-600 font-medium">
                        +{fmtNum(item.TotalIn)}
                      </span>
                      {item.TotalOut > 0 && (
                        <span className="text-[10px] text-red-500 font-medium">
                          -{fmtNum(item.TotalOut)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions (without Amendments) */}
        <div className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={BarChart3} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              {
                label: "New GRN",
                icon: Truck,
                path: "/material/grn",
                color: "text-blue-600",
                bg: "bg-blue-500/10",
              },
              {
                label: "Purchase Order",
                icon: ShoppingCart,
                path: "/material/purchase-order",
                color: "text-amber-600",
                bg: "bg-amber-500/10",
              },
              {
                label: "Work Order",
                icon: HardHat,
                path: "/material/work-order",
                color: "text-purple-600",
                bg: "bg-purple-500/10",
              },
              {
                label: "Expense Booking",
                icon: Receipt,
                path: "/material/expense-booking",
                color: "text-red-600",
                bg: "bg-red-500/10",
              },
              {
                label: "UOM Master",
                icon: Ruler,
                path: "/material/uom",
                color: "text-emerald-600",
                bg: "bg-emerald-500/10",
              },
              {
                label: "Inventory",
                icon: ClipboardList,
                path: "/material/inventory-master",
                color: "text-teal-600",
                bg: "bg-teal-500/10",
              },
              {
                label: "T&C Master",
                icon: FileText,
                path: "/material/t-c-master",
                color: "text-slate-600",
                bg: "bg-slate-500/10",
              },
            ].map(({ label, icon: Icon, path, color, bg }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="flex flex-col items-center gap-2 py-4 px-3 rounded-xl border border-border hover:bg-muted hover:border-primary/20 transition-all duration-150 active:scale-95 group"
              >
                <div
                  className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center group-hover:scale-110 transition-transform`}
                >
                  <Icon size={16} className={color} />
                </div>
                <span className="text-xs font-heading text-muted-foreground group-hover:text-foreground text-center leading-tight">
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
