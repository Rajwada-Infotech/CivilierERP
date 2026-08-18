import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { useTheme } from "@/contexts/ThemeContext";
import { DashboardBackground } from "@/components/DashboardBackground";
import {
  MaterialShell,
  MaterialGlassCard,
  MaterialSection,
} from "@/components/material/MaterialShell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Package,
  Truck,
  FileText,
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
  PackageCheck,
  Send,
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
  materialIssues: {
    total: number;
    thisMonth: number;
    today: number;
    totalQty: number;
  };
  materialRequests: {
    total: number;
    pending: number;
    approved: number;
    draft: number;
    ordered: number;
    partiallyOrdered: number;
    thisMonth: number;
  };
  recentGRNs: any[];
  recentPOs: any[];
  recentExpenses: any[];
  recentIssues: any[];
  recentRequests: any[];
  poStatusBreakdown: { Status: string; Count: number; TotalValue: number }[];
  topItems: {
    ItemID: string;
    ItemName: string;
    TotalIn: number;
    TotalOut: number;
    NetStock: number;
  }[];
  timeline: { date: string; grn: number; po: number }[];
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
  Ordered: "bg-violet-500/10 text-violet-600 border-violet-400/20",
  "Partially Ordered": "bg-purple-500/10 text-purple-600 border-purple-400/20",
  Pending: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  Draft: "bg-muted text-muted-foreground border-border",
  Open: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  "Partially Received": "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
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

// ─── Stat Card (glass) ───────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accentColor = "#10b981",
  trend,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
  borderL?: string;
  accentColor?: string;
  trend?: "up" | "down" | "neutral";
  onClick?: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl overflow-hidden ${onClick ? "cursor-pointer" : ""}`}
      style={{
        background: isDark ? "rgba(10,18,15,0.50)" : "rgba(255,255,255,0.75)",
        border: `1px solid ${accentColor}28`,
        backdropFilter: "blur(16px) saturate(150%)",
        WebkitBackdropFilter: "blur(16px) saturate(150%)",
        boxShadow: isDark
          ? "0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 4px 20px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
        transition: "transform 0.15s, box-shadow 0.15s",
      }}
      onMouseEnter={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = ""; } : undefined}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)` }} />
      <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full" style={{ background: accentColor }} />
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}50, transparent)` }} />
      <div className="relative z-10 p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10px] font-heading font-semibold uppercase tracking-widest leading-tight" style={{ color: accentColor, opacity: 0.85 }}>
            {label}
          </span>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}>
            <Icon size={14} style={{ color: accentColor }} />
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold font-heading" style={{ color: isDark ? "#f1f5f9" : "#1e1b4b" }}>
            {value}
          </div>
          <div className="flex items-center gap-1 mt-1">
            {trend === "up" && (
              <ArrowUpRight size={12} className="text-emerald-500" />
            )}
            {trend === "down" && (
              <ArrowDownRight size={12} className="text-red-500" />
            )}
            <span className="text-[11px] text-muted-foreground leading-tight">
              {sub}
            </span>
          </div>
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

// ─── Donut / trend chart cards ────────────────────────────────────────────────
interface DonutPoint { name: string; value: number; color: string; }

function DonutCard({
  title, icon: Icon, accentColor, data, isDark, glassStyle, formatValue = fmt,
}: {
  title: string; icon: React.ElementType; accentColor: string; data: DonutPoint[];
  isDark: boolean; glassStyle: React.CSSProperties; formatValue?: (n: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(16,185,129,0.12)" }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${accentColor}26` }}>
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4">
        {total === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No data yet</div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} strokeWidth={0}>
                  {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{formatValue(d.value as number)}</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                  <span className="text-xs text-foreground whitespace-nowrap">{d.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto sm:ml-3">{formatValue(d.value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TrendSeries { key: string; name: string; color: string; }

function TrendCard({
  title, icon: Icon, accentColor, data, series, isDark, glassStyle,
}: {
  title: string; icon: React.ElementType; accentColor: string;
  data: { date: string; [key: string]: number | string }[]; series: TrendSeries[];
  isDark: boolean; glassStyle: React.CSSProperties;
}) {
  const hasData = data.some((d) => series.some((s) => Number(d[s.key]) > 0));
  return (
    <div className="rounded-xl overflow-hidden" style={glassStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "rgba(16,185,129,0.12)" }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${accentColor}26` }}>
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">{title}</span>
      </div>
      <div className="p-4">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No activity in the last 14 days</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false}
                interval={Math.max(0, Math.floor(data.length / 6) - 1)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false} tickLine={false} width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
              />
              <Tooltip
                labelFormatter={(d) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                formatter={(value: number, name: string) => [fmt(value), name]}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${accentColor}30`, borderRadius: 8, fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              {series.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
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
  accentColor = "#10b981",
  compact = false,
}: {
  icon: React.ElementType;
  title: string;
  sub?: string;
  action?: string;
  onAction?: () => void;
  accentColor?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between${compact ? "" : " mb-3"}`}>
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">
          {title}
        </span>
        {sub && (
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {sub}
          </span>
        )}
      </div>
      {action && onAction && (
        <button
          onClick={onAction}
          className="text-[10px] font-medium hover:opacity-70 transition-opacity"
          style={{ color: accentColor }}
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
    <div className="text-center text-muted-foreground py-10 text-sm">
      {label}
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
                  : "bg-emerald-500";

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
        <span className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
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
const EXP_DASH_COLS = makeRecentCols(
  "EDocNo",
  "Eid",
  "EProjectName",
  "EDocDate",
  "EAmount",
  "EStatus",
  "Pending",
);

// Issues columns (no amount — qty-based)
const ISSUE_DASH_COLS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ row }: any) => (
      <span className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
        {row.original.DocNo || `#${row.original.IssueId}`}
      </span>
    ),
  },
  {
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground max-w-[110px] truncate block">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "IssueDate",
    header: "Date",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {fmtDate(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "ItemCount",
    header: "Items",
    cell: ({ getValue }: any) => (
      <span className="text-xs font-medium">{getValue() as number}</span>
    ),
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }: any) => (
      <StatusBadge status={(getValue() as string) || "Draft"} />
    ),
  },
];

// Request columns
const REQUEST_DASH_COLS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "DocNo",
    header: "Doc No",
    cell: ({ row }: any) => (
      <span className="font-mono text-xs font-medium text-emerald-600 dark:text-emerald-400">
        {row.original.DocNo || `#${row.original.MRId}`}
      </span>
    ),
  },
  {
    accessorKey: "ProjectName",
    header: "Project",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground max-w-[100px] truncate block">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "RequestDate",
    header: "Date",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {fmtDate(getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "Priority",
    header: "Priority",
    cell: ({ getValue }: any) => {
      const p = getValue() as string;
      const cls =
        p === "High" || p === "Urgent"
          ? "bg-red-500/10 text-red-600 border-red-400/20"
          : p === "Normal"
            ? "bg-emerald-500/10 text-emerald-600 border-emerald-400/20"
            : "bg-muted text-muted-foreground border-border";
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
        >
          {p || "Normal"}
        </span>
      );
    },
  },
  {
    accessorKey: "Status",
    header: "Status",
    cell: ({ getValue }: any) => (
      <StatusBadge status={(getValue() as string) || "Draft"} />
    ),
  },
];

// ─── Items Modal Columns ──────────────────────────────────────────────────────
const ITEMS_MODAL_COLS: ColumnDef<any, unknown>[] = [
  {
    accessorKey: "M_code",
    header: "Code",
    cell: ({ getValue }: any) => (
      <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "M_Name",
    header: "Item Name",
    cell: ({ getValue }: any) => (
      <span className="text-xs font-medium text-foreground">
        {getValue() as string}
      </span>
    ),
  },
  {
    accessorKey: "M_Group",
    header: "Group",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "M_Type",
    header: "Type",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "M_UOM",
    header: "UOM",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
  {
    accessorKey: "M_HSN",
    header: "HSN",
    cell: ({ getValue }: any) => (
      <span className="text-xs text-muted-foreground">
        {(getValue() as string) || "—"}
      </span>
    ),
  },
];

type ModalKey =
  | "items"
  | "grns"
  | "pos"
  | "expenses"
  | "stock"
  | "issues"
  | "requests"
  | null;

export default function MaterialDashboard() {
  const rights = usePageRights("material-dashboard");
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  // Reusable theme-aware glass panel style
  const gp = {
    background: isDark ? "rgba(10,18,15,0.45)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(16,185,129,0.15)" : "1px solid rgba(16,185,129,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(16,185,129,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  } as React.CSSProperties;

  const open = (key: ModalKey) => setOpenModal(key);
  const close = () => setOpenModal(null);

  // ── Per-modal queries (all lazy) ──────────────────────────────────────
  const { data: itemsData, isLoading: itemsLoading } = useQuery<any[]>({
    queryKey: ["modalItemMaster"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/item-master");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "items",
    staleTime: 60_000,
  });

  const { data: grnsData, isLoading: grnsLoading } = useQuery<any[]>({
    queryKey: ["modalGRNs"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/grns?page=1&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "grns",
    staleTime: 30_000,
  });

  const { data: posData, isLoading: posLoading } = useQuery<any[]>({
    queryKey: ["modalPOs"],
    queryFn: async () => {
      const res = await fetchWithAuth(
        "/api/purchase-orders?page=1&limit=200&status=Open",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "pos",
    staleTime: 30_000,
  });

  const { data: expensesData, isLoading: expensesLoading } = useQuery<any[]>({
    queryKey: ["modalExpenses"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/expense-booking?status=Pending");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "expenses",
    staleTime: 30_000,
  });

  const { data: stockData, isLoading: stockLoading } = useQuery<any[]>({
    queryKey: ["modalStock"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/stock-transfers?page=1&limit=200");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "stock",
    staleTime: 30_000,
  });

  const { data: issuesData, isLoading: issuesLoading } = useQuery<any[]>({
    queryKey: ["modalIssues"],
    queryFn: async () => {
      const res = await fetchWithAuth(
        "/api/material-issues?page=1&limit=200&search=",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "issues",
    staleTime: 30_000,
  });

  const { data: requestsData, isLoading: requestsLoading } = useQuery<any[]>({
    queryKey: ["modalRequests"],
    queryFn: async () => {
      const res = await fetchWithAuth(
        "/api/material-requests?page=1&limit=200",
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    enabled: openModal === "requests",
    staleTime: 30_000,
  });

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<DashboardData>({
      queryKey: ["materialDashboard"],
      queryFn: async () => {
        const res = await fetchWithAuth("/api/material-dashboard");
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody?.error || `HTTP ${res.status}`);
        }
        const raw = await res.json().catch(() => ({}));

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
          materialIssues: raw.materialIssues ?? {
            total: 0,
            thisMonth: 0,
            today: 0,
            totalQty: 0,
          },
          materialRequests: raw.materialRequests ?? {
            total: 0,
            pending: 0,
            approved: 0,
            draft: 0,
            ordered: 0,
            partiallyOrdered: 0,
            thisMonth: 0,
          },
          recentGRNs: raw.recentGRNs ?? [],
          recentPOs: raw.recentPOs ?? [],
          recentExpenses: raw.recentExpenses ?? [],
          recentIssues: raw.recentIssues ?? [],
          recentRequests: raw.recentRequests ?? [],
          poStatusBreakdown: raw.poStatusBreakdown ?? [],
          topItems: raw.topItems ?? [],
          timeline: raw.timeline ?? [],
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
          accentColor: "#10b981",
          trend: "neutral" as const,
          onClick: () => open("items"),
        },
        {
          label: "GRNs This Month",
          value: fmtNum(data.grns.thisMonth),
          sub: `${data.grns.today} today · ${fmt(data.grns.thisMonthValue)}`,
          icon: Truck,
          accentColor: "#3b82f6",
          trend: "up" as const,
          onClick: () => open("grns"),
        },
        {
          label: "Open Purchase Orders",
          value: fmtNum(data.purchaseOrders.open),
          sub: `${fmt(data.purchaseOrders.openValue)} outstanding`,
          icon: ShoppingCart,
          accentColor: "#f59e0b",
          trend:
            data.purchaseOrders.open > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => open("pos"),
        },
        {
          label: "Pending Expenses",
          value: fmtNum(data.expenses.pending),
          sub: `${fmt(data.expenses.pendingAmount)} pending approval`,
          icon: Receipt,
          accentColor: "#ef4444",
          trend:
            data.expenses.pending > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => open("expenses"),
        },
        {
          label: "Net Stock Movements",
          value: fmtNum(data.stock.totalIn - data.stock.totalOut),
          sub: `${fmtNum(data.stock.uniqueItems)} items tracked`,
          icon: Layers,
          accentColor: "#14b8a6",
          trend:
            data.stock.totalIn > data.stock.totalOut
              ? ("up" as const)
              : ("down" as const),
          onClick: () => open("stock"),
        },
        {
          label: "Material Issues",
          value: fmtNum(data.materialIssues.thisMonth),
          sub: `${data.materialIssues.today} today · ${fmtNum(data.materialIssues.total)} total`,
          icon: PackageCheck,
          accentColor: "#f97316",
          trend: "neutral" as const,
          onClick: () => open("issues"),
        },
        {
          label: "Material Requests",
          value: fmtNum(data.materialRequests.total),
          sub: `${data.materialRequests.thisMonth} this month · ${data.materialRequests.pending} pending`,
          icon: Send,
          accentColor: "#6366f1",
          trend:
            data.materialRequests.total > 0
              ? ("down" as const)
              : ("neutral" as const),
          onClick: () => open("requests"),
        },
      ]
    : [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Material"]} />
      <DashboardBackground />
      <MaterialShell
        title="Material Overview"
        subtitle="Real-time data from GRNs, Purchase Orders, Issues, Requests, Expenses & Stock"
        icon={Package}
        action={
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="group flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 transition-all duration-200 active:scale-90 disabled:opacity-50"
            style={{ color: "#34d399" }}
          >
            <RefreshCw size={13} className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`} />
            Refresh
          </button>
        }
      >

        {isError && !data && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-600 text-sm border border-red-500/20 flex items-center gap-2">
            <AlertCircle size={15} />
            Failed to load dashboard data
            {(error as Error)?.message ? `: ${(error as Error).message}` : ""}.
            Please refresh.
          </div>
        )}

        {/* Stat Cards — 2 cols mobile, 4 cols tablet+, 4 cols desktop (2 rows of 4) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => <StatSkeleton key={i} />)
            : statCards.map((s) => <StatCard key={s.label} {...s} />)}
        </div>

        {/* Value Summary Strip */}
        {data && (
          <MaterialSection title="Totals" icon={TrendingUp} accentColor="#10b981">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MaterialGlassCard
                label="Total GRN Value"
                value={fmt(data.grns.totalValue)}
                sub={`${data.grns.total} total receipts`}
                icon={TrendingUp}
                accentColor="#10b981"
                trend="neutral"
              />
              <MaterialGlassCard
                label="Total PO Value"
                value={fmt(data.purchaseOrders.totalValue)}
                sub={`${data.purchaseOrders.total} total orders`}
                icon={FileText}
                accentColor="#3b82f6"
                trend="neutral"
              />
              <MaterialGlassCard
                label="Total Expense Amount"
                value={fmt(data.expenses.totalAmount)}
                sub={`${data.expenses.approved} approved`}
                icon={Receipt}
                accentColor="#f59e0b"
                trend="neutral"
              />
            </div>
          </MaterialSection>
        )}

        {/* Breakdown charts */}
        {data && (
          <MaterialSection title="Breakdown" icon={BarChart3} accentColor="#10b981">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DonutCard
                title="GRN vs PO Value"
                icon={TrendingUp}
                accentColor="#10b981"
                isDark={isDark}
                glassStyle={gp}
                data={[
                  { name: "GRN Value", value: data.grns.totalValue, color: "#10b981" },
                  { name: "PO Value", value: data.purchaseOrders.totalValue, color: "#3b82f6" },
                ]}
              />
              <DonutCard
                title="Material Requests by Status"
                icon={Send}
                accentColor="#4f46e5"
                isDark={isDark}
                glassStyle={gp}
                formatValue={(n) => `${n}`}
                data={[
                  { name: "Pending", value: data.materialRequests.pending, color: "#f59e0b" },
                  { name: "Approved", value: data.materialRequests.approved, color: "#10b981" },
                  { name: "Ordered", value: data.materialRequests.ordered, color: "#8b5cf6" },
                  { name: "Partially Ordered", value: data.materialRequests.partiallyOrdered, color: "#a855f7" },
                  { name: "Draft", value: data.materialRequests.draft, color: "#94a3b8" },
                ]}
              />
            </div>
            <div className="mt-4">
              <TrendCard
                title="GRN & PO Value — Last 14 Days"
                icon={TrendingUp}
                accentColor="#10b981"
                isDark={isDark}
                glassStyle={gp}
                data={data.timeline}
                series={[
                  { key: "grn", name: "GRN", color: "#10b981" },
                  { key: "po", name: "PO", color: "#3b82f6" },
                ]}
              />
            </div>
          </MaterialSection>
        )}

        {/* Recent GRNs + Recent POs */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent GRNs */}
          <div className="rounded-xl overflow-hidden" style={gp}>
            <div className="px-4 py-3 border-b" style={{borderColor:"rgba(16,185,129,0.12)"}}>
              <SectionHeader
                icon={Truck}
                title="Recent GRNs"
                sub="Last 6 goods receipts"
                action="View all"
                onAction={() => navigate("/material/grn")}
                accentColor="#2563eb"
                compact
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
          <div className="rounded-xl overflow-hidden" style={gp}>
            <div className="px-4 py-3 border-b" style={{borderColor:"rgba(16,185,129,0.12)"}}>
              <SectionHeader
                icon={ShoppingCart}
                title="Recent Purchase Orders"
                sub="Last 6 POs"
                action="View all"
                onAction={() => navigate("/material/purchase-order")}
                accentColor="#d97706"
                compact
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

        {/* Recent Expense Bookings */}
        <div className="rounded-xl overflow-hidden" style={gp}>
          <div className="px-4 py-3 border-b" style={{borderColor:"rgba(16,185,129,0.12)"}}>
            <SectionHeader
              icon={Receipt}
              title="Recent Expense Bookings"
              sub="Last 6 entries"
              action="View all"
              onAction={() => navigate("/material/expense-booking")}
              accentColor="#dc2626"
              compact
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

        {/* Recent Issues + Recent Requests */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Material Issues */}
          <div className="rounded-xl overflow-hidden" style={gp}>
            <div className="px-4 py-3 border-b" style={{borderColor:"rgba(16,185,129,0.12)"}}>
              <SectionHeader
                icon={PackageCheck}
                title="Recent Material Issues"
                sub="Last 6 issues"
                action="View all"
                onAction={() => navigate("/material/issues")}
                accentColor="#ea580c"
                compact
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentIssues.length ? (
              <EmptyState label="No material issues yet" />
            ) : (
              <DataTable
                data={data.recentIssues}
                columns={ISSUE_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent issues."
              />
            )}
          </div>

          {/* Recent Material Requests */}
          <div className="rounded-xl overflow-hidden" style={gp}>
            <div className="px-4 py-3 border-b" style={{borderColor:"rgba(16,185,129,0.12)"}}>
              <SectionHeader
                icon={Send}
                title="Recent Material Requests"
                sub="Last 6 requests"
                action="View all"
                onAction={() => navigate("/material/material-request")}
                accentColor="#4f46e5"
                compact
              />
            </div>
            {isLoading ? (
              <TableSkeleton rows={4} cols={4} />
            ) : !data?.recentRequests.length ? (
              <EmptyState label="No material requests yet" />
            ) : (
              <DataTable
                data={data.recentRequests}
                columns={REQUEST_DASH_COLS}
                searchable={false}
                paginated={false}
                emptyMessage="No recent requests."
              />
            )}
          </div>
        </div>

        {/* PO Status Breakdown + Material Requests Breakdown + Top Items */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* PO Status Breakdown */}
          <div className="rounded-xl p-5" style={gp}>
            <SectionHeader
              icon={ShoppingCart}
              title="PO Status Breakdown"
              onAction={() => navigate("/material/purchase-order")}
              accentColor="#d97706"
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

          {/* Material Requests Breakdown */}
          <div className="rounded-xl p-5" style={gp}>
            <SectionHeader
              icon={Send}
              title="Material Requests"
              sub="by status"
              action="View all"
              onAction={() => navigate("/material/material-request")}
              accentColor="#4f46e5"
            />
            {isLoading ? (
              <div className="space-y-2 animate-pulse">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-5 bg-muted rounded" />
                ))}
              </div>
            ) : data ? (
              <div className="space-y-2">
                {[
                  {
                    label: "Pending",
                    count: data.materialRequests.pending,
                    color: "bg-amber-500",
                  },
                  {
                    label: "Approved",
                    count: data.materialRequests.approved,
                    color: "bg-emerald-500",
                  },
                  {
                    label: "Ordered",
                    count: data.materialRequests.ordered,
                    color: "bg-violet-500",
                  },
                  {
                    label: "Partially Ordered",
                    count: data.materialRequests.partiallyOrdered,
                    color: "bg-purple-500",
                  },
                  {
                    label: "Draft",
                    count: data.materialRequests.draft,
                    color: "bg-slate-400",
                  },
                ].map(({ label, count, color }) => {
                  const total = data.materialRequests.total || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div
                      key={label}
                      className="space-y-0.5 cursor-pointer group rounded-md px-1 py-0.5 -mx-1 hover:bg-muted/60 transition-colors"
                      onClick={() =>
                        navigate(`/material/material-request?status=${label}`)
                      }
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-medium group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          {label}
                        </span>
                        <span className="text-muted-foreground">
                          {count} · {pct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${color} transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground pt-1">
                  {data.materialRequests.thisMonth} this month ·{" "}
                  {data.materialRequests.total} total
                </p>
              </div>
            ) : null}
          </div>

          {/* Top Items */}
          <div className="rounded-xl p-5" style={gp}>
            <SectionHeader icon={Package} title="Top Items by Receipts" accentColor="#059669" />
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

        {/* Quick Actions */}
        <div className="rounded-xl p-5" style={gp}>
          <SectionHeader icon={BarChart3} title="Quick Actions" accentColor="#10b981" />
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {[
              { label: "New GRN",          icon: Truck,         path: "/material/grn",               color: "#2563eb" },
              { label: "Purchase Order",   icon: ShoppingCart,  path: "/material/purchase-order",    color: "#d97706" },
              { label: "Issues",           icon: PackageCheck,  path: "/material/issues",            color: "#ea580c" },
              { label: "Material Request", icon: Send,          path: "/material/material-request",  color: "#4f46e5" },
              { label: "Expense Booking",  icon: Receipt,       path: "/material/expense-booking",   color: "#dc2626" },
              { label: "UOM Master",       icon: Ruler,         path: "/material/uom",               color: "#059669" },
              { label: "Inventory",        icon: ClipboardList, path: "/material/inventory-master",  color: "#0d9488" },
              { label: "T&C Master",       icon: FileText,      path: "/material/t-c-master",        color: "#7c3aed" },
            ].map(({ label, icon: Icon, path, color }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="group flex flex-col items-center gap-3 py-5 rounded-xl transition-all duration-200 active:scale-95"
                style={{
                  background: isDark ? `${color}0A` : `${color}08`,
                  border: `1px solid ${color}25`,
                }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = `${color}18`; el.style.borderColor = `${color}40`; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = isDark ? `${color}0A` : `${color}08`; el.style.borderColor = `${color}25`; }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{ background: `${color}20`, border: `1px solid ${color}35` }}
                >
                  <Icon size={18} style={{ color }} />
                </div>
                <span className="text-xs font-medium text-center leading-tight" style={{ color: isDark ? "#cbd5e1" : "#475569" }}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </MaterialShell>

      {/* ── Unified Modal ── */}
      <Dialog open={openModal !== null} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-4xl w-full p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-base font-heading">
              {openModal === "items" && (
                <>
                  <Package size={16} className="text-emerald-600" /> Item Master{" "}
                  {itemsData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({itemsData.length} items)
                    </span>
                  )}
                </>
              )}
              {openModal === "grns" && (
                <>
                  <Truck size={16} className="text-emerald-600" /> GRN List{" "}
                  {grnsData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({grnsData.length} records)
                    </span>
                  )}
                </>
              )}
              {openModal === "pos" && (
                <>
                  <ShoppingCart size={16} className="text-amber-600" /> Open
                  Purchase Orders{" "}
                  {posData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({posData.length} records)
                    </span>
                  )}
                </>
              )}
              {openModal === "expenses" && (
                <>
                  <Receipt size={16} className="text-red-600" /> Expenses{" "}
                  {expensesData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({expensesData.length} records)
                    </span>
                  )}
                </>
              )}
              {openModal === "stock" && (
                <>
                  <Layers size={16} className="text-teal-600" /> Stock Transfers{" "}
                  {stockData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({stockData.length} records)
                    </span>
                  )}
                </>
              )}
              {openModal === "issues" && (
                <>
                  <PackageCheck size={16} className="text-orange-600" />{" "}
                  Material Issues{" "}
                  {issuesData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({issuesData.length} records)
                    </span>
                  )}
                </>
              )}
              {openModal === "requests" && (
                <>
                  <Send size={16} className="text-indigo-600" /> Material
                  Requests{" "}
                  {requestsData && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      ({requestsData.length} records)
                    </span>
                  )}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            {/* Items */}
            {openModal === "items" &&
              (itemsLoading ? (
                <TableSkeleton rows={6} cols={6} />
              ) : !itemsData?.length ? (
                <EmptyState label="No items found" />
              ) : (
                <DataTable
                  data={itemsData}
                  columns={ITEMS_MODAL_COLS}
                  searchable
                  paginated
                  emptyMessage="No items found."
                />
              ))}
            {/* GRNs */}
            {openModal === "grns" &&
              (grnsLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !grnsData?.length ? (
                <EmptyState label="No GRNs found" />
              ) : (
                <DataTable
                  data={grnsData}
                  columns={GRN_DASH_COLS}
                  searchable
                  paginated
                  emptyMessage="No GRNs found."
                />
              ))}
            {/* Purchase Orders */}
            {openModal === "pos" &&
              (posLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !posData?.length ? (
                <EmptyState label="No open purchase orders" />
              ) : (
                <DataTable
                  data={posData}
                  columns={PO_DASH_COLS}
                  searchable
                  paginated
                  emptyMessage="No purchase orders found."
                />
              ))}
            {/* Expenses */}
            {openModal === "expenses" &&
              (expensesLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !expensesData?.length ? (
                <EmptyState label="No pending expenses" />
              ) : (
                <DataTable
                  data={expensesData}
                  columns={EXP_DASH_COLS}
                  searchable
                  paginated
                  emptyMessage="No expenses found."
                />
              ))}
            {/* Stock */}
            {openModal === "stock" &&
              (stockLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !stockData?.length ? (
                <EmptyState label="No stock transfers found" />
              ) : (
                <DataTable
                  data={stockData}
                  columns={[
                    {
                      accessorKey: "DocNo",
                      header: "Doc No",
                      cell: ({ getValue }: any) => (
                        <span className="font-mono text-xs text-teal-600 dark:text-teal-400">
                          {(getValue() as string) || "—"}
                        </span>
                      ),
                    },
                    {
                      accessorKey: "TransferDate",
                      header: "Date",
                      cell: ({ getValue }: any) => (
                        <span className="text-xs text-muted-foreground">
                          {fmtDate(getValue() as string)}
                        </span>
                      ),
                    },
                    {
                      accessorKey: "FromGodownName",
                      header: "From Godown",
                      cell: ({ getValue }: any) => (
                        <span className="text-xs font-medium">
                          {(getValue() as string) || "—"}
                        </span>
                      ),
                    },
                    {
                      accessorKey: "ToGodownName",
                      header: "To Godown",
                      cell: ({ getValue }: any) => (
                        <span className="text-xs font-medium">
                          {(getValue() as string) || "—"}
                        </span>
                      ),
                    },
                    {
                      accessorKey: "TransferItems",
                      header: "Items",
                      cell: ({ getValue }: any) => {
                        const items = getValue();
                        const arr = Array.isArray(items)
                          ? items
                          : typeof items === "string" && items.trim()
                            ? (() => { try { return JSON.parse(items); } catch { return []; } })()
                            : [];
                        return (
                          <span className="text-xs text-muted-foreground">
                            {arr.length} {arr.length === 1 ? "item" : "items"}
                          </span>
                        );
                      },
                    },
                    {
                      accessorKey: "Status",
                      header: "Status",
                      cell: ({ getValue }: any) => {
                        const v = (getValue() as string) || "";
                        const color =
                          v === "Approved" ? "text-emerald-600 dark:text-emerald-400"
                          : v === "Pending" ? "text-amber-600 dark:text-amber-400"
                          : v === "Rejected" ? "text-red-500"
                          : "text-muted-foreground";
                        return <span className={`text-xs font-semibold ${color}`}>{v || "—"}</span>;
                      },
                    },
                    {
                      accessorKey: "CreatedBy",
                      header: "Created By",
                      cell: ({ getValue }: any) => (
                        <span className="text-xs text-muted-foreground">
                          {(getValue() as string) || "—"}
                        </span>
                      ),
                    },
                  ]}
                  searchable
                  paginated
                  emptyMessage="No stock transfers found."
                />
              ))}
            {/* Issues */}
            {openModal === "issues" &&
              (issuesLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !issuesData?.length ? (
                <EmptyState label="No material issues found" />
              ) : (
                <DataTable
                  data={issuesData}
                  columns={ISSUE_DASH_COLS}
                  searchable
                  paginated
                  emptyMessage="No issues found."
                />
              ))}
            {/* Requests */}
            {openModal === "requests" &&
              (requestsLoading ? (
                <TableSkeleton rows={6} cols={5} />
              ) : !requestsData?.length ? (
                <EmptyState label="No pending requests found" />
              ) : (
                <DataTable
                  data={requestsData}
                  columns={REQUEST_DASH_COLS}
                  searchable
                  paginated
                  emptyMessage="No requests found."
                />
              ))}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
