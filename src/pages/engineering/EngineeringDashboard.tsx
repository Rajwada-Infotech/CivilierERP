import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  HardHat,
  ShoppingCart,
  Receipt,
  FileText,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  TrendingUp,
  AlertCircle,
  ClipboardList,
  Layers,
  Wrench,
  Building2,
  Users,
  MapPin,
  CheckCircle2,
  Clock,
  Hammer,
  Ruler,
  Package,
} from "lucide-react";

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
  Completed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "Fully Received": "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  "In Progress": "bg-blue-500/10 text-blue-600 border-blue-400/20",
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
  iconColor = "text-orange-600",
  iconBg = "bg-orange-500/10",
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
      <div className="flex items-start justify-between">
        <div className={`p-2 rounded-lg ${iconBg}`}>
          <Icon size={18} className={iconColor} />
        </div>
        {trend && (
          <span
            className={`text-[10px] font-medium flex items-center gap-0.5 ${
              trend === "up"
                ? "text-emerald-600"
                : trend === "down"
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {trend === "up" ? (
              <ArrowUpRight size={12} />
            ) : trend === "down" ? (
              <ArrowDownRight size={12} />
            ) : null}
          </span>
        )}
      </div>
      <div>
        <p className="text-2xl font-heading font-bold text-foreground leading-none">
          {value}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
        {sub && (
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────
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
    <div className="flex items-center justify-between mb-1">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-orange-600" />
        <div>
          <p className="text-sm font-heading font-semibold text-foreground">
            {title}
          </p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
        >
          {action} <ArrowUpRight size={10} />
        </button>
      )}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
      <AlertCircle size={28} className="opacity-30" />
      <p className="text-xs">{label}</p>
    </div>
  );
}

// ─── Table Skeleton ───────────────────────────────────────────────────────────
function TableSkeleton({
  rows = 4,
  cols = 4,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="p-4 space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-muted rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────
function StatusBreakdown({
  data,
  label,
}: {
  data: { Status: string; Count: number; TotalValue?: number }[];
  label: string;
}) {
  if (!data?.length)
    return <p className="text-xs text-muted-foreground py-2">No {label} yet</p>;
  const total = data.reduce((s, r) => s + Number(r.Count), 0);
  return (
    <div className="space-y-2 mt-3">
      {data.map((row) => {
        const pct =
          total > 0 ? Math.round((Number(row.Count) / total) * 100) : 0;
        return (
          <div key={row.Status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{row.Status || "Draft"}</span>
              <span className="font-medium text-foreground">{row.Count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-orange-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Table column defs ────────────────────────────────────────────────────────
const WO_DASH_COLS: ColumnDef<any>[] = [
  {
    id: "DocNo",
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ getValue }) => (
      <span className="font-mono text-[11px] text-primary">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "ContractorName",
    accessorKey: "ContractorName",
    header: "Contractor",
    cell: ({ getValue }) => (
      <span className="text-xs truncate max-w-[120px] block">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "Status",
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
  },
  {
    id: "TotalAmount",
    accessorKey: "TotalAmount",
    header: "Amount",
    cell: ({ getValue }) => (
      <span className="text-xs font-medium">{fmt(getValue() as number)}</span>
    ),
  },
];

const BOQ_DASH_COLS: ColumnDef<any>[] = [
  {
    id: "DocNo",
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ getValue }) => (
      <span className="font-mono text-[11px] text-primary">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "ProjectName",
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }) => (
      <span className="text-xs truncate max-w-[120px] block">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "Status",
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
  },
  {
    id: "TotalValue",
    accessorKey: "TotalValue",
    header: "Value",
    cell: ({ getValue }) => (
      <span className="text-xs font-medium">{fmt(getValue() as number)}</span>
    ),
  },
];

const WORKDONE_DASH_COLS: ColumnDef<any>[] = [
  {
    id: "DocNo",
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ getValue }) => (
      <span className="font-mono text-[11px] text-primary">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "WorkOrderNo",
    accessorKey: "WorkOrderNo",
    header: "WO Ref",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">{(getValue() as string) || "—"}</span>
    ),
  },
  {
    id: "Status",
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
  },
  {
    id: "CertifiedAmount",
    accessorKey: "CertifiedAmount",
    header: "Certified",
    cell: ({ getValue }) => (
      <span className="text-xs font-medium">{fmt(getValue() as number)}</span>
    ),
  },
];

// ─── Dashboard component ──────────────────────────────────────────────────────
export default function EngineeringDashboard() {
  const navigate = useNavigate();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["engineering-dashboard"],
    queryFn: () =>
      fetchWithAuth("/api/engineering/dashboard").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  // Fallback summary values if API not yet wired
  const workOrders = data?.workOrders ?? {
    total: 0,
    open: 0,
    thisMonth: 0,
    totalValue: 0,
  };
  const boq = data?.boq ?? { total: 0, approved: 0, totalValue: 0 };
  const workDone = data?.workDone ?? {
    total: 0,
    pending: 0,
    certifiedAmount: 0,
  };
  const projects = data?.projects ?? { total: 0, active: 0 };

  return (
    <>
      <DashboardBackground />
      <div className="relative z-10 p-6 space-y-6 max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Breadcrumbs
              items={[{ label: "Engineering", path: "/engineering" }]}
            />
            <div className="flex items-center gap-3 mt-1">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Wrench size={20} className="text-orange-600" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">
                  Engineering Dashboard
                </h1>
                <p className="text-xs text-muted-foreground">
                  Work orders, BOQ, site activity and work done
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors"
          >
            <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Work Orders"
            value={fmtNum(workOrders.total)}
            sub={`${workOrders.open} open · ${workOrders.thisMonth} this month`}
            icon={HardHat}
            iconColor="text-orange-600"
            iconBg="bg-orange-500/10"
            trend="up"
            onClick={() => navigate("/engineering/work-order")}
          />
          <StatCard
            label="BOQ Value"
            value={fmt(boq.totalValue)}
            sub={`${boq.total} BOQs · ${boq.approved} approved`}
            icon={ClipboardList}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/10"
            onClick={() => navigate("/engineering/boq")}
          />
          <StatCard
            label="Work Done (Certified)"
            value={fmt(workDone.certifiedAmount)}
            sub={`${workDone.total} entries · ${workDone.pending} pending`}
            icon={CheckCircle2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
            onClick={() => navigate("/engineering/work-done")}
          />
          <StatCard
            label="Active Projects"
            value={fmtNum(projects.active)}
            sub={`${projects.total} total projects`}
            icon={Building2}
            iconColor="text-purple-600"
            iconBg="bg-purple-500/10"
          />
        </div>

        {/* Secondary metric strip */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "WO Total Value",
                value: fmt(workOrders.totalValue),
                icon: HardHat,
                color: "text-orange-600",
              },
              {
                label: "Open Work Orders",
                value: fmtNum(workOrders.open),
                icon: Clock,
                color: "text-amber-600",
              },
              {
                label: "BOQ Approved",
                value: fmtNum(boq.approved),
                icon: CheckCircle2,
                color: "text-emerald-600",
              },
              {
                label: "Work Done (Pending)",
                value: fmtNum(workDone.pending),
                icon: AlertCircle,
                color: "text-red-500",
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

        {/* Recent Work Orders + Recent BOQ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={HardHat}
                title="Recent Work Orders"
                sub="Last 6 WOs"
                action="View all"
                onAction={() => navigate("/engineering/work-order")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentWOs?.length ? (
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

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={ClipboardList}
                title="Recent BOQ"
                sub="Last 6 Bills of Quantities"
                action="View all"
                onAction={() => navigate("/engineering/boq")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentBOQs?.length ? (
              <EmptyState label="No BOQ entries yet" />
            ) : (
              <DataTable
                data={data.recentBOQs}
                columns={BOQ_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent BOQs."
              />
            )}
          </div>
        </div>

        {/* Recent Work Done + Status Breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={Hammer}
                title="Recent Work Done"
                sub="Last 6 work done entries"
                action="View all"
                onAction={() => navigate("/engineering/work-done")}
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentWorkDone?.length ? (
              <EmptyState label="No work done entries yet" />
            ) : (
              <DataTable
                data={data.recentWorkDone}
                columns={WORKDONE_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent Work Done."
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader
                icon={HardHat}
                title="WO Status Breakdown"
                onAction={() => navigate("/engineering/work-order")}
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

            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader
                icon={Hammer}
                title="Work Done Status"
                onAction={() => navigate("/engineering/work-done")}
              />
              {isLoading ? (
                <div className="space-y-2 animate-pulse">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-5 bg-muted rounded" />
                  ))}
                </div>
              ) : (
                <StatusBreakdown
                  data={data?.workDoneStatusBreakdown ?? []}
                  label="work done entries"
                />
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="rounded-xl border border-border bg-card p-5">
          <SectionHeader icon={BarChart3} title="Quick Actions" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            {[
              {
                label: "Work Order",
                icon: HardHat,
                path: "/engineering/work-order",
                color: "text-orange-600",
                bg: "bg-orange-500/10",
              },
              {
                label: "BOQ",
                icon: ClipboardList,
                path: "/engineering/boq",
                color: "text-blue-600",
                bg: "bg-blue-500/10",
              },
              {
                label: "Work Done",
                icon: Hammer,
                path: "/engineering/work-done",
                color: "text-emerald-600",
                bg: "bg-emerald-500/10",
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