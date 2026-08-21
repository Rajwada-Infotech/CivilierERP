import React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  RefreshCw,
  AlertCircle,
  ClipboardList,
  CheckCircle2,
  Clock,
  Activity,
  AlertTriangle,
  TrendingUp,
  Users,
  Flag,
  Building2,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { Chart } from "iconsax-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { GlassCard, GlassSection, GlassCardSkeleton } from "@/components/dashboard/GlassShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const REPORT_API = "/api/task-performance-report";
const ACCENT = "#0d9488";

const STATUSES = ["Active", "Hold", "Cancel", "Closed"] as const;
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;

const STATUS_COLORS: Record<string, string> = {
  Active: "#3b82f6",
  Hold: "#f59e0b",
  Cancel: "#64748b",
  Closed: "#22c55e",
};
const STATUS_LABELS: Record<string, string> = {
  Active: "Ongoing",
  Hold: "Pending",
  Cancel: "Cancelled",
  Closed: "Completed",
};
const PRIORITY_COLORS: Record<string, string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
};
const USER_PALETTE = ["#0d9488", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#22c55e", "#ef4444", "#94a3b8"];

interface Company {
  id: number;
  name: string;
}
interface Project {
  id: number;
  name: string;
  company_id: number | null;
}
interface FilterUser {
  id: number;
  name: string;
}

interface ReportRow {
  Id: number;
  TaskNo: string | null;
  Subject: string;
  CaseProjectId: number | null;
  ProjectName: string | null;
  CaseCompanyId: number | null;
  CompanyName: string | null;
  CreatedBy: number | null;
  CreatedByName: string | null;
  AssignedTo: number | null;
  FollowerName: string | null;
  TaskDueDate: string | null;
  Status: string;
  Priority: string;
  DelayDays: number | null;
  Progress: number;
  EffectiveProgress: number;
}

interface Filters {
  companyId: string;
  projectId: string;
  userId: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: Filters = {
  companyId: "",
  projectId: "",
  userId: "",
  status: "",
  priority: "",
  startDate: "",
  endDate: "",
};

async function fetchDropdowns(): Promise<{ companies: Company[]; projects: Project[] }> {
  const res = await fetchWithAuth("/api/business/dropdown");
  if (!res.ok) throw new Error("Failed to fetch company/project list");
  return res.json().catch(() => ({ companies: [], projects: [] }));
}

async function fetchUsers(): Promise<FilterUser[]> {
  const res = await fetchWithAuth("/api/task-master/assignable-users");
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => []);
}

async function fetchReport(filters: Filters): Promise<ReportRow[]> {
  const params = new URLSearchParams();
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.userId) params.set("followerId", filters.userId);
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.startDate) params.set("startDate", filters.startDate);
  if (filters.endDate) params.set("endDate", filters.endDate);

  const res = await fetchWithAuth(`${REPORT_API}?${params.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch dashboard data");
  return Array.isArray(data) ? data : [];
}

function useGlass() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const cardStyle = {
    background: isDark ? "rgba(15,17,26,0.5)" : "rgba(255,255,255,0.72)",
    border: `1px solid ${ACCENT}26`,
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : `0 4px 24px ${ACCENT}0f, inset 0 1px 0 rgba(255,255,255,0.9)`,
  };
  return { isDark, cardStyle };
}

// ── Donut/pie chart card, percentage-aware ──────────────────────────────────
interface DonutPoint {
  name: string;
  value: number;
  color: string;
}

const DonutCard: React.FC<{
  title: string;
  icon: React.ElementType;
  data: DonutPoint[];
  isDark: boolean;
  cardStyle: React.CSSProperties;
}> = ({ title, icon: Icon, data, isDark, cardStyle }) => {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="rounded-xl overflow-hidden" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${ACCENT}26` }}>
          <Icon size={11} style={{ color: ACCENT }} />
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
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0];
                    const val = d.value as number;
                    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : "0";
                    return (
                      <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg">
                        <p className="text-xs font-heading font-semibold text-foreground">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{val} tasks · {pct}%</p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 w-full sm:w-auto shrink-0">
              {data.map((d) => {
                const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
                return (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-foreground whitespace-nowrap">{d.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto sm:ml-3">
                      {d.value} <span className="opacity-60">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ── User performance bar chart ───────────────────────────────────────────────
interface UserPerf {
  userId: number | string;
  name: string;
  assigned: number;
  completed: number;
  pending: number;
  overdue: number;
  completionPct: number;
}

const UserPerformanceChart: React.FC<{ data: UserPerf[]; isDark: boolean; cardStyle: React.CSSProperties }> = ({
  data,
  isDark,
  cardStyle,
}) => {
  const chartData = [...data].sort((a, b) => b.assigned - a.assigned).slice(0, 10);
  return (
    <div className="rounded-xl overflow-hidden" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${ACCENT}26` }}>
          <TrendingUp size={11} style={{ color: ACCENT }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">User Performance (Top 10 by workload)</span>
      </div>
      <div className="p-4">
        {chartData.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 34)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={110}
                tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: isDark ? "rgba(148,163,184,0.06)" : "rgba(100,116,139,0.06)" }}
                contentStyle={{
                  background: isDark ? "rgba(15,17,26,0.95)" : "rgba(255,255,255,0.95)",
                  border: `1px solid ${ACCENT}30`,
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
              <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[0, 3, 3, 0]} />
              <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[0, 3, 3, 0]} />
              <Bar dataKey="overdue" name="Overdue" fill="#ef4444" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

const selectCls =
  "w-full appearance-none pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";
const inputCls =
  "w-full pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

function FilterField({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <Icon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
        {children}
      </div>
    </div>
  );
}

const PERF_COLS: ColumnDef<UserPerf, unknown>[] = [
  { id: "name", accessorKey: "name", header: "User", size: 160 },
  { id: "assigned", accessorKey: "assigned", header: "Assigned", size: 90, cell: ({ getValue }) => <span className="font-mono">{getValue() as number}</span> },
  { id: "completed", accessorKey: "completed", header: "Completed", size: 90, cell: ({ getValue }) => <span className="font-mono text-emerald-500">{getValue() as number}</span> },
  { id: "pending", accessorKey: "pending", header: "Pending", size: 90, cell: ({ getValue }) => <span className="font-mono text-amber-500">{getValue() as number}</span> },
  { id: "overdue", accessorKey: "overdue", header: "Overdue", size: 90, cell: ({ getValue }) => <span className="font-mono text-red-500">{getValue() as number}</span> },
  {
    id: "completionPct",
    accessorKey: "completionPct",
    header: "Completion %",
    size: 140,
    cell: ({ getValue }) => {
      const pct = getValue() as number;
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden shrink-0">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
          </div>
          <span className="text-xs font-mono">{pct}%</span>
        </div>
      );
    },
  },
];

const TaskDashboard: React.FC = () => {
  const { isDark, cardStyle } = useGlass();
  usePageRights("task-performance-report");
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [dateError, setDateError] = React.useState<string | null>(null);

  const { data: dropdowns } = useQuery({
    queryKey: ["task-dashboard-dropdowns"],
    queryFn: fetchDropdowns,
    staleTime: 5 * 60_000,
  });
  const companies = dropdowns?.companies ?? [];
  const projects = dropdowns?.projects ?? [];
  const visibleProjects = filters.companyId ? projects.filter((p) => String(p.company_id) === filters.companyId) : projects;

  const { data: users = [] } = useQuery({
    queryKey: ["task-dashboard-users"],
    queryFn: fetchUsers,
    staleTime: 5 * 60_000,
  });

  const {
    data: rows = [],
    isLoading,
    isFetching,
    refetch,
    isError,
    error,
  } = useQuery({
    queryKey: ["task-dashboard-report", filters],
    queryFn: () => fetchReport(filters),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const updateFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    if (next.startDate && next.endDate && next.startDate > next.endDate) {
      setDateError("Start Date must be on or before End Date.");
    } else {
      setDateError(null);
      setFilters(next);
    }
  };
  const resetFilters = () => {
    setDateError(null);
    setFilters(EMPTY_FILTERS);
  };

  // ── All aggregation is computed live from `rows`, fetched fresh from the
  // same TaskMaster-backed report endpoint every time filters change or the
  // user hits Refresh — no separate/duplicated task dataset. ──────────────
  const summary = React.useMemo(() => {
    const total = rows.length;
    const completed = rows.filter((r) => r.Status === "Closed").length;
    const ongoing = rows.filter((r) => r.Status === "Active").length;
    const pending = rows.filter((r) => r.Status === "Hold").length;
    const overdue = rows.filter((r) => r.Status !== "Closed" && r.DelayDays != null && r.DelayDays > 0).length;
    const avgProgress = total
      ? Math.round(rows.reduce((s, r) => s + (r.EffectiveProgress ?? r.Progress ?? 0), 0) / total)
      : 0;
    return { total, completed, ongoing, pending, overdue, avgProgress };
  }, [rows]);

  const priorityData: DonutPoint[] = React.useMemo(
    () =>
      PRIORITIES.map((p) => ({
        name: p,
        value: rows.filter((r) => r.Priority === p).length,
        color: PRIORITY_COLORS[p],
      })).filter((d) => d.value > 0),
    [rows],
  );

  const statusData: DonutPoint[] = React.useMemo(
    () =>
      STATUSES.map((s) => ({
        name: STATUS_LABELS[s],
        value: rows.filter((r) => r.Status === s).length,
        color: STATUS_COLORS[s],
      })).filter((d) => d.value > 0),
    [rows],
  );

  const userPieData: DonutPoint[] = React.useMemo(() => {
    const byUser = new Map<string, number>();
    for (const r of rows) {
      const name = r.FollowerName || "Unassigned";
      byUser.set(name, (byUser.get(name) || 0) + 1);
    }
    const sorted = Array.from(byUser.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 7);
    const rest = sorted.slice(7);
    const points: DonutPoint[] = top.map(([name, value], i) => ({ name, value, color: USER_PALETTE[i % USER_PALETTE.length] }));
    if (rest.length) {
      points.push({ name: "Others", value: rest.reduce((s, [, v]) => s + v, 0), color: "#475569" });
    }
    return points;
  }, [rows]);

  const userPerf: UserPerf[] = React.useMemo(() => {
    const byUser = new Map<string, UserPerf>();
    for (const r of rows) {
      const key = r.AssignedTo != null ? String(r.AssignedTo) : "unassigned";
      const name = r.FollowerName || "Unassigned";
      if (!byUser.has(key)) {
        byUser.set(key, { userId: key, name, assigned: 0, completed: 0, pending: 0, overdue: 0, completionPct: 0 });
      }
      const u = byUser.get(key)!;
      u.assigned += 1;
      if (r.Status === "Closed") u.completed += 1;
      if (r.Status === "Hold") u.pending += 1;
      if (r.Status !== "Closed" && r.DelayDays != null && r.DelayDays > 0) u.overdue += 1;
    }
    return Array.from(byUser.values())
      .map((u) => ({ ...u, completionPct: u.assigned > 0 ? Math.round((u.completed / u.assigned) * 100) : 0 }))
      .sort((a, b) => b.assigned - a.assigned);
  }, [rows]);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Task Dashboard"]} />
      <FollowupShell
        title="Task Management Dashboard"
      subtitle="Priority, status and user performance across all tasks — live"
      icon={Chart}
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
          <span>{(error as Error)?.message ?? "Failed to load dashboard data. Please refresh."}</span>
          <button onClick={() => refetch()} className="ml-auto text-xs underline hover:no-underline">Retry</button>
        </div>
      )}

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={cardStyle}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT }}>Filters</p>
          <button onClick={resetFilters} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
            <RotateCcw size={11} /> Reset
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <FilterField icon={Building2} label="Company">
            <select className={selectCls} value={filters.companyId} onChange={(e) => updateFilter({ companyId: e.target.value, projectId: "" })}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </select>
          </FilterField>
          <FilterField icon={FolderOpen} label="Project">
            <select className={selectCls} value={filters.projectId} onChange={(e) => updateFilter({ projectId: e.target.value })}>
              <option value="">All Projects</option>
              {visibleProjects.map((p) => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
            </select>
          </FilterField>
          <FilterField icon={Users} label="User">
            <select className={selectCls} value={filters.userId} onChange={(e) => updateFilter({ userId: e.target.value })}>
              <option value="">All Users</option>
              {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
          </FilterField>
          <FilterField icon={Flag} label="Priority">
            <select className={selectCls} value={filters.priority} onChange={(e) => updateFilter({ priority: e.target.value })}>
              <option value="">All Priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FilterField>
          <FilterField icon={Activity} label="Status">
            <select className={selectCls} value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
              <option value="">All Statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </FilterField>
          <FilterField icon={Clock} label="Date Range">
            <div className="flex gap-1">
              <input type="date" className={`${inputCls} pl-2`} value={filters.startDate} onChange={(e) => updateFilter({ startDate: e.target.value })} />
              <input type="date" className={`${inputCls} pl-2`} value={filters.endDate} onChange={(e) => updateFilter({ endDate: e.target.value })} />
            </div>
          </FilterField>
        </div>
        {dateError && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{dateError}</p>}
      </div>

      {/* ── KPI cards ────────────────────────────────────────────────────── */}
      <GlassSection title="Overview" icon={ClipboardList} accentColor={ACCENT}>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <GlassCardSkeleton key={i} />)
            : [
                { label: "Total Tasks", value: summary.total, icon: ClipboardList, accentColor: ACCENT },
                { label: "Completed", value: summary.completed, icon: CheckCircle2, accentColor: "#22c55e" },
                { label: "Ongoing", value: summary.ongoing, icon: Activity, accentColor: "#3b82f6" },
                { label: "Pending", value: summary.pending, icon: Clock, accentColor: "#f59e0b" },
                { label: "Overdue", value: summary.overdue, icon: AlertTriangle, accentColor: "#ef4444" },
                { label: "Avg. Progress", value: `${summary.avgProgress}%`, icon: TrendingUp, accentColor: "#8b5cf6" },
              ].map((s) => <GlassCard key={s.label} {...s} />)}
        </div>
      </GlassSection>

      {/* ── Priority-wise summary ───────────────────────────────────────── */}
      <GlassSection title="Priority-wise Task Summary" icon={Flag} accentColor={ACCENT}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => <GlassCardSkeleton key={i} />)
            : PRIORITIES.map((p) => (
                <GlassCard
                  key={p}
                  label={p}
                  value={rows.filter((r) => r.Priority === p).length}
                  icon={Flag}
                  accentColor={PRIORITY_COLORS[p]}
                />
              ))}
        </div>
      </GlassSection>

      {/* ── Pie charts ───────────────────────────────────────────────────── */}
      <GlassSection title="Distribution" icon={Chart} accentColor={ACCENT}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <DonutCard title="Tasks by Priority (%)" icon={Flag} data={priorityData} isDark={isDark} cardStyle={cardStyle} />
          <DonutCard title="Tasks by Status (%)" icon={Activity} data={statusData} isDark={isDark} cardStyle={cardStyle} />
          <DonutCard title="Tasks by User (%)" icon={Users} data={userPieData} isDark={isDark} cardStyle={cardStyle} />
        </div>
      </GlassSection>

      {/* ── User performance ────────────────────────────────────────────── */}
      <GlassSection title="User Performance" icon={TrendingUp} accentColor={ACCENT}>
        <div className="space-y-4">
          <UserPerformanceChart data={userPerf} isDark={isDark} cardStyle={cardStyle} />
          <div className="rounded-xl overflow-hidden" style={cardStyle}>
            <DataTable
              data={userPerf}
              columns={PERF_COLS}
              loading={isLoading || isFetching}
              searchPlaceholder="Search users…"
              emptyMessage="No task data for the selected filters."
              defaultPageSize={10}
            />
          </div>
        </div>
      </GlassSection>
      </FollowupShell>
    </>
  );
};

export default TaskDashboard;
