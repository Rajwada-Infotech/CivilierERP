import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  Printer,
  AlertCircle,
  ClipboardList,
  Building2,
  FolderOpen,
  Users,
  Flag,
  Activity,
  Clock,
  RotateCcw,
  TrendingUp,
  Tags as TagsIcon,
} from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { DataTable, type ColumnDef, type ExportColumn } from "@/components/ui/DataTable";
import { GlassCard, GlassSection, GlassCardSkeleton } from "@/components/dashboard/GlassShell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const REPORT_API = "/api/task-performance-report";
const ACCENT = "#0d9488";

const STATUSES = ["Active", "Hold", "Cancel", "Closed"] as const;
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;
const STATUS_LABELS: Record<string, string> = {
  Active: "Ongoing",
  Hold: "Pending",
  Cancel: "Cancelled",
  Closed: "Completed",
};
const STATUS_COLORS: Record<string, string> = {
  Active: "#3b82f6",
  Hold: "#f59e0b",
  Cancel: "#64748b",
  Closed: "#22c55e",
};
const PRIORITY_COLORS: Record<string, string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
};
const TAG_PALETTE = ["#0d9488", "#3b82f6", "#f59e0b", "#8b5cf6", "#ec4899", "#22c55e", "#ef4444", "#94a3b8", "#14b8a6", "#f97316"];

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
interface RowTag {
  Id: number;
  Name: string;
}

interface ReportRow {
  Id: number;
  TaskNo: string | null;
  Subject: string;
  ProjectName: string | null;
  CompanyName: string | null;
  FollowerName: string | null;
  TaskDueDate: string | null;
  Status: string;
  Priority: string;
  DelayDays: number | null;
  Progress: number;
  EffectiveProgress: number;
  Tags: RowTag[];
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
  if (!res.ok) throw new Error(data.error || "Failed to fetch report data");
  return Array.isArray(data) ? data : [];
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
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

interface TagStat {
  tagId: number;
  name: string;
  total: number;
  completed: number;
  pending: number;
  ongoing: number;
  overdue: number;
  completionPct: number;
  progressSum: number;
  avgProgress: number;
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap"
      style={{ borderColor: `${color}4d`, color, background: `${color}1A` }}
    >
      {label}
    </span>
  );
}

// ── Donut chart ───────────────────────────────────────────────────────────
interface DonutPoint {
  name: string;
  value: number;
  color: string;
}
const DonutCard: React.FC<{ title: string; icon: React.ElementType; data: DonutPoint[]; isDark: boolean; cardStyle: React.CSSProperties }> = ({
  title,
  icon: Icon,
  data,
  isDark,
  cardStyle,
}) => {
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
          <div className="text-center text-muted-foreground py-10 text-sm">No tagged tasks yet</div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <ResponsiveContainer width="100%" height={200}>
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
            <div className="space-y-1.5 w-full sm:w-auto shrink-0 max-h-[200px] overflow-y-auto thin-scroll pr-1">
              {data.map((d) => {
                const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
                return (
                  <div key={d.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
                    <span className="text-xs text-foreground whitespace-nowrap truncate max-w-[120px]">{d.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto sm:ml-3">{d.value} <span className="opacity-60">({pct}%)</span></span>
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

// ── Bar chart: tag-wise status comparison ────────────────────────────────
const TagBarChart: React.FC<{ data: TagStat[]; isDark: boolean; cardStyle: React.CSSProperties }> = ({ data, isDark, cardStyle }) => {
  const chartData = [...data].sort((a, b) => b.total - a.total).slice(0, 12);
  return (
    <div className="rounded-xl overflow-hidden" style={cardStyle}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: isDark ? `${ACCENT}26` : `${ACCENT}1f` }}>
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: `${ACCENT}26` }}>
          <TrendingUp size={11} style={{ color: ACCENT }} />
        </div>
        <span className="text-xs font-heading font-semibold text-foreground">Tag Comparison (Top 12 by volume)</span>
      </div>
      <div className="p-4">
        {chartData.length === 0 ? (
          <div className="text-center text-muted-foreground py-10 text-sm">No tagged tasks yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 34)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.15)"} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }} axisLine={false} tickLine={false} />
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
              <Bar dataKey="ongoing" name="Ongoing" fill="#3b82f6" radius={[0, 3, 3, 0]} />
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
  "w-full pl-2 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

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

type DetailFilterKey = "all" | "completed" | "pending" | "ongoing" | "overdue";
const DETAIL_FILTER_LABELS: Record<DetailFilterKey, string> = {
  all: "All",
  completed: "Completed",
  pending: "Pending",
  ongoing: "Ongoing",
  overdue: "Overdue",
};

const TagPerformanceReport: React.FC = () => {
  const { isDark, cardStyle } = useGlass();
  usePageRights("task-performance-report");
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [selectedTag, setSelectedTag] = React.useState<TagStat | null>(null);
  const [detailFilter, setDetailFilter] = React.useState<DetailFilterKey>("all");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const openTagDetail = (tag: TagStat, key: DetailFilterKey = "all") => {
    setSelectedTag(tag);
    setDetailFilter(key);
  };

  const { data: dropdowns } = useQuery({
    queryKey: ["tag-performance-report-dropdowns"],
    queryFn: fetchDropdowns,
    staleTime: 5 * 60_000,
  });
  const companies = dropdowns?.companies ?? [];
  const projects = dropdowns?.projects ?? [];
  const visibleProjects = filters.companyId ? projects.filter((p) => String(p.company_id) === filters.companyId) : projects;

  const { data: users = [] } = useQuery({
    queryKey: ["tag-performance-report-users"],
    queryFn: fetchUsers,
    staleTime: 5 * 60_000,
  });

  const {
    data: rows = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["tag-performance-report", filters],
    queryFn: () => fetchReport(filters),
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

  // A task with multiple tags contributes to every one of those tags' totals
  // — that's the correct fan-out for a tag-wise breakdown. Tasks with no
  // tags at all simply don't appear in any tag's numbers.
  const tagStats: TagStat[] = React.useMemo(() => {
    const byTag = new Map<number, TagStat>();
    for (const r of rows) {
      for (const tag of r.Tags || []) {
        if (!byTag.has(tag.Id)) {
          byTag.set(tag.Id, { tagId: tag.Id, name: tag.Name, total: 0, completed: 0, pending: 0, ongoing: 0, overdue: 0, completionPct: 0, progressSum: 0, avgProgress: 0 });
        }
        const s = byTag.get(tag.Id)!;
        s.total += 1;
        s.progressSum += r.EffectiveProgress ?? r.Progress ?? 0;
        if (r.Status === "Closed") s.completed += 1;
        if (r.Status === "Hold") s.pending += 1;
        if (r.Status === "Active") s.ongoing += 1;
        if (r.Status !== "Closed" && r.DelayDays != null && r.DelayDays > 0) s.overdue += 1;
      }
    }
    return Array.from(byTag.values())
      .map((s) => ({
        ...s,
        completionPct: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0,
        avgProgress: s.total > 0 ? Math.round(s.progressSum / s.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const tasksByTagId = React.useMemo(() => {
    const map = new Map<number, ReportRow[]>();
    for (const r of rows) {
      for (const tag of r.Tags || []) {
        (map.get(tag.Id) ?? map.set(tag.Id, []).get(tag.Id)!).push(r);
      }
    }
    return map;
  }, [rows]);

  const pieData: DonutPoint[] = React.useMemo(
    () => tagStats.map((s, i) => ({ name: s.name, value: s.total, color: TAG_PALETTE[i % TAG_PALETTE.length] })),
    [tagStats],
  );

  const summary = React.useMemo(() => {
    const tagsTracked = tagStats.length;
    const totalTaggedTasks = new Set(rows.filter((r) => (r.Tags?.length ?? 0) > 0).map((r) => r.Id)).size;
    const avgCompletionPct = tagStats.length
      ? Math.round(tagStats.reduce((s, t) => s + t.completionPct, 0) / tagStats.length)
      : 0;
    return { tagsTracked, totalTaggedTasks, avgCompletionPct };
  }, [tagStats, rows]);

  const columns: ColumnDef<TagStat, unknown>[] = React.useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Tag",
        size: 160,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => openTagDetail(row.original, "all")}
            className="text-left font-medium hover:underline"
            style={{ color: ACCENT }}
          >
            {row.original.name}
          </button>
        ),
      },
      {
        id: "total",
        accessorKey: "total",
        header: "Total Tasks",
        size: 90,
        cell: ({ row }) => (
          <button type="button" onClick={() => openTagDetail(row.original, "all")} className="font-mono hover:underline">
            {row.original.total}
          </button>
        ),
      },
      {
        id: "completed",
        accessorKey: "completed",
        header: "Completed",
        size: 90,
        cell: ({ row }) => (
          <button type="button" onClick={() => openTagDetail(row.original, "completed")} className="font-mono text-emerald-500 hover:underline">
            {row.original.completed}
          </button>
        ),
      },
      {
        id: "pending",
        accessorKey: "pending",
        header: "Pending",
        size: 90,
        cell: ({ row }) => (
          <button type="button" onClick={() => openTagDetail(row.original, "pending")} className="font-mono text-amber-500 hover:underline">
            {row.original.pending}
          </button>
        ),
      },
      {
        id: "ongoing",
        accessorKey: "ongoing",
        header: "Ongoing",
        size: 90,
        cell: ({ row }) => (
          <button type="button" onClick={() => openTagDetail(row.original, "ongoing")} className="font-mono text-blue-500 hover:underline">
            {row.original.ongoing}
          </button>
        ),
      },
      {
        id: "overdue",
        accessorKey: "overdue",
        header: "Overdue",
        size: 90,
        cell: ({ row }) => (
          <button type="button" onClick={() => openTagDetail(row.original, "overdue")} className="font-mono text-red-500 hover:underline">
            {row.original.overdue}
          </button>
        ),
      },
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
      {
        id: "avgProgress",
        accessorKey: "avgProgress",
        header: "Avg. Progress %",
        size: 140,
        cell: ({ getValue }) => {
          const pct = getValue() as number;
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden shrink-0">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#22c55e" : "#8b5cf6" }} />
              </div>
              <span className="text-xs font-mono">{pct}%</span>
            </div>
          );
        },
      },
    ],
    [],
  );

  const exportColumns: ExportColumn[] = [
    { header: "Tag", accessor: "name" },
    { header: "Total Tasks", accessor: "total" },
    { header: "Completed", accessor: "completed" },
    { header: "Pending", accessor: "pending" },
    { header: "Ongoing", accessor: "ongoing" },
    { header: "Overdue", accessor: "overdue" },
    { header: "Completion %", accessor: (r) => `${r.completionPct}%` },
    { header: "Avg. Progress %", accessor: (r) => `${r.avgProgress}%` },
  ];

  const handlePrint = () => {
    if (tagStats.length === 0) {
      toast.error("No data to print for the current filters");
      return;
    }
    window.print();
  };

  const detailTasksAll = selectedTag ? tasksByTagId.get(selectedTag.tagId) ?? [] : [];
  const detailTasks = React.useMemo(() => {
    switch (detailFilter) {
      case "completed":
        return detailTasksAll.filter((t) => t.Status === "Closed");
      case "pending":
        return detailTasksAll.filter((t) => t.Status === "Hold");
      case "ongoing":
        return detailTasksAll.filter((t) => t.Status === "Active");
      case "overdue":
        return detailTasksAll.filter((t) => t.Status !== "Closed" && t.DelayDays != null && t.DelayDays > 0);
      default:
        return detailTasksAll;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTasksAll, detailFilter]);

  const detailExportColumns: ExportColumn[] = [
    { header: "Task ID", accessor: (r) => r.TaskNo || `#${r.Id}` },
    { header: "Task Title", accessor: "Subject" },
    { header: "Project", accessor: (r) => r.ProjectName || "—" },
    { header: "Company", accessor: (r) => r.CompanyName || "—" },
    { header: "Assigned To", accessor: (r) => r.FollowerName || "—" },
    { header: "Status", accessor: (r) => STATUS_LABELS[r.Status as string] || (r.Status as string) },
    { header: "Priority", accessor: "Priority" },
    { header: "Due Date", accessor: (r) => formatDate(r.TaskDueDate as string) },
  ];

  const handleTaskStatusChange = async (id: string, status: string) => {
    const res = await fetchWithAuth(`/api/task-master/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Status: status }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Failed to update status");
      return;
    }
    toast.success(`Task marked ${status}`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tag-performance-report"] }),
      queryClient.invalidateQueries({ queryKey: ["followup-task", id] }),
    ]);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Tag Performance"]} />
      <FollowupShell
        title="Tag Performance Report"
      subtitle="Task volume and completion, broken down by tag"
      icon={TagsIcon}
      action={
        <button
          onClick={handlePrint}
          className="no-print h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
        >
          <Printer size={12} /> Print
        </button>
      }
    >
      <style>{`
        @media print {
          body > *:not(#tagperf-printable) { display: none !important; }
          #tagperf-printable { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="tagperf-printable">
        {isFetching === false && rows.length === 0 && !isLoading && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-center gap-2 text-sm text-amber-600 mb-5">
            <AlertCircle size={16} className="shrink-0" />
            <span>No tasks match the selected filters.</span>
          </div>
        )}

        {/* ── Summary ──────────────────────────────────────────────────── */}
        <GlassSection title="Overview" icon={ClipboardList} accentColor={ACCENT}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => <GlassCardSkeleton key={i} />)
              : [
                  { label: "Tags Tracked", value: summary.tagsTracked, icon: TagsIcon, accentColor: ACCENT },
                  { label: "Tagged Tasks", value: summary.totalTaggedTasks, icon: ClipboardList, accentColor: "#3b82f6" },
                  { label: "Avg. Completion %", value: `${summary.avgCompletionPct}%`, icon: TrendingUp, accentColor: "#8b5cf6" },
                ].map((s) => <GlassCard key={s.label} {...s} />)}
          </div>
        </GlassSection>

        {/* ── Filters ──────────────────────────────────────────────────── */}
        <div className="no-print rounded-xl p-4 my-5" style={cardStyle}>
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
            <FilterField icon={Activity} label="Status">
              <select className={selectCls} value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
                <option value="">All Statuses</option>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Flag} label="Priority">
              <select className={selectCls} value={filters.priority} onChange={(e) => updateFilter({ priority: e.target.value })}>
                <option value="">All Priorities</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </FilterField>
            <FilterField icon={Clock} label="Date Range">
              <div className="flex gap-1">
                <input type="date" className={inputCls} value={filters.startDate} onChange={(e) => updateFilter({ startDate: e.target.value })} />
                <input type="date" className={inputCls} value={filters.endDate} onChange={(e) => updateFilter({ endDate: e.target.value })} />
              </div>
            </FilterField>
          </div>
          {dateError && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{dateError}</p>}
        </div>

        {/* ── Charts ───────────────────────────────────────────────────── */}
        <GlassSection title="Distribution" icon={TagsIcon} accentColor={ACCENT}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DonutCard title="Tasks by Tag (%)" icon={TagsIcon} data={pieData} isDark={isDark} cardStyle={cardStyle} />
            <TagBarChart data={tagStats} isDark={isDark} cardStyle={cardStyle} />
          </div>
        </GlassSection>

        {/* ── Table ────────────────────────────────────────────────────── */}
        <div className="mt-5 rounded-xl overflow-hidden" style={cardStyle}>
          <DataTable
            data={tagStats}
            columns={columns}
            loading={isLoading || isFetching}
            searchPlaceholder="Search tags…"
            emptyMessage="No tagged tasks match the selected filters."
            defaultPageSize={10}
            exportConfig={{
              title: "Tag Performance Report",
              filename: "tag-performance-report",
              columns: exportColumns,
            }}
          />
        </div>
      </div>

      {/* ── Tag detail dialog — every task here comes straight from the same
          Task Table rows the report already fetched; clicking one opens the
          real task drawer, nothing here is a separate/duplicated record. ── */}
      {/* modal={false} — this dialog nests ExportMenu's own portaled dropdown
          inside it; Radix's default modal focus-trap intercepts pointer
          events on that dropdown's items before their onClick fires (the
          dropdown opens but item clicks silently do nothing). Disabling the
          trap here fixes that without touching the shared Dialog component
          used everywhere else. */}
      <Dialog open={!!selectedTag} onOpenChange={(open) => !open && setSelectedTag(null)} modal={false}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TagsIcon size={15} style={{ color: ACCENT }} /> {selectedTag?.name}
              <span className="text-xs font-normal text-muted-foreground">— {DETAIL_FILTER_LABELS[detailFilter]}</span>
            </DialogTitle>
            <DialogDescription>{detailTasks.length} task{detailTasks.length === 1 ? "" : "s"}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(DETAIL_FILTER_LABELS) as DetailFilterKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDetailFilter(key)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                    detailFilter === key ? "" : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  style={detailFilter === key ? { background: `${ACCENT}29`, borderColor: `${ACCENT}73`, color: ACCENT } : undefined}
                >
                  {DETAIL_FILTER_LABELS[key]}
                </button>
              ))}
            </div>
            <ExportMenu
              data={detailTasks as unknown as Record<string, unknown>[]}
              columns={detailExportColumns}
              title={`${selectedTag?.name ?? "Tag"} — ${DETAIL_FILTER_LABELS[detailFilter]} Tasks`}
              filename={`tag-${(selectedTag?.name ?? "tasks").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${detailFilter}`}
              disabled={detailTasks.length === 0}
            />
          </div>

          <div className="space-y-2">
            {detailTasks.map((t) => (
              <button
                key={t.Id}
                type="button"
                onClick={() => setSelectedTaskId(String(t.Id))}
                className="w-full text-left rounded-lg border border-border/70 p-3 text-sm hover:border-teal-500/40 hover:bg-card transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{t.TaskNo || `#${t.Id}`}</span>
                  <div className="flex items-center gap-1.5">
                    <Badge label={STATUS_LABELS[t.Status] || t.Status} color={STATUS_COLORS[t.Status] || "#64748b"} />
                    <Badge label={t.Priority} color={PRIORITY_COLORS[t.Priority] || "#64748b"} />
                  </div>
                </div>
                <p className="font-medium text-foreground mt-1">{t.Subject}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  {t.FollowerName && <span>Assigned: {t.FollowerName}</span>}
                  {t.ProjectName && <span>{t.ProjectName}</span>}
                  {t.TaskDueDate && <span>Due {formatDate(t.TaskDueDate)}</span>}
                </div>
              </button>
            ))}
            {detailTasks.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No tasks found.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <TaskDrawer
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={handleTaskStatusChange}
      />
      </FollowupShell>
    </>
  );
};

export default TagPerformanceReport;
