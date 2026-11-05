import type React from "react";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getWidgetCatalog,
  getWidgetsDashboard,
  getWidgetMetricsCatalog,
  getWidgetMetric,
  type WidgetCatalogItem,
  type WidgetsDashboardData,
  type WidgetMetricDef,
  type WidgetMetricData,
} from "@/api/widgetsApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getPendingVehicleSummary,
  type PendingVehicleInOutSummary,
} from "@/api/vehicleInOutApi";
import { getEnterprisesByType, type Enterprise } from "@/api/enterpriseApi";
import {
  Puzzle,
  BarChart2,
  TrendingUp,
  PieChart,
  Hash,
  Table2,
  Calendar,
  Bell,
  MessageSquare,
  Map as MapIcon,
  Paperclip,
  RefreshCw,
  Calculator,
  Truck,
  Search,
  ChevronDown,
  Database,
  X,
} from "lucide-react";

// ─── CATEGORY COLORS — the catalog already carries a `category` per widget
// (from dbo.WidgetCatalog) that the old flat grid never used at all. Color-
// coding by category turns that into a real scanning aid without needing
// literal grouped sections, which would look sparse — most categories here
// only have 1-2 widgets.
const CATEGORY_COLORS: Record<string, string> = {
  Charts: "#6366f1",
  KPIs: "#f59e0b",
  Data: "#3b82f6",
  Planning: "#10b981",
  Alerts: "#ef4444",
  Activity: "#a855f7",
  Geo: "#06b6d4",
  Tools: "#ec4899",
};
const DEFAULT_CATEGORY_COLOR = "#3b82f6";

// ─── WIDGET REGISTRY — single source of truth ─────────────────────────────────
// key must exactly match what WidgetsRights.tsx stores in the DB
const widgetIcons: Record<string, React.ElementType> = {
  "bar-chart-2": BarChart2,
  "trending-up": TrendingUp,
  "pie-chart": PieChart,
  hash: Hash,
  "table-2": Table2,
  calendar: Calendar,
  bell: Bell,
  "message-square": MessageSquare,
  map: MapIcon,
  paperclip: Paperclip,
  "refresh-cw": RefreshCw,
  calculator: Calculator,
  truck: Truck,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtCur = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const fmtTime = (s: string) => {
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
};

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATA-SOURCE CONNECTION — lets Bar/Line/Pie/Stat Card widgets be pointed at
// real Finance/Material/Engineering/CRM metrics (backend/routes/
// widgetMetrics.js) instead of only the one fixed task/user dataset. Falls
// back to each widget's original hardcoded data when nothing is selected,
// so this is additive — no existing behavior changes until a user picks one.
// ═══════════════════════════════════════════════════════════════════════════════

const MODULE_COLORS: Record<string, string> = {
  Finance: "#6366f1",
  Material: "#10b981",
  Engineering: "#f97316",
  CRM: "#a855f7",
};

/** Persists which metric a given widget instance is pointed at — same
 * localStorage-based per-browser persistence convention already used for
 * draft-form state elsewhere in this app (see src/hooks/useDraftForm.ts). */
function useMetricSelection(widgetKey: string) {
  const storageKey = `widget-metric:${widgetKey}`;
  const [metricKey, setMetricKeyState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const setMetricKey = (key: string | null) => {
    setMetricKeyState(key);
    try {
      if (key) localStorage.setItem(storageKey, key);
      else localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable — selection just won't persist across reloads.
    }
  };
  return [metricKey, setMetricKey] as const;
}

function useMetricsCatalog() {
  const { data = [], isLoading } = useQuery<WidgetMetricDef[]>({
    queryKey: ["widget-metrics-catalog"],
    queryFn: getWidgetMetricsCatalog,
    staleTime: 10 * 60 * 1000,
  });
  return { metrics: data, loading: isLoading };
}

function useMetricData(metricKey: string | null) {
  const { data, isLoading, isError } = useQuery<WidgetMetricData>({
    queryKey: ["widget-metric", metricKey],
    queryFn: () => getWidgetMetric(metricKey as string),
    enabled: !!metricKey,
    staleTime: 60_000,
  });
  return { metric: data, loading: isLoading, error: isError };
}

/** Dropdown that lets a widget be pointed at any catalog metric of the
 * given `type` (only metrics that widget can actually render), grouped by
 * module so "which Finance metric" etc. is easy to scan. */
function MetricPicker({
  type,
  value,
  onChange,
}: {
  type: WidgetMetricDef["type"];
  value: string | null;
  onChange: (key: string | null) => void;
}) {
  const { metrics, loading } = useMetricsCatalog();
  const options = metrics.filter((m) => m.type === type);
  const byModule = new Map<string, WidgetMetricDef[]>();
  for (const m of options) {
    if (!byModule.has(m.module)) byModule.set(m.module, []);
    byModule.get(m.module)!.push(m);
  }
  const selected = options.find((m) => m.key === value);

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 mb-2">
        <Database size={11} className="text-muted-foreground/60" />
        <span className="text-[0.625rem] font-heading font-semibold uppercase tracking-widest text-muted-foreground/60">
          Data Source
        </span>
      </div>
      <div className="relative">
        <select
          value={value ?? ""}
          disabled={loading}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full appearance-none h-8 pl-2.5 pr-7 rounded-lg border border-border bg-card/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors disabled:opacity-50"
        >
          <option value="">Default (built-in)</option>
          {Array.from(byModule.entries()).map(([mod, opts]) => (
            <optgroup key={mod} label={mod}>
              {opts.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown
          size={12}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
      {selected && (
        <span
          className="inline-block mt-1.5 text-[0.5625rem] font-heading font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-full"
          style={{
            color: MODULE_COLORS[selected.module] || DEFAULT_CATEGORY_COLOR,
            background: `${MODULE_COLORS[selected.module] || DEFAULT_CATEGORY_COLOR}14`,
          }}
        >
          {selected.module}
        </span>
      )}
    </div>
  );
}

// ─── WIDGET DATA HOOK ─────────────────────────────────────────────────────────
function useWidgetsData() {
  const { data, isLoading } = useQuery<WidgetsDashboardData>({
    queryKey: ["widgets-dashboard"],
    queryFn: getWidgetsDashboard,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  return { data, loading: isLoading };
}

function useWidgetCatalog() {
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery<WidgetCatalogItem[]>({
    queryKey: ["widget-catalog"],
    queryFn: getWidgetCatalog,
    staleTime: 5 * 60 * 1000,
  });

  return { catalog: data, loading: isLoading, error: isError };
}

// ─── ALLOWED WIDGETS HOOK — fetches from DB via /api/user-widget-rights/my ───
function useAllowedWidgets() {
  const { data, isLoading, isError } = useQuery<{ allowedWidgets: string[] }>({
    queryKey: ["user-widget-rights-my"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/user-widget-rights/my");
      if (!res.ok) throw new Error("Failed to load widget rights");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000, // re-fetch every 5 min
    retry: false, // don't retry on 404 — graceful fallback
  });

  // While loading, show nothing (avoids flash of all widgets then filtered)
  if (isLoading) return { allowedSet: null, loading: true };
  // On error, return null so the catalog falls back to showing everything
  if (isError) return { allowedSet: null, loading: false, error: true };
  const allowed = data?.allowedWidgets ?? [];
  return { allowedSet: new Set(allowed), loading: false, error: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET COMPONENTS (unchanged from original — data layer is the same)
// ═══════════════════════════════════════════════════════════════════════════════

function BarChartWidget() {
  const [metricKey, setMetricKey] = useMetricSelection("bar-chart-2");
  const { metric, loading: metricLoading } = useMetricData(metricKey);
  const { data, loading } = useWidgetsData();

  const connected = metricKey && metric?.type === "timeseries";
  const fmtVal = connected && metric.unit === "currency" ? fmtCur : fmtNum;

  const flow = data?.trends?.dailyFlow || [];
  const fallbackItems = flow.length
    ? flow.map((f: any) => ({ label: f.date?.slice(5) || "—", value: f.activityCount || 0 }))
    : [{ label: "No data", value: 0 }];

  const items = connected
    ? metric.labels.map((d, i) => ({ label: d.slice(5), value: metric.series[0]?.data[i] ?? 0 }))
    : fallbackItems;
  const seriesLabel = connected ? metric.series[0]?.name : "System activity — last 7 days";
  const max = Math.max(...items.map((d) => d.value), 1);
  const showLoading = connected ? metricLoading : loading;

  return (
    <div className="space-y-4">
      <MetricPicker type="timeseries" value={metricKey} onChange={setMetricKey} />
      {showLoading ? (
        <Spinner />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{seriesLabel}</p>
          <div className="flex items-end gap-2 h-44">
            {items.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[0.625rem] text-muted-foreground">
                  {connected ? fmtVal(d.value) : d.value}
                </span>
                <div
                  className="w-full rounded-t-md bg-primary/70 hover:bg-primary transition-all"
                  style={{ height: `${Math.max(4, (d.value / max) * 140)}px` }}
                />
                <span className="text-[0.625rem] text-muted-foreground">{d.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Total: {fmtVal(items.reduce((s, d) => s + d.value, 0))}
            {!connected && " actions"}
          </p>
        </>
      )}
    </div>
  );
}

function LineChartWidget() {
  const [metricKey, setMetricKey] = useMetricSelection("trending-up");
  const { metric, loading: metricLoading } = useMetricData(metricKey);
  const { data, loading } = useWidgetsData();

  const connected = metricKey && metric?.type === "timeseries";
  const fmtVal = connected && metric.unit === "currency" ? fmtCur : fmtNum;

  const flow = data?.trends?.dailyFlow || [];
  const fallbackSeries = [
    { name: "Activity", color: "#34d399", data: flow.map((f: any) => f.activityCount || 0) },
    { name: "Tasks", color: "#818cf8", data: flow.map((f: any) => f.tasksCreated || 0) },
  ];
  const labels = connected ? metric.labels : flow.map((f: any) => f.date || "—");
  const series = connected
    ? metric.series.map((s, i) => ({ ...s, color: s.color || ["#34d399", "#818cf8"][i % 2] }))
    : fallbackSeries;
  const title = connected ? metric.label : "Tasks vs Activity — 7 days";
  const showLoading = connected ? metricLoading : loading;

  if (showLoading) return <Spinner />;
  if (!labels.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No trend data.
      </p>
    );

  const shortLabels = labels.map((d) => d.slice(5));
  const W = 300,
    H = 150,
    pad = 20;
  const maxVal = Math.max(...series.flatMap((s) => s.data), 1);
  const px = (i: number) =>
    pad + (i / Math.max(shortLabels.length - 1, 1)) * (W - pad * 2);
  const py = (v: number) => H - pad - (v / maxVal) * (H - pad * 2);
  return (
    <div className="space-y-3">
      <MetricPicker type="timeseries" value={metricKey} onChange={setMetricKey} />
      <p className="text-sm text-muted-foreground">{title}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <line
            key={r}
            x1={pad}
            y1={py(maxVal * r)}
            x2={W - pad}
            y2={py(maxVal * r)}
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeDasharray="4 4"
          />
        ))}
        {series.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={s.data.map((v, i) => `${px(i)},${py(v)}`).join(" ")}
          />
        ))}
        {shortLabels.map((label, i) => (
          <g key={i}>
            {series.map((s) => (
              <circle key={s.name} cx={px(i)} cy={py(s.data[i] ?? 0)} r="3" fill={s.color} />
            ))}
            <text
              x={px(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize="9"
              fill="currentColor"
              opacity="0.5"
            >
              {label}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 justify-center text-xs">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1">
            <span
              className="w-3 h-0.5 inline-block rounded"
              style={{ background: s.color }}
            />
            {s.name}
            {connected && (
              <span className="text-muted-foreground/60">
                ({fmtVal(s.data.reduce((a, b) => a + b, 0))})
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

function PieChartWidget() {
  const [metricKey, setMetricKey] = useMetricSelection("pie-chart");
  const { metric, loading: metricLoading } = useMetricData(metricKey);
  const { data, loading } = useWidgetsData();

  const connected = metricKey && metric?.type === "breakdown";
  const fmtVal = connected && metric.unit === "currency" ? fmtCur : (n: number) => String(n);

  const s = data?.summary;
  const fallbackSlices = [
    { label: "Open", value: s?.openTasks || 0, color: "#60a5fa" },
    { label: "In Progress", value: s?.inProgressTasks || 0, color: "#a78bfa" },
    { label: "Closed", value: s?.closedTasks || 0, color: "#34d399" },
    { label: "Reviewed", value: s?.reviewedTasks || 0, color: "#2dd4bf" },
  ].filter((sl) => sl.value > 0);

  const slices = connected
    ? metric.slices.filter((sl) => sl.value > 0).map((sl) => ({ label: sl.name, value: sl.value, color: sl.color }))
    : fallbackSlices;
  const totalLabel = connected ? metric.label : "Total";
  const showLoading = connected ? metricLoading : loading;

  if (showLoading) return <Spinner />;

  const total = slices.reduce((acc, sl) => acc + sl.value, 0);
  if (!total)
    return (
      <div className="space-y-3">
        <MetricPicker type="breakdown" value={metricKey} onChange={setMetricKey} />
        <p className="text-sm text-muted-foreground text-center py-10">
          No data available.
        </p>
      </div>
    );
  let cum = 0;
  const paths = slices.map((sl) => {
    const pct = sl.value / total,
      start = cum,
      end = cum + pct;
    cum = end;
    const a1 = (start * 2 - 0.5) * Math.PI,
      a2 = (end * 2 - 0.5) * Math.PI;
    const r = 70,
      cx = 90,
      cy = 90;
    return {
      d: `M${cx},${cy} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z`,
      ...sl,
    };
  });
  return (
    <div className="space-y-4">
      <MetricPicker type="breakdown" value={metricKey} onChange={setMetricKey} />
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <svg viewBox="0 0 180 180" className="w-36 h-36 shrink-0">
          {paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.color} opacity="0.85" />
          ))}
        </svg>
        <div className="space-y-2">
          {slices.map((sl) => (
            <div key={sl.label} className="flex items-center gap-2 text-sm">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: sl.color }}
              />
              <span className="text-muted-foreground">{sl.label}</span>
              <span className="font-bold ml-auto">{fmtVal(sl.value)}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            {connected ? totalLabel : `Total: ${total} tasks`}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatCardWidget() {
  const [metricKey, setMetricKey] = useMetricSelection("hash");
  const { metric, loading: metricLoading } = useMetricData(metricKey);
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const connected = metricKey && metric?.type === "stat";
  const cards = [
    {
      label: "Total Users",
      value: fmtNum(s?.totalUsers || 0),
      color: "text-blue-400",
    },
    {
      label: "Total Activity",
      value: fmtNum(s?.totalActivity || 0),
      color: "text-violet-400",
    },
    {
      label: "Open Tasks",
      value: fmtNum(s?.openTasks || 0),
      color: "text-amber-400",
    },
    {
      label: "Total Payments",
      value: fmtCur(s?.paymentAmountTotal || 0),
      color: "text-emerald-400",
    },
    {
      label: "Active Leads",
      value: fmtNum(s?.totalLeads || 0),
      color: "text-rose-400",
    },
    {
      label: "Pending Follow-Ups",
      value: fmtNum(s?.pendingFollowups || 0),
      color: "text-orange-400",
    },
    {
      label: "CRM Bookings",
      value: fmtNum(s?.activeCrmBookings || 0),
      color: "text-cyan-400",
    },
    {
      label: "CRM Overdue Payments",
      value: fmtNum(s?.crmOverduePayments || 0),
      color: "text-red-400",
    },
  ];
  return (
    <div className="space-y-4">
      <MetricPicker type="stat" value={metricKey} onChange={setMetricKey} />
      {connected && (
        metricLoading ? (
          <Spinner />
        ) : metric?.type === "stat" ? (
          <div
            className="rounded-xl p-4 space-y-1"
            style={{
              background: `${MODULE_COLORS[metric.module] || DEFAULT_CATEGORY_COLOR}12`,
              border: `1px solid ${MODULE_COLORS[metric.module] || DEFAULT_CATEGORY_COLOR}30`,
            }}
          >
            <p className="text-xs text-muted-foreground">{metric.label}</p>
            <p
              className="text-3xl font-bold font-heading"
              style={{ color: MODULE_COLORS[metric.module] || DEFAULT_CATEGORY_COLOR }}
            >
              {metric.format === "currency" ? fmtCur(metric.value) : fmtNum(metric.value)}
            </p>
          </div>
        ) : null
      )}
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="bg-muted/20 rounded-xl p-3 space-y-1">
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function DataTableWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const tasks = data?.recent?.tasks || [];
  if (!tasks.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No tasks found.
      </p>
    );
  const colors: Record<string, string> = {
    High: "text-red-400",
    Medium: "text-amber-400",
    Low: "text-emerald-400",
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Recent Tasks
      </p>
      <div className="divide-y divide-border">
        {tasks.slice(0, 5).map((t: any) => (
          <div
            key={t.id}
            className="py-2 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.assignedToName || "Unassigned"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-xs font-semibold ${colors[t.priority] || "text-muted-foreground"}`}
              >
                {t.priority}
              </span>
              <span className="text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                {t.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarWidget() {
  const today = new Date();
  const [cur, setCur] = useState(today);
  const year = cur.getFullYear(),
    month = cur.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) =>
    i < first ? null : i - first + 1,
  );
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCur(new Date(year, month - 1, 1))}
          className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
        >
          ‹
        </button>
        <p className="text-sm font-bold">
          {cur.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </p>
        <button
          onClick={() => setCur(new Date(year, month + 1, 1))}
          className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span
            key={i}
            className="text-[0.625rem] text-muted-foreground font-medium py-1"
          >
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            className={`text-xs py-1 rounded-md font-medium transition-colors
            ${
              d === today.getDate() &&
              month === today.getMonth() &&
              year === today.getFullYear()
                ? "bg-primary text-primary-foreground"
                : d
                  ? "hover:bg-muted/40 text-foreground cursor-pointer"
                  : ""
            }`}
          >
            {d || ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const alerts = data?.alerts || [];
  if (!alerts.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No alerts at this time.
      </p>
    );
  const colors: Record<string, string> = {
    critical: "text-red-400 bg-red-400/10",
    warning: "text-amber-400 bg-amber-400/10",
    info: "text-blue-400 bg-blue-400/10",
  };
  return (
    <div className="space-y-2">
      {alerts.slice(0, 4).map((a: any, i: number) => (
        <div
          key={i}
          className={`flex gap-3 p-3 rounded-lg ${colors[a.type] || "text-muted-foreground bg-muted/20"}`}
        >
          <div className="shrink-0 mt-0.5">
            {a.type === "critical" ? "🔴" : a.type === "warning" ? "⚠️" : "ℹ️"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{a.title}</p>
            <p className="text-xs opacity-80 mt-0.5">{a.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeedWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const activity = data?.recent?.activity || [];
  if (!activity.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No recent activity.
      </p>
    );
  return (
    <div className="space-y-2">
      {activity.slice(0, 5).map((a: any, i: number) => (
        <div key={i} className="flex items-start gap-2 py-1.5">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {a.userName?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div className="min-w-0">
            <p className="text-xs">
              <span className="font-semibold">{a.userName}</span>{" "}
              {a.event?.toLowerCase()}
            </p>
            <p className="text-[0.625rem] text-muted-foreground">
              {fmtTime(a.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MAP VIEW WIDGET ─────────────────────────────────────────────────────────
// Plots each project (enterprise rows with business_type="P") as a marker on
// an OpenStreetMap tile layer via Leaflet — free, no API key. Projects that
// already have Latitude/Longitude use those directly; projects with only a
// free-text Address are geocoded client-side through Nominatim (OSM's free
// geocoder, results cached in-memory + rate-limited to its ~1 req/sec fair
// use policy). Projects with neither are skipped.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();
let geocodeQueue: Promise<unknown> = Promise.resolve();
// Stable references for useQuery's default value — `data: x = []` would
// otherwise hand back a brand-new array every render while data is still
// undefined, which retriggers any effect depending on it every render and
// spins into "Maximum update depth exceeded".
const EMPTY_ENTERPRISES: Enterprise[] = [];

interface ProjectMarker {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  companyName: string | null;
  lat: number;
  lng: number;
}

async function nominatimSearch(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    );
    const results = await res.json();
    const hit = results?.[0];
    return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(addr)) return Promise.resolve(geocodeCache.get(addr)!);
  // Nominatim's fair-use policy caps this at ~1 req/sec — chain requests
  // through a single queue (with a trailing delay) so a widget with many
  // un-geocoded projects doesn't fire them all at once. Each lookup is
  // capped at 6s so one slow/unresolvable address can't stall the rest.
  const run = geocodeQueue.then(async () => {
    let coords: { lat: number; lng: number } | null = null;
    // Informal local addresses (e.g. "RATHTOLA EM BYPASS") often only
    // resolve once the leading, non-geographic word is dropped — try the
    // full string first, then progressively fewer leading words.
    const words = addr.split(/\s+/).filter(Boolean);
    const attempts = Math.min(words.length, 4);
    for (let drop = 0; drop < attempts; drop++) {
      coords = await nominatimSearch(words.slice(drop).join(" "));
      if (coords || drop === words.length - 1) break;
      await new Promise((r) => setTimeout(r, 1100));
    }
    geocodeCache.set(addr, coords);
    await new Promise((r) => setTimeout(r, 1100));
    return coords;
  });
  geocodeQueue = run.catch(() => null);
  return run;
}

function useProjectMarkers() {
  const [markers, setMarkers] = useState<ProjectMarker[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeFailedCount, setGeocodeFailedCount] = useState(0);

  const { data: projects = EMPTY_ENTERPRISES, isLoading } = useQuery({
    queryKey: ["map-widget-projects"],
    queryFn: () => getEnterprisesByType("P"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: companies = EMPTY_ENTERPRISES } = useQuery({
    queryKey: ["map-widget-companies"],
    queryFn: () => getEnterprisesByType("C"),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (projects.length === 0) {
      setMarkers([]);
      return;
    }
    let alive = true;
    const companyName = (id: number | null) =>
      id ? (companies.find((c) => c.id === id)?.name ?? null) : null;

    const withCoords: ProjectMarker[] = [];
    const needsGeocode: typeof projects = [];
    for (const p of projects) {
      if (p.latitude != null && p.longitude != null) {
        withCoords.push({
          id: p.id,
          name: p.name || `Project #${p.id}`,
          address: p.address,
          city: p.city,
          state: p.state,
          status: p.status,
          companyName: companyName(p.belongs_to),
          lat: Number(p.latitude),
          lng: Number(p.longitude),
        });
      } else if (p.address || p.city) {
        needsGeocode.push(p);
      }
    }

    setMarkers(withCoords);
    if (needsGeocode.length === 0) return;

    setGeocoding(true);
    Promise.all(
      needsGeocode.map(async (p) => {
        const addr = [p.address, p.city, p.state, p.country]
          .filter(Boolean)
          .join(", ");
        if (!addr) return null;
        const coords = await geocodeAddress(addr);
        if (!coords) return null;
        return {
          id: p.id,
          name: p.name || `Project #${p.id}`,
          address: p.address,
          city: p.city,
          state: p.state,
          status: p.status,
          companyName: companyName(p.belongs_to),
          lat: coords.lat,
          lng: coords.lng,
        } as ProjectMarker;
      }),
    ).then((geocoded) => {
      if (!alive) return;
      setMarkers([
        ...withCoords,
        ...geocoded.filter((m): m is ProjectMarker => m !== null),
      ]);
      setGeocodeFailedCount(geocoded.filter((m) => m === null).length);
      setGeocoding(false);
    });

    return () => {
      alive = false;
    };
  }, [projects, companies]);

  return { markers, loading: isLoading, geocoding, geocodeFailedCount };
}

// Leaflet's default marker icon references image files by URL, which
// bundlers like Vite don't resolve automatically — point them at a CDN
// (same approach the Leaflet docs recommend for bundled apps) once, at
// module load.
let leafletIconPatched = false;
function patchLeafletIcon(L: typeof import("leaflet")) {
  if (leafletIconPatched) return;
  leafletIconPatched = true;
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

function MapViewWidget() {
  const { markers, geocoding, geocodeFailedCount } = useProjectMarkers();
  const [LeafletMod, setLeafletMod] = useState<{
    L: typeof import("leaflet");
    RL: typeof import("react-leaflet");
  } | null>(null);

  useEffect(() => {
    Promise.all([import("leaflet"), import("react-leaflet")]).then(
      ([L, RL]) => {
        patchLeafletIcon(L);
        setLeafletMod({ L, RL });
      },
    );
  }, []);

  // Only block on a full-page spinner while nothing has resolved yet — once
  // at least one marker is ready, render the map and let the rest resolve
  // in the background (surfaced via the "Resolving…" note below instead).
  if (geocoding && markers.length === 0) return <Spinner />;

  if (!markers.length) {
    return (
      <div className="h-44 rounded-xl bg-muted/20 border border-border flex items-center justify-center">
        <div className="text-center space-y-2 px-4">
          <MapIcon size={32} className="text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {geocodeFailedCount > 0
              ? `Couldn't locate ${geocodeFailedCount} project address${geocodeFailedCount > 1 ? "es" : ""}`
              : "No project locations to show"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {geocodeFailedCount > 0
              ? "Try adding City/State to the project's address, or set GPS coordinates directly."
              : "Add an address or coordinates to a project to see it here."}
          </p>
        </div>
      </div>
    );
  }

  if (!LeafletMod) return <Spinner />;

  const { MapContainer, TileLayer, Marker, Popup } = LeafletMod.RL;
  const center: [number, number] = markers.length
    ? [markers[0].lat, markers[0].lng]
    : [22.5726, 88.3639]; // fallback: Kolkata

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden border border-border" style={{ height: 320 }}>
        <MapContainer
          center={center}
          zoom={markers.length > 1 ? 6 : 12}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markers.map((m) => (
            <Marker key={m.id} position={[m.lat, m.lng]}>
              <Popup>
                <div className="text-xs space-y-1 max-w-[200px]">
                  <p className="font-bold text-sm">{m.name}</p>
                  {m.companyName && <p>{m.companyName}</p>}
                  {(m.address || m.city) && (
                    <p>{[m.address, m.city, m.state].filter(Boolean).join(", ")}</p>
                  )}
                  {m.status && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[0.625rem] font-semibold">
                      {m.status}
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {geocoding && (
        <p className="text-[0.625rem] text-muted-foreground text-center">
          Resolving project addresses…
        </p>
      )}
    </div>
  );
}

function FileUploaderWidget() {
  const [files, setFiles] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const handle = (f: FileList | null) => {
    if (!f) return;
    setFiles((prev) =>
      [...prev, ...Array.from(f).map((x) => x.name)].slice(0, 5),
    );
  };
  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer
          ${drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
        onClick={() => document.getElementById("fw-input")?.click()}
      >
        <Paperclip size={24} className="text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Drop files here or click to upload
        </p>
        <input
          id="fw-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handle(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs bg-muted/20 rounded-lg px-3 py-2"
            >
              <span className="truncate text-muted-foreground">{f}</span>
              <button
                onClick={() =>
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }
                className="ml-2 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressRingWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const total = s?.totalTasks || 0;
  const done = (s?.closedTasks || 0) + (s?.reviewedTasks || 0);
  const inProg = s?.inProgressTasks || 0;
  const completion = total ? Math.round((done / total) * 100) : 0;
  const inProgPct = total ? Math.round((inProg / total) * 100) : 0;
  const userPct = s?.totalUsers
    ? Math.round((s.activeUsers / s.totalUsers) * 100)
    : 100;
  const Ring = ({
    pct,
    color,
    label,
  }: {
    pct: number;
    color: string;
    label: string;
  }) => {
    const r = 32,
      circ = 2 * Math.PI * r;
    return (
      <div className="flex flex-col items-center gap-2">
        <svg width="80" height="80" className="-rotate-90">
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${(pct / 100) * circ} ${circ}`}
            strokeLinecap="round"
          />
          <text
            x="40"
            y="40"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="currentColor"
            fontSize="13"
            fontWeight="bold"
            transform="rotate(90, 40, 40)"
          >
            {pct}%
          </text>
        </svg>
        <span className="text-xs text-muted-foreground text-center">
          {label}
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-around">
        <Ring pct={completion} color="#34d399" label="Tasks done" />
        <Ring pct={inProgPct} color="#a78bfa" label="In progress" />
        <Ring pct={userPct} color="#60a5fa" label="Users active" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="font-bold text-emerald-400">{done}</p>
          <p className="text-muted-foreground">Completed</p>
        </div>
        <div>
          <p className="font-bold text-violet-400">{inProg}</p>
          <p className="text-muted-foreground">In Progress</p>
        </div>
        <div>
          <p className="font-bold text-blue-400">{s?.activeUsers || 0}</p>
          <p className="text-muted-foreground">Active Users</p>
        </div>
      </div>
    </div>
  );
}

function CalculatorWidget() {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const press = (val: string) => {
    if (val === "C") {
      setDisplay("0");
      setPrev(null);
      setOp(null);
      setReset(false);
      return;
    }
    if (val === "±") {
      setDisplay((d) => String(-parseFloat(d) || 0));
      return;
    }
    if (val === "%") {
      setDisplay((d) => String(parseFloat(d) / 100));
      return;
    }
    if (["+", "−", "×", "÷"].includes(val)) {
      setPrev(display);
      setOp(val);
      setReset(true);
      return;
    }
    if (val === "=") {
      if (!prev || !op) return;
      const a = parseFloat(prev),
        b = parseFloat(display);
      const r =
        op === "+"
          ? a + b
          : op === "−"
            ? a - b
            : op === "×"
              ? a * b
              : b !== 0
                ? a / b
                : 0;
      setDisplay(String(parseFloat(r.toFixed(8))));
      setPrev(null);
      setOp(null);
      setReset(false);
      return;
    }
    if (val === ".") {
      if (reset) {
        setDisplay("0.");
        setReset(false);
        return;
      }
      if (!display.includes(".")) setDisplay((d) => d + ".");
      return;
    }
    if (reset) {
      setDisplay(val);
      setReset(false);
      return;
    }
    setDisplay((d) => (d === "0" ? val : d.length < 12 ? d + val : d));
  };
  const rows = [
    ["C", "±", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    [" ", "0", ".", "="],
  ];
  const isOp = (v: string) => ["+", "−", "×", "÷", "="].includes(v);
  const isFn = (v: string) => ["C", "±", "%"].includes(v);
  return (
    <div className="max-w-[220px] mx-auto space-y-3">
      <div className="bg-muted/30 rounded-xl p-4 text-right min-h-[72px]">
        {op && (
          <p className="text-xs text-muted-foreground">
            {prev} {op}
          </p>
        )}
        <p className="text-3xl font-bold tracking-tight truncate">{display}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-4 gap-2">
            {row.map((btn, bi) =>
              btn === " " ? (
                <div key={bi} />
              ) : (
                <button
                  key={btn}
                  onClick={() => press(btn)}
                  className={`h-11 rounded-xl text-sm font-semibold transition-all active:scale-95
                  ${
                    isOp(btn)
                      ? "btn-module text-white "
                      : isFn(btn)
                        ? "bg-muted/60 hover:bg-muted"
                        : "bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  {btn}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingVehicleInOutWidget() {
  const navigate = useNavigate();
  const { data: pending = [], isLoading } = useQuery<
    PendingVehicleInOutSummary[]
  >({
    queryKey: ["pending-vehicle-in-out"],
    queryFn: getPendingVehicleSummary,
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });
  if (isLoading) return <Spinner />;
  if (!pending.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No pending vehicles — every PO is fully delivered.
      </p>
    );

  const goTo = (row: PendingVehicleInOutSummary) => {
    if (row.lastVehicleInOutId) {
      navigate(`/material/vehicle-in-out?view=${row.lastVehicleInOutId}`);
    } else {
      navigate(`/material/vehicle-in-out?newForPO=${row.poId}`);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center justify-between">
        <span>Pending Vehicle In/Out</span>
        <span className="text-foreground font-bold text-sm">
          {pending.length}
        </span>
      </p>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {pending.map((row) => (
          <button
            key={row.poId}
            onClick={() => goTo(row)}
            className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-muted/20 rounded-lg px-2 -mx-2 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {row.poNumber || `PO #${row.poId}`}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {row.supplierName || "—"}
                {row.lastVehicleInOutDocNo
                  ? ` · Last: ${row.lastVehicleInOutDocNo}`
                  : " · No vehicle logged yet"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-amber-500">
                {fmtNum(row.pendingQty)}
              </p>
              <p className="text-[0.625rem] text-muted-foreground">
                of {fmtNum(row.totalOrdered)} pending
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── WIDGET MAP ───────────────────────────────────────────────────────────────
const widgetComponents: Record<string, React.ComponentType> = {
  "Bar Chart": BarChartWidget,
  "Line Chart": LineChartWidget,
  "Pie Chart": PieChartWidget,
  "Stat Card": StatCardWidget,
  "Data Table": DataTableWidget,
  Calendar: CalendarWidget,
  Notifications: NotificationsWidget,
  "Activity Feed": ActivityFeedWidget,
  "Map View": MapViewWidget,
  "File Uploader": FileUploaderWidget,
  "Progress Ring": ProgressRingWidget,
  Calculator: CalculatorWidget,
  "Pending Vehicle In/Out": PendingVehicleInOutWidget,
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
// A board on the sheet: an index of every widget on the left (search, category filter, grouped under lettered ruled
// headings, numbered rows with a square mark in the category's colour) and the open widget at full size on the right
// under its own title block. The open widget lives in the URL (?w=), so a link opens straight to it. On a phone the
// index stacks above the viewer, and picking a widget scrolls down to it.
const Widgets = () => {
  usePageRights("widgets");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelectedState] = useState<string | null>(searchParams.get("w"));
  const viewerRef = useRef<HTMLDivElement>(null);

  const setSelected = useCallback(
    (key: string | null, opts?: { scroll?: boolean }) => {
      setSelectedState(key);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (key) next.set("w", key);
          else next.delete("w");
          return next;
        },
        { replace: true },
      );
      if (key && opts?.scroll && window.matchMedia("(max-width: 1023px)").matches) {
        setTimeout(() => viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
    },
    [setSearchParams],
  );

  const { catalog, loading: catalogLoading } = useWidgetCatalog();
  const { allowedSet, loading: rightsLoading } = useAllowedWidgets();

  // allowedSet null = still loading or rights failed → show all catalog widgets as fallback
  const visibleWidgets = catalog.filter(
    (w) => (!allowedSet || allowedSet.has(w.key)) && widgetComponents[w.key],
  );

  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(visibleWidgets.map((w) => w.category).filter(Boolean))),
    [visibleWidgets],
  );

  const filteredWidgets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleWidgets.filter((w) => {
      if (activeCategory && w.category !== activeCategory) return false;
      if (!q) return true;
      return w.label.toLowerCase().includes(q) || w.description.toLowerCase().includes(q);
    });
  }, [visibleWidgets, activeCategory, query]);

  // Index groups: one per category, in the order categories first appear.
  const groups = useMemo(() => {
    const m = new Map<string, WidgetCatalogItem[]>();
    for (const w of filteredWidgets) {
      const c = w.category || "Other";
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(w);
    }
    return Array.from(m, ([category, items]) => ({ category, items }));
  }, [filteredWidgets]);

  const safeSelected = selected && (!allowedSet || allowedSet.has(selected)) ? selected : null;
  const ActiveWidget = safeSelected ? widgetComponents[safeSelected] : null;
  const selectedWidget = safeSelected ? catalog.find((w) => w.key === safeSelected) : null;
  const SelectedIcon = selectedWidget ? widgetIcons[selectedWidget.iconKey] || Puzzle : Puzzle;
  const selectedColor = selectedWidget ? CATEGORY_COLORS[selectedWidget.category] || DEFAULT_CATEGORY_COLOR : DEFAULT_CATEGORY_COLOR;
  const loading = rightsLoading || catalogLoading;

  // On a wide screen the board is never empty: open the first widget when none is chosen.
  useEffect(() => {
    if (loading || safeSelected || visibleWidgets.length === 0) return;
    if (window.matchMedia("(min-width: 1024px)").matches) setSelected(visibleWidgets[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, visibleWidgets.length]);

  let rowNo = 0;

  return (
    <>
      <Breadcrumbs items={["Dashboard", selectedWidget?.label || "Widgets"]} />
      <style>{WIDGETS_CSS}</style>

      <SheetShell
        eyebrow="CivilierERP · Widgets"
        title="Widgets"
        subtitle="Pick a widget from the index to open it on the board. Charts and stat cards can be pointed at live data from any module."
      >
        {/* Figures */}
        <div className="statrow">
          <div>
            <p className="label">Widgets</p>
            <p className="wg-figure">{loading ? "—" : visibleWidgets.length}</p>
          </div>
          <div>
            <p className="label">Categories</p>
            <p className="wg-figure">{loading ? "—" : categories.length}</p>
          </div>
          <div>
            <p className="label">Open</p>
            <p className="wg-figure wg-figure-text">{selectedWidget?.label ?? "—"}</p>
          </div>
        </div>

        {loading ? (
          <div className="wg-board">
            <div className="wg-index">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skel" style={{ height: 40, margin: "10px 14px" }} />
              ))}
            </div>
            <div className="wg-view">
              <div className="skel" style={{ height: 260, margin: 18 }} />
            </div>
          </div>
        ) : visibleWidgets.length === 0 ? (
          <div className="wg-empty">
            <p className="label" style={{ color: "var(--ink)" }}>No widgets enabled</p>
            <p>No widgets are enabled for your account. Contact your administrator to enable widget access.</p>
          </div>
        ) : (
          <div className="wg-board">
            {/* ── Index ── */}
            <aside className="wg-index" aria-label="Widget index">
              <div className="wg-tools">
                <div className="wg-search">
                  <Search size={14} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search widgets…" aria-label="Search widgets" />
                  {query && (
                    <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                      <X size={12} />
                    </button>
                  )}
                </div>
                {categories.length > 1 && (
                  <div className="seg wg-cats">
                    <button type="button" className={activeCategory === null ? "on" : ""} onClick={() => setActiveCategory(null)}>All</button>
                    {categories.map((cat) => (
                      <button key={cat} type="button" className={activeCategory === cat ? "on" : ""} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}>
                        <i className="wg-dot" style={{ background: CATEGORY_COLORS[cat] || DEFAULT_CATEGORY_COLOR }} />
                        {cat}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {groups.length === 0 ? (
                <p className="wg-empty small">No widgets match {query ? `“${query}”` : "this category"}.</p>
              ) : (
                <div className="wg-list">
                  {groups.map((g, gi) => {
                    const color = CATEGORY_COLORS[g.category] || DEFAULT_CATEGORY_COLOR;
                    return (
                      <section key={g.category}>
                        <header className="wg-group">
                          <span className="tag">{String.fromCharCode(65 + (gi % 26))}</span>
                          <span className="label" style={{ color: "var(--ink)" }}>{g.category}</span>
                          <span className="wg-rule" />
                          <span className="label">{g.items.length}</span>
                        </header>
                        {g.items.map((w) => {
                          const Icon = widgetIcons[w.iconKey] || Puzzle;
                          const on = safeSelected === w.key;
                          rowNo += 1;
                          return (
                            <button
                              key={w.key}
                              type="button"
                              onClick={() => setSelected(w.key, { scroll: true })}
                              aria-current={on ? "true" : undefined}
                              className={`wg-row ${on ? "on" : ""}`}
                            >
                              <span className="wg-num">{String(rowNo).padStart(2, "0")}</span>
                              <span className="wg-mark" style={{ color }}>
                                <Icon size={15} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="wg-name">{w.label}</span>
                                {w.description && <span className="wg-desc">{w.description}</span>}
                              </span>
                            </button>
                          );
                        })}
                      </section>
                    );
                  })}
                </div>
              )}
            </aside>

            {/* ── Viewer ── */}
            <section className="wg-view" ref={viewerRef} aria-label="Open widget">
              {selectedWidget && ActiveWidget ? (
                <>
                  <header className="wg-view-head" style={{ ["--wg-c" as string]: selectedColor } as React.CSSProperties}>
                    <span className="wg-mark lg" style={{ color: selectedColor }}>
                      <SelectedIcon size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="label">{selectedWidget.category || "Widget"}</p>
                      <h2 className="wg-view-title">{selectedWidget.label}</h2>
                      {selectedWidget.description && <p className="wg-view-desc">{selectedWidget.description}</p>}
                    </div>
                    <button type="button" className="wg-key" onClick={() => setSelected(null)} aria-label="Close widget" title="Close">
                      <X size={14} />
                    </button>
                  </header>
                  <div className="wg-view-body">
                    <ActiveWidget key={selectedWidget.key} />
                  </div>
                </>
              ) : (
                <div className="wg-empty">
                  <p className="label" style={{ color: "var(--ink)" }}>Nothing open</p>
                  <p>Pick a widget from the index to open it here.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </SheetShell>
    </>
  );
};

// The board's own parts; the sheet frame (SheetShell) supplies --ink, --rule, --graphite and squares off whatever the
// widgets draw inside it.
const WIDGETS_CSS = `
.sheet-frame .wg-figure { font-family: "Sora", sans-serif; font-weight: 600; font-size: 24px; letter-spacing: -0.02em; line-height: 1; margin-top: 6px; color: var(--ink); }
.sheet-frame .wg-figure-text { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .wg-board { display: grid; grid-template-columns: minmax(260px, 340px) minmax(0, 1fr); border: 1px solid var(--ink); min-height: 480px; }
.sheet-frame .wg-index { border-right: 1px solid var(--ink); display: flex; flex-direction: column; min-width: 0; background: hsl(var(--card)); }
.sheet-frame .wg-tools { padding: 12px 14px; border-bottom: 1px solid var(--rule); display: flex; flex-direction: column; gap: 10px; }
.sheet-frame .wg-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; height: 36px; border: 1px solid var(--ink); background: hsl(var(--card)); color: var(--graphite); }
.sheet-frame .wg-search input { flex: 1; min-width: 0; height: 100%; background: transparent; border: 0; outline: none; font-size: 13px; color: var(--ink); }
.sheet-frame .wg-cats { display: flex; flex-wrap: wrap; max-width: 100%; }
.sheet-frame .wg-cats button { display: inline-flex; align-items: center; gap: 6px; }
.sheet-frame .wg-dot { width: 7px; height: 7px; flex-shrink: 0; }
.sheet-frame .wg-list { overflow-y: auto; max-height: 640px; padding-bottom: 6px; }
.sheet-frame .wg-group { display: flex; align-items: center; gap: 10px; padding: 14px 14px 6px; }
.sheet-frame .wg-rule { flex: 1; height: 1px; background: var(--rule); }
.sheet-frame .wg-row { display: grid; grid-template-columns: 20px 30px minmax(0, 1fr); align-items: center; gap: 10px; width: 100%;
  padding: 9px 14px; text-align: left; border-bottom: 1px solid var(--rule-soft); transition: background-color .12s; }
.sheet-frame .wg-row:hover { background: var(--blue-wash); }
.sheet-frame .wg-row.on { background: var(--blue-wash); box-shadow: inset 3px 0 0 var(--ink); }
.sheet-frame .wg-num { font-family: "Sora", sans-serif; font-size: 10px; font-weight: 600; color: var(--graphite); }
.sheet-frame .wg-mark { width: 30px; height: 30px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--rule); background: hsl(var(--card)); }
.sheet-frame .wg-row.on .wg-mark { border-color: var(--ink); }
.sheet-frame .wg-mark.lg { width: 44px; height: 44px; border: 1.5px solid var(--ink); }
.sheet-frame .wg-name { display: block; font-size: 13px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .wg-desc { display: block; font-size: 11px; color: var(--graphite); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sheet-frame .wg-view { min-width: 0; display: flex; flex-direction: column; }
.sheet-frame .wg-view-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--ink); box-shadow: inset 0 3px 0 var(--wg-c); }
.sheet-frame .wg-view-title { font-family: "Sora", sans-serif; font-weight: 700; font-size: 22px; letter-spacing: -0.02em; line-height: 1.1; margin: 4px 0 0; color: var(--ink); }
.sheet-frame .wg-view-desc { font-size: 12.5px; color: var(--ink-2); margin-top: 5px; max-width: 70ch; }
.sheet-frame .wg-key { width: 30px; height: 30px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ink); color: var(--ink); background: hsl(var(--card)); transition: background-color .15s, color .15s; }
.sheet-frame .wg-key:hover { background: var(--ink); color: hsl(var(--card)); }
.sheet-frame .wg-view-body { padding: 18px; flex: 1; min-width: 0; }
.sheet-frame .wg-empty { margin: 18px; padding: 28px 20px; text-align: center; border: 1px dashed var(--rule); font-size: 13px; color: var(--graphite); }
.sheet-frame .wg-empty p + p { margin-top: 5px; }
.sheet-frame .wg-empty.small { margin: 14px; padding: 18px 14px; }
@media (max-width: 1023px) {
  .sheet-frame .wg-board { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .sheet-frame .wg-index { border-right: 0; border-bottom: 1px solid var(--ink); }
  .sheet-frame .wg-list { max-height: 360px; }
  .sheet-frame .wg-view { scroll-margin-top: 72px; }
}
@media (max-width: 640px) {
  .sheet-frame .wg-view-head { padding: 14px; gap: 10px; }
  .sheet-frame .wg-view-title { font-size: 19px; }
  .sheet-frame .wg-view-body { padding: 12px; }
}
`;

export default Widgets;
