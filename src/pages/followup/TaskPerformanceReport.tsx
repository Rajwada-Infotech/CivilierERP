import React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Printer,
  Building2,
  FolderOpen,
  Hash,
  FileText as FileTextIcon,
  User,
  Users,
  Flag,
  Gauge,
  Calendar,
  RotateCcw,
  ClipboardList,
  CheckCircle2,
  Clock,
  Activity,
  AlertTriangle,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { Chart2 } from "iconsax-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { DataTable, type ColumnDef, type ExportColumn } from "@/components/ui/DataTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";

const REPORT_API = "/api/task-performance-report";
const ACCENT = "#0d9488";
const ACCENT_SOFT = "#2dd4bf";

const STATUSES = ["Active", "Hold", "Cancel", "Closed"] as const;
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;

const PRIORITY_COLORS: Record<string, string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
};

// Status vocabulary in this schema is Active/Hold/Cancel/Closed (no literal
// "Pending"/"Ongoing" columns) — Hold reads as "Pending" (paused/awaiting)
// and Active reads as "Ongoing" (in progress), matching the same mapping
// used by the Task Transfer feature.
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
  CaseNumber: string | null;
  CaseDocumentNumber: string | null;
  Subject: string;
  Details: string | null;
  CaseProjectId: number | null;
  ProjectName: string | null;
  CaseCompanyId: number | null;
  CompanyName: string | null;
  CreatedBy: number | null;
  CreatedByName: string | null;
  AssignedTo: number | null;
  FollowerName: string | null;
  TaskStartDate: string | null;
  TaskDueDate: string | null;
  TaskCompletionDate: string | null;
  CompletionDayCount: number | null;
  FollowUpAttendCount: number;
  Status: string;
  Priority: string;
  DelayDays: number | null;
  Progress: number;
  EffectiveProgress: number;
}

interface Filters {
  companyId: string;
  projectId: string;
  taskId: string;
  caseId: string;
  createdBy: string;
  followerId: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FILTERS: Filters = {
  companyId: "",
  projectId: "",
  taskId: "",
  caseId: "",
  createdBy: "",
  followerId: "",
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
  if (filters.taskId) params.set("taskId", filters.taskId);
  if (filters.caseId) params.set("caseId", filters.caseId);
  if (filters.createdBy) params.set("createdBy", filters.createdBy);
  if (filters.followerId) params.set("followerId", filters.followerId);
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
  return new Date(dateStr).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function useGlass() {
  const { theme } = useTheme();
  const isDark = theme !== "light";
  const glassCard = isDark
    ? {
        background: "rgba(6, 20, 19, 0.45)",
        border: "1px solid rgba(13,148,136,0.18)",
        backdropFilter: "blur(20px) saturate(160%)",
        WebkitBackdropFilter: "blur(20px) saturate(160%)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)",
      }
    : {
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(13,148,136,0.20)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow: "0 8px 32px rgba(13,148,136,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
      };
  return { isDark, glassCard };
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

function DelayBadge({ row }: { row: ReportRow }) {
  if (row.Status === "Closed") {
    if (row.DelayDays == null) return <Badge label="On Time" color="#22c55e" />;
    return row.DelayDays > 0 ? (
      <Badge label={`${row.DelayDays}d Late`} color="#ef4444" />
    ) : (
      <Badge label="On Time" color="#22c55e" />
    );
  }
  if (row.DelayDays != null && row.DelayDays > 0) {
    return <Badge label={`${row.DelayDays}d Overdue`} color="#ef4444" />;
  }
  return <Badge label="In Progress" color="#64748b" />;
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-3.5 flex items-center gap-3 min-w-0">
      <div className="p-2 rounded-lg shrink-0" style={{ background: `${color}1A`, color }}>
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground font-heading uppercase tracking-wider truncate">{label}</p>
        <p className="text-base font-bold font-mono text-foreground mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}

const selectCls =
  "w-full appearance-none pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";
const inputCls =
  "w-full pl-7 pr-2 py-2 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all";

function FilterField({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-heading uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </label>
      <div className="relative">
        <Icon size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
        {children}
      </div>
    </div>
  );
}

const TaskPerformanceReport: React.FC = () => {
  const { glassCard } = useGlass();
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [dateError, setDateError] = React.useState<string | null>(null);

  const { data: dropdowns } = useQuery({
    queryKey: ["task-performance-report-dropdowns"],
    queryFn: fetchDropdowns,
    staleTime: 5 * 60_000,
  });
  const companies = dropdowns?.companies ?? [];
  const projects = dropdowns?.projects ?? [];
  const visibleProjects = filters.companyId
    ? projects.filter((p) => String(p.company_id) === filters.companyId)
    : projects;

  const { data: users = [] } = useQuery({
    queryKey: ["task-performance-report-users"],
    queryFn: fetchUsers,
    staleTime: 5 * 60_000,
  });

  const {
    data: rows = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["task-performance-report", filters],
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

  // ── Summary cards (computed from the already-filtered dataset) ──────────
  const summary = React.useMemo(() => {
    const total = rows.length;
    const completed = rows.filter((r) => r.Status === "Closed").length;
    const pending = rows.filter((r) => r.Status === "Hold").length;
    const ongoing = rows.filter((r) => r.Status === "Active").length;
    const overdue = rows.filter((r) => r.Status !== "Closed" && r.DelayDays != null && r.DelayDays > 0).length;
    const completionDays = rows
      .map((r) => r.CompletionDayCount)
      .filter((d): d is number => d != null);
    const avgCompletionDays = completionDays.length
      ? (completionDays.reduce((a, b) => a + b, 0) / completionDays.length).toFixed(1)
      : "—";
    const totalFollowUps = rows.reduce((sum, r) => sum + (r.FollowUpAttendCount || 0), 0);
    return { total, completed, pending, ongoing, overdue, avgCompletionDays, totalFollowUps };
  }, [rows]);

  const columns: ColumnDef<ReportRow, unknown>[] = React.useMemo(
    () => [
      {
        id: "TaskNo",
        accessorKey: "TaskNo",
        header: "Task ID",
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-foreground">{row.original.TaskNo || `#${row.original.Id}`}</span>
        ),
      },
      {
        id: "CaseNumber",
        accessorKey: "CaseNumber",
        header: "Case ID",
        size: 110,
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.CaseNumber || "—"}</span>
        ),
      },
      { id: "ProjectName", accessorKey: "ProjectName", header: "Project", size: 140, cell: ({ getValue }) => (getValue() as string) || "—" },
      { id: "CompanyName", accessorKey: "CompanyName", header: "Company", size: 140, cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        id: "Subject",
        accessorKey: "Subject",
        header: "Task Title",
        size: 220,
        cell: ({ row }) => <span className="text-foreground font-medium truncate block" title={row.original.Subject}>{row.original.Subject}</span>,
      },
      { id: "CreatedByName", accessorKey: "CreatedByName", header: "Created By", size: 130, cell: ({ getValue }) => (getValue() as string) || "—" },
      { id: "FollowerName", accessorKey: "FollowerName", header: "Follower / Assigned", size: 140, cell: ({ getValue }) => (getValue() as string) || "—" },
      {
        id: "TaskStartDate",
        accessorKey: "TaskStartDate",
        header: "Start Date",
        size: 110,
        cell: ({ getValue }) => formatDate(getValue() as string),
      },
      {
        id: "TaskDueDate",
        accessorKey: "TaskDueDate",
        header: "Due Date",
        size: 110,
        cell: ({ getValue }) => formatDate(getValue() as string),
      },
      {
        id: "TaskCompletionDate",
        accessorKey: "TaskCompletionDate",
        header: "Completion Date",
        size: 130,
        cell: ({ getValue }) => formatDate(getValue() as string),
      },
      {
        id: "CompletionDayCount",
        accessorKey: "CompletionDayCount",
        header: "Completion Days",
        size: 90,
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          return <span className="font-mono">{v == null ? "—" : v}</span>;
        },
      },
      {
        id: "FollowUpAttendCount",
        accessorKey: "FollowUpAttendCount",
        header: "Follow-Ups",
        size: 90,
        cell: ({ getValue }) => <span className="font-mono">{getValue() as number}</span>,
      },
      {
        id: "Progress",
        accessorKey: "EffectiveProgress",
        header: "Progress %",
        size: 130,
        cell: ({ getValue }) => {
          const pct = getValue() as number;
          return (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden shrink-0">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? "#22c55e" : ACCENT }} />
              </div>
              <span className="text-xs font-mono">{pct}%</span>
            </div>
          );
        },
      },
      {
        id: "Status",
        accessorKey: "Status",
        header: "Status",
        size: 100,
        cell: ({ getValue }) => {
          const s = getValue() as string;
          return <Badge label={STATUS_LABELS[s] || s} color={STATUS_COLORS[s] || "#64748b"} />;
        },
      },
      {
        id: "Priority",
        accessorKey: "Priority",
        header: "Priority",
        size: 110,
        cell: ({ getValue }) => {
          const p = getValue() as string;
          return <Badge label={p} color={PRIORITY_COLORS[p] || "#64748b"} />;
        },
      },
      {
        id: "Delay",
        header: "Delay / On-Time",
        size: 120,
        cell: ({ row }) => <DelayBadge row={row.original} />,
      },
    ],
    [],
  );

  const exportColumns: ExportColumn[] = [
    { header: "Task ID", accessor: (r) => r.TaskNo || `#${r.Id}` },
    { header: "Case ID", accessor: (r) => r.CaseNumber || "—" },
    { header: "Project", accessor: (r) => r.ProjectName || "—" },
    { header: "Company", accessor: (r) => r.CompanyName || "—" },
    { header: "Task Title", accessor: "Subject" },
    { header: "Created By", accessor: (r) => r.CreatedByName || "—" },
    { header: "Follower/Assigned", accessor: (r) => r.FollowerName || "—" },
    { header: "Start Date", accessor: (r) => formatDate(r.TaskStartDate as string) },
    { header: "Due Date", accessor: (r) => formatDate(r.TaskDueDate as string) },
    { header: "Completion Date", accessor: (r) => formatDate(r.TaskCompletionDate as string) },
    { header: "Completion Days", accessor: (r) => (r.CompletionDayCount == null ? "—" : String(r.CompletionDayCount)) },
    { header: "Follow-Ups", accessor: "FollowUpAttendCount" },
    { header: "Progress %", accessor: (r) => `${r.EffectiveProgress ?? r.Progress ?? 0}%` },
    { header: "Status", accessor: (r) => STATUS_LABELS[r.Status as string] || (r.Status as string) },
    { header: "Priority", accessor: "Priority" },
    {
      header: "Delay Days",
      accessor: (r) => (r.DelayDays == null ? "—" : String(r.DelayDays)),
    },
  ];

  const handlePrint = () => {
    if (rows.length === 0) {
      toast.error("No data to print for the current filters");
      return;
    }
    window.print();
  };

  return (
    <FollowupShell
      title="Task Performance Report"
      subtitle="Completion time, delays and follow-up activity across all tasks"
      icon={Chart2}
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
          body > *:not(#tpr-printable) { display: none !important; }
          #tpr-printable { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="tpr-printable">
        {/* ── Summary cards ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
          <StatCard label="Total Tasks" value={summary.total} icon={ClipboardList} color="#0d9488" />
          <StatCard label="Completed" value={summary.completed} icon={CheckCircle2} color="#22c55e" />
          <StatCard label="Pending" value={summary.pending} icon={Clock} color="#f59e0b" />
          <StatCard label="Ongoing" value={summary.ongoing} icon={Activity} color="#3b82f6" />
          <StatCard label="Overdue" value={summary.overdue} icon={AlertTriangle} color="#ef4444" />
          <StatCard label="Avg. Completion Days" value={summary.avgCompletionDays} icon={TrendingUp} color="#8b5cf6" />
          <StatCard label="Total Follow-Ups" value={summary.totalFollowUps} icon={MessageSquare} color="#ec4899" />
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <div className="no-print rounded-xl p-4 mb-5" style={glassCard}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT_SOFT }}>
              Filters
            </p>
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <RotateCcw size={11} /> Reset
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <FilterField icon={Building2} label="Company">
              <select className={selectCls} value={filters.companyId} onChange={(e) => updateFilter({ companyId: e.target.value, projectId: "" })}>
                <option value="">All Companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={FolderOpen} label="Project">
              <select className={selectCls} value={filters.projectId} onChange={(e) => updateFilter({ projectId: e.target.value })}>
                <option value="">All Projects</option>
                {visibleProjects.map((p) => (
                  <option key={p.id} value={String(p.id)}>{p.name}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={Hash} label="Task ID">
              <input
                type="text"
                className={inputCls}
                placeholder="e.g. TSK000012"
                value={filters.taskId}
                onChange={(e) => updateFilter({ taskId: e.target.value })}
              />
            </FilterField>

            <FilterField icon={FileTextIcon} label="Case ID">
              <input
                type="text"
                className={inputCls}
                placeholder="Case / document no."
                value={filters.caseId}
                onChange={(e) => updateFilter({ caseId: e.target.value })}
              />
            </FilterField>

            <FilterField icon={User} label="Created By">
              <select className={selectCls} value={filters.createdBy} onChange={(e) => updateFilter({ createdBy: e.target.value })}>
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>{u.name}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={Users} label="Follower / User">
              <select className={selectCls} value={filters.followerId} onChange={(e) => updateFilter({ followerId: e.target.value })}>
                <option value="">All Users</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>{u.name}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={Gauge} label="Task Status">
              <select className={selectCls} value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
                <option value="">All Statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={Flag} label="Priority">
              <select className={selectCls} value={filters.priority} onChange={(e) => updateFilter({ priority: e.target.value })}>
                <option value="">All Priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </FilterField>

            <FilterField icon={Calendar} label="Start Date">
              <input
                type="date"
                className={inputCls}
                value={filters.startDate}
                onChange={(e) => updateFilter({ startDate: e.target.value })}
              />
            </FilterField>

            <FilterField icon={Calendar} label="End Date">
              <input
                type="date"
                className={inputCls}
                value={filters.endDate}
                onChange={(e) => updateFilter({ endDate: e.target.value })}
              />
            </FilterField>
          </div>

          {dateError && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{dateError}</p>}
        </div>

        {/* ── Data table ─────────────────────────────────────────────────── */}
        <div className="rounded-xl overflow-hidden" style={glassCard}>
          <DataTable
            data={rows}
            columns={columns}
            loading={isLoading || isFetching}
            searchPlaceholder="Search tasks…"
            emptyMessage="No tasks match the selected filters."
            exportConfig={{
              title: "Task Performance Report",
              filename: "task-performance-report",
              subtitle: [
                filters.status && STATUS_LABELS[filters.status],
                filters.priority,
                filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : "",
              ]
                .filter(Boolean)
                .join(" · "),
              columns: exportColumns,
            }}
          />
        </div>
      </div>
    </FollowupShell>
  );
};

export default TaskPerformanceReport;
