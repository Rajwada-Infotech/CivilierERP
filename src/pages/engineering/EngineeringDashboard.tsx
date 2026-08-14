import React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useTheme } from "@/contexts/ThemeContext";
import {
  GlassShell,
  GlassCard,
  GlassSection,
  GlassCardSkeleton,
} from "@/components/dashboard/GlassShell";
import {
  HardHat,
  RefreshCw,
  AlertCircle,
  ClipboardList,
  Building2,
  CheckCircle2,
  Clock,
  Hammer,
  TrendingUp,
  BarChart3,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";

const ACCENT = "#f97316"; // orange — matches Engineering's ModuleStrip color
const SECONDARY = "#ef4444"; // rose bloom
const STATUS_PALETTE = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#94a3b8"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n ?? 0);

const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

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
function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
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
        const pct = total > 0 ? Math.round((Number(row.Count) / total) * 100) : 0;
        return (
          <div key={row.Status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{row.Status || "Draft"}</span>
              <span className="font-medium text-foreground">{row.Count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: ACCENT }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Donut chart card ─────────────────────────────────────────────────────────
interface DonutPoint {
  name: string;
  value: number;
  color: string;
}

const DonutCard: React.FC<{
  title: string;
  icon: React.ElementType;
  accentColor: string;
  data: DonutPoint[];
  isDark: boolean;
  glassStyle: React.CSSProperties;
  formatValue?: (n: number) => string;
}> = ({ title, icon: Icon, accentColor, data, isDark, glassStyle, formatValue = fmt }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: `${accentColor}26` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">
          {title}
        </span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">
            No data yet
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">
                          {d.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatValue(d.value as number)}
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: d.color }}
                  />
                  <span className="text-xs text-foreground whitespace-nowrap">
                    {d.name}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto sm:ml-3">
                    {formatValue(d.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Trend (line) chart card ──────────────────────────────────────────────────
interface TrendSeries {
  key: string;
  name: string;
  color: string;
}

const TrendCard: React.FC<{
  title: string;
  icon: React.ElementType;
  accentColor: string;
  data: { date: string; [key: string]: number | string }[];
  series: TrendSeries[];
  isDark: boolean;
  glassStyle: React.CSSProperties;
}> = ({ title, icon: Icon, accentColor, data, series, isDark, glassStyle }) => {
  const hasData = data.some((d) => series.some((s) => Number(d[s.key]) > 0));
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}
      >
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: `${accentColor}26` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">
          {title}
        </span>
      </div>
      <div className="p-4">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-10 text-sm">
            No activity in the last 14 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"}
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false}
                tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                formatter={(value: number, name: string) => [fmt(value), name]}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${accentColor}30`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// ─── Table column defs ────────────────────────────────────────────────────────
const WO_DASH_COLS: ColumnDef<any>[] = [
  {
    id: "DocNo",
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ getValue }) => (
      <span className="font-mono text-[11px] text-primary">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    id: "ContractorName",
    accessorKey: "ContractorName",
    header: "Contractor",
    cell: ({ getValue }) => (
      <span className="text-xs truncate max-w-[120px] block">
        {(getValue() as string) || "—"}
      </span>
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
      <span className="font-mono text-[11px] text-primary">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    id: "ProjectName",
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }) => (
      <span className="text-xs truncate max-w-[120px] block">
        {(getValue() as string) || "—"}
      </span>
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
      <span className="font-mono text-[11px] text-primary">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    id: "WorkOrderNo",
    accessorKey: "WorkOrderNo",
    header: "WO Ref",
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {(getValue() as string) || "—"}
      </span>
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
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["engineering-dashboard"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/engineering/dashboard");
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
          const b = await res.json();
          msg = b.error ?? b.message ?? msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      return res.json().catch(() => ({}));
    },
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const workOrders = data?.workOrders ?? { total: 0, open: 0, thisMonth: 0, totalValue: 0 };
  const boq = data?.boq ?? { total: 0, approved: 0, totalValue: 0 };
  const workDone = data?.workDone ?? { total: 0, pending: 0, certifiedAmount: 0 };
  const projects = data?.projects ?? { total: 0, active: 0 };

  const tableGlass = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? `1px solid ${ACCENT}26` : `1px solid ${ACCENT}2e`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : `0 4px 24px ${ACCENT}0f, inset 0 1px 0 rgba(255,255,255,0.9)`,
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Engineering"]} />
      <GlassShell
        title="Engineering Overview"
        subtitle="Work orders, BOQ, site activity and work done"
        icon={HardHat}
        accentColor={ACCENT}
        secondaryColor={SECONDARY}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ borderColor: `${ACCENT}4d`, color: ACCENT }}
          >
            <RefreshCw size={12} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
            Refresh
          </button>
        }
      >
        {isError && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={16} className="shrink-0" />
            <span>
              {(error as Error)?.message ?? "Failed to load dashboard data. Please refresh."}
            </span>
            <button onClick={() => refetch()} className="ml-auto text-xs underline hover:no-underline">
              Retry
            </button>
          </div>
        )}

        {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
        <GlassSection title="Overview" icon={HardHat} accentColor={ACCENT}>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <GlassCardSkeleton key={i} />)
              : [
                  {
                    label: "Work Orders",
                    value: fmtNum(workOrders.total),
                    sub: `${workOrders.open} open · ${workOrders.thisMonth} this month`,
                    icon: HardHat,
                    accentColor: ACCENT,
                    trend: "up" as const,
                    onClick: () => navigate("/engineering/work-order"),
                  },
                  {
                    label: "BOQ Value",
                    value: fmt(boq.totalValue),
                    sub: `${boq.total} BOQs · ${boq.approved} approved`,
                    icon: ClipboardList,
                    accentColor: "#3b82f6",
                    onClick: () => navigate("/engineering/boq"),
                  },
                  {
                    label: "Work Done (Certified)",
                    value: fmt(workDone.certifiedAmount),
                    sub: `${workDone.total} entries · ${workDone.pending} pending`,
                    icon: CheckCircle2,
                    accentColor: "#10b981",
                    onClick: () => navigate("/engineering/work-done"),
                  },
                  {
                    label: "Active Projects",
                    value: fmtNum(projects.active),
                    sub: `${projects.total} total projects`,
                    icon: Building2,
                    accentColor: "#8b5cf6",
                  },
                ].map((s) => <GlassCard key={s.label} {...s} />)}
          </div>
        </GlassSection>

        {/* ── Secondary metric strip ─────────────────────────────────────────── */}
        <GlassSection title="Totals" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => <GlassCardSkeleton key={i} />)
              : [
                  {
                    label: "WO Total Value",
                    value: fmt(workOrders.totalValue),
                    icon: HardHat,
                    accentColor: ACCENT,
                  },
                  {
                    label: "Open Work Orders",
                    value: fmtNum(workOrders.open),
                    icon: Clock,
                    accentColor: "#f59e0b",
                  },
                  {
                    label: "BOQ Approved",
                    value: fmtNum(boq.approved),
                    icon: CheckCircle2,
                    accentColor: "#10b981",
                  },
                  {
                    label: "Work Done (Pending)",
                    value: fmtNum(workDone.pending),
                    icon: AlertCircle,
                    accentColor: "#ef4444",
                  },
                ].map((s) => (
                  <GlassCard key={s.label} label={s.label} value={s.value} icon={s.icon} accentColor={s.accentColor} />
                ))}
          </div>
        </GlassSection>

        {/* ── Breakdown charts ──────────────────────────────────────────────── */}
        <GlassSection title="Breakdown" icon={BarChart3} accentColor={ACCENT}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutCard
              title="BOQ vs Work Order vs Work Done Value"
              icon={BarChart3}
              accentColor={ACCENT}
              isDark={isDark}
              glassStyle={tableGlass}
              data={[
                { name: "BOQ", value: boq.totalValue, color: "#3b82f6" },
                { name: "Work Orders", value: workOrders.totalValue, color: ACCENT },
                { name: "Work Done", value: workDone.certifiedAmount, color: "#10b981" },
              ]}
            />
            <DonutCard
              title="Work Orders by Status"
              icon={HardHat}
              accentColor={ACCENT}
              isDark={isDark}
              glassStyle={tableGlass}
              formatValue={(n) => `${n}`}
              data={(data?.woStatusBreakdown ?? []).map(
                (r: { Status: string; Count: number }, i: number) => ({
                  name: r.Status || "Draft",
                  value: Number(r.Count),
                  color: STATUS_PALETTE[i % STATUS_PALETTE.length],
                }),
              )}
            />
          </div>
          <div className="mt-4">
            <TrendCard
              title="Work Orders & Work Done Value — Last 14 Days"
              icon={TrendingUp}
              accentColor={ACCENT}
              isDark={isDark}
              glassStyle={tableGlass}
              data={data?.timeline ?? []}
              series={[
                { key: "workOrders", name: "Work Orders", color: ACCENT },
                { key: "workDone", name: "Work Done", color: "#10b981" },
              ]}
            />
          </div>
        </GlassSection>

        {/* ── Recent Work Orders + Recent BOQ ────────────────────────────────── */}
        <GlassSection title="Recent Activity" icon={HardHat} accentColor={ACCENT}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: `${ACCENT}26` }}
                  >
                    <HardHat size={11} style={{ color: ACCENT }} />
                  </div>
                  <span className="text-xs font-heading font-semibold text-foreground">
                    Recent Work Orders
                  </span>
                </div>
                <button
                  onClick={() => navigate("/engineering/work-order")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: ACCENT }}
                >
                  View all →
                </button>
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

            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: isDark ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.12)" }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(59,130,246,0.18)" }}
                  >
                    <ClipboardList size={11} style={{ color: "#3b82f6" }} />
                  </div>
                  <span className="text-xs font-heading font-semibold text-foreground">
                    Recent BOQ
                  </span>
                </div>
                <button
                  onClick={() => navigate("/engineering/boq")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#3b82f6" }}
                >
                  View all →
                </button>
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
        </GlassSection>

        {/* ── Recent Work Done + Status Breakdowns ───────────────────────────── */}
        <GlassSection title="Work Done & Status" icon={Hammer} accentColor="#10b981">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl overflow-hidden" style={tableGlass}>
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: isDark ? "rgba(16,185,129,0.18)" : "rgba(16,185,129,0.12)" }}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center"
                    style={{ background: "rgba(16,185,129,0.18)" }}
                  >
                    <Hammer size={11} style={{ color: "#10b981" }} />
                  </div>
                  <span className="text-xs font-heading font-semibold text-foreground">
                    Recent Work Done
                  </span>
                </div>
                <button
                  onClick={() => navigate("/engineering/work-done")}
                  className="text-[10px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: "#10b981" }}
                >
                  View all →
                </button>
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
              <div className="rounded-xl overflow-hidden p-4" style={tableGlass}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <HardHat size={14} style={{ color: ACCENT }} />
                    <p className="text-sm font-heading font-semibold text-foreground">
                      WO Status Breakdown
                    </p>
                  </div>
                </div>
                {isLoading ? (
                  <div className="space-y-2 animate-pulse mt-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-5 bg-muted rounded" />
                    ))}
                  </div>
                ) : (
                  <StatusBreakdown data={data?.woStatusBreakdown ?? []} label="work orders" />
                )}
              </div>

              <div className="rounded-xl overflow-hidden p-4" style={tableGlass}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Hammer size={14} style={{ color: "#10b981" }} />
                    <p className="text-sm font-heading font-semibold text-foreground">
                      Work Done Status
                    </p>
                  </div>
                </div>
                {isLoading ? (
                  <div className="space-y-2 animate-pulse mt-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-5 bg-muted rounded" />
                    ))}
                  </div>
                ) : (
                  <StatusBreakdown data={data?.workDoneStatusBreakdown ?? []} label="work done entries" />
                )}
              </div>
            </div>
          </div>
        </GlassSection>

        {/* ── Quick Actions ──────────────────────────────────────────────────── */}
        <GlassSection title="Quick Actions" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Work Order", icon: HardHat, path: "/engineering/work-order", color: ACCENT },
              { label: "BOQ", icon: ClipboardList, path: "/engineering/boq", color: "#3b82f6" },
              { label: "Work Done", icon: Hammer, path: "/engineering/work-done", color: "#10b981" },
            ].map(({ label, icon: Icon, path, color }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="group flex flex-col items-center gap-3 py-5 rounded-xl transition-all duration-200 active:scale-95"
                style={{
                  background: isDark ? `${color}0A` : `${color}08`,
                  border: `1px solid ${color}25`,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = `${color}18`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${color}40`;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = isDark ? `${color}0A` : `${color}08`;
                  (e.currentTarget as HTMLElement).style.borderColor = `${color}25`;
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ background: `${color}20`, border: `1px solid ${color}35` }}
                >
                  <Icon size={18} style={{ color }} />
                </div>
                <span
                  className="text-xs font-medium text-center leading-tight"
                  style={{ color: isDark ? "#cbd5e1" : "#475569" }}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </GlassSection>
      </GlassShell>
    </>
  );
}
