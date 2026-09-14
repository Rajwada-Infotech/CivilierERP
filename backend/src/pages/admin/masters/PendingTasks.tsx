import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  UserCircle,
  Zap,
  CalendarClock,
  CalendarDays,
  ListTodo,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = "open" | "in_progress" | "closed" | "reviewed";
type TaskPriority = "low" | "medium" | "high";
type FilterStatus = "all" | TaskStatus;

interface PendingTask {
  id: string;
  title: string;
  description: string;
  module?: string | null;
  priority: TaskPriority | null;
  status: TaskStatus;
  assignedTo: string;
  assignedToName: string;
  createdBy: string;
  createdByName: string;
  dueDate: string;
}

interface TaskFormState {
  title: string;
  description: string;
  priority: TaskPriority;
  assignedTo: string;
  dueDate: string;
}

const EMPTY_FORM: TaskFormState = {
  title: "",
  description: "",
  priority: "medium",
  assignedTo: "",
  dueDate: "",
};

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchPendingTasks(): Promise<PendingTask[]> {
  const res = await fetchWithAuth("/api/tasks?module=followup");
  if (!res.ok) throw new Error("Failed to load tasks");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : (data.data ?? []);
}

async function createPendingTask(payload: {
  title: string;
  description?: string;
  priority: TaskPriority;
  assignedTo: string;
  dueDate: string;
  module: "followup";
}) {
  const res = await fetchWithAuth("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create task");
  }
}

async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update task");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function getDaysUntilDue(dueDate?: string | null): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.floor((due.getTime() - today.getTime()) / 86400000);
}

function isOverdue(task: PendingTask) {
  if (!task.dueDate || task.status === "closed" || task.status === "reviewed")
    return false;
  return (getDaysUntilDue(task.dueDate) ?? 0) < 0;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  borderL,
  iconClass,
  sublabel,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
  borderL: string;
  iconClass: string;
  sublabel?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative bg-card rounded-xl border p-5 overflow-hidden transition-all duration-200 border-l-2 ${borderL} ${
        onClick ? "cursor-pointer select-none" : ""
      } ${
        active
          ? "border-primary/40 shadow-md shadow-primary/10 ring-2 ring-primary/10"
          : "border-border hover:border-primary/25 hover:shadow-md"
      }`}
    >
      <div
        className={`absolute top-0 right-0 w-24 h-24 rounded-full opacity-10 -translate-y-6 translate-x-6 ${accent}`}
      />
      <div
        className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3 ${accent} bg-opacity-10`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="text-3xl font-bold text-foreground tracking-tight">
        {value}
      </div>
      <div className="text-sm font-medium text-muted-foreground mt-0.5">
        {label}
      </div>
      {sublabel && (
        <div className="text-xs text-muted-foreground/70 mt-1">
          {sublabel}
        </div>
      )}
    </div>
  );
}

function PriorityPill({ priority }: { priority: TaskPriority | null }) {
  const p = priority ?? "medium";
  const map: Record<TaskPriority, { bg: string; dot: string }> = {
    high: {
      bg: "bg-red-500/10 text-red-600 border border-red-500/20",
      dot: "bg-red-500",
    },
    medium: {
      bg: "bg-amber-500/10 text-amber-600 border border-amber-500/20",
      dot: "bg-amber-500",
    },
    low: {
      bg: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
      dot: "bg-emerald-500",
    },
  };
  const s = map[p];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {p}
    </span>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, { bg: string; dot: string; label: string }> = {
    open: {
      bg: "bg-muted text-muted-foreground border border-border",
      dot: "bg-muted-foreground",
      label: "Open",
    },
    in_progress: {
      bg: "bg-blue-500/10 text-blue-600 border border-blue-500/20",
      dot: "bg-blue-500",
      label: "In Progress",
    },
    closed: {
      bg: "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20",
      dot: "bg-emerald-500",
      label: "Closed",
    },
    reviewed: {
      bg: "bg-primary/10 text-primary border border-primary/20",
      dot: "bg-primary",
      label: "Reviewed",
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      {s.label}
    </span>
  );
}

function DueDateChip({ task }: { task: PendingTask }) {
  const days = getDaysUntilDue(task.dueDate);
  const done = task.status === "closed" || task.status === "reviewed";

  if (days === null)
    return <span className="text-muted-foreground text-sm">—</span>;
  if (done)
    return (
      <span className="text-muted-foreground text-sm">
        {fmtDate(task.dueDate)}
      </span>
    );
  if (days < 0)
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600">
        <Zap className="w-3.5 h-3.5" />
        {Math.abs(days)}d overdue
      </span>
    );
  if (days === 0)
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
        <CalendarClock className="w-3.5 h-3.5" />
        Due today
      </span>
    );
  return (
    <span className="text-muted-foreground text-sm tabular-nums">
      {fmtDate(task.dueDate)}
      <span className="text-muted-foreground/70 text-xs ml-1">({days}d)</span>
    </span>
  );
}

function CompletionBar({ tasks }: { tasks: PendingTask[] }) {
  const total = tasks.length || 1;
  const segments = [
    {
      key: "open",
      color: "bg-muted-foreground/40",
      count: tasks.filter((t) => t.status === "open").length,
    },
    {
      key: "in_progress",
      color: "bg-blue-400",
      count: tasks.filter((t) => t.status === "in_progress").length,
    },
    {
      key: "closed",
      color: "bg-emerald-400",
      count: tasks.filter((t) => t.status === "closed").length,
    },
    {
      key: "reviewed",
      color: "bg-primary",
      count: tasks.filter((t) => t.status === "reviewed").length,
    },
  ];
  return (
    <div className="flex h-2 rounded-full overflow-hidden gap-px">
      {segments.map((s) =>
        s.count > 0 ? (
          <div
            key={s.key}
            className={`h-full ${s.color} transition-all duration-500`}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

function EmptyState({ search }: { search: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
        <Inbox className="w-8 h-8 text-muted-foreground" />
      </div>
      <p className="text-foreground font-medium">
        {search ? "No tasks match your search" : "No pending tasks yet"}
      </p>
      <p className="text-muted-foreground text-sm mt-1">
        {search
          ? "Try adjusting your search or filters"
          : "Create a task to get started"}
      </p>
    </div>
  );
}

function TaskRow({
  task,
  onStatusChange,
  isUpdating,
}: {
  task: PendingTask;
  onStatusChange: (id: string, status: TaskStatus) => void;
  isUpdating: boolean;
}) {
  const overdue = isOverdue(task);

  return (
    <div
      className={`group grid grid-cols-[1fr_144px] gap-3 items-center px-5 py-4 border-b border-border/60 last:border-b-0 transition-colors duration-100 ${
        overdue ? "bg-red-500/5 hover:bg-red-500/10" : "hover:bg-muted/40"
      }`}
    >
      {/* Main columns */}
      <div className="grid grid-cols-[minmax(180px,2.5fr)_90px_130px_150px_100px] gap-4 items-center min-w-0">
        {/* Title */}
        <div className="min-w-0">
          <div
            className={`font-semibold text-sm leading-5 truncate ${
              overdue ? "text-red-600" : "text-foreground"
            }`}
          >
            {task.title}
          </div>
          {task.description && (
            <div className="text-xs text-muted-foreground truncate mt-0.5">
              {task.description}
            </div>
          )}
        </div>

        {/* Priority */}
        <div>
          <PriorityPill priority={task.priority} />
        </div>

        {/* Assigned to */}
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <UserCircle className="w-3.5 h-3.5 text-primary" />
          </div>
          <span className="text-sm text-muted-foreground truncate">
            {task.assignedToName || "—"}
          </span>
        </div>

        {/* Due date */}
        <div>
          <DueDateChip task={task} />
        </div>

        {/* Status */}
        <div>
          <StatusPill status={task.status} />
        </div>
      </div>

      {/* Hover action: status updater */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <Select
          value={task.status}
          onValueChange={(v) => onStatusChange(task.id, v as TaskStatus)}
          disabled={isUpdating}
        >
          <SelectTrigger className="h-8 w-36 text-xs rounded-lg border-border bg-background shadow-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PendingTasksPage() {
  const queryClient = useQueryClient();
  const { allUsers } = useAuth();
  const rights = usePageRights("followup-tasks");

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | TaskPriority>(
    "all",
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);

  const {
    data: tasks = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["pending-tasks-setup"],
    queryFn: fetchPendingTasks,
    staleTime: 2 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: createPendingTask,
    onSuccess: () => {
      toast.success("Task created");
      queryClient.invalidateQueries({ queryKey: ["pending-tasks-setup"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      updateTaskStatus(taskId, status),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["pending-tasks-setup"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const counts = useMemo(
    () => ({
      total: tasks.length,
      open: tasks.filter((t) => t.status === "open").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter(
        (t) => t.status === "closed" || t.status === "reviewed",
      ).length,
      overdue: tasks.filter(isOverdue).length,
    }),
    [tasks],
  );

  const filteredTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesSearch = [
          task.title,
          task.description,
          task.assignedToName,
          task.createdByName,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());

        const matchesStatus =
          activeFilter === "all" || task.status === activeFilter;

        const matchesPriority =
          priorityFilter === "all" ||
          (task.priority ?? "medium") === priorityFilter;

        return matchesSearch && matchesStatus && matchesPriority;
      }),
    [tasks, search, activeFilter, priorityFilter],
  );

  const filterTabs: { key: FilterStatus; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.total },
    { key: "open", label: "Open", count: counts.open },
    { key: "in_progress", label: "In Progress", count: counts.inProgress },
    { key: "closed", label: "Completed", count: counts.completed },
  ];

  return (
    <>
      <Breadcrumbs items={["Follow-Up", "Pending Tasks"]} />
      <FollowupShell
        title="Pending Tasks"
        icon={Clock}
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
            {rights.canCreate && (
              <Button
                size="sm"
                onClick={() => setIsDialogOpen(true)}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                <Plus size={14} />
                New Task
              </Button>
            )}
          </div>
        }
      >

        {/* ── Stat Cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Open"
            value={counts.open}
            icon={ListTodo}
            accent="bg-slate-500"
            borderL="border-l-slate-500"
            iconClass="bg-slate-500/10 text-slate-400"
            sublabel="Awaiting action"
            active={activeFilter === "open"}
            onClick={() =>
              setActiveFilter((p) => (p === "open" ? "all" : "open"))
            }
          />
          <StatCard
            label="In Progress"
            value={counts.inProgress}
            icon={Activity}
            accent="bg-primary"
            borderL="border-l-primary"
            iconClass="bg-primary/10 text-primary"
            sublabel="Currently active"
            active={activeFilter === "in_progress"}
            onClick={() =>
              setActiveFilter((p) =>
                p === "in_progress" ? "all" : "in_progress",
              )
            }
          />
          <StatCard
            label="Completed"
            value={counts.completed}
            icon={CheckCircle2}
            accent="bg-emerald-500"
            borderL="border-l-emerald-500"
            iconClass="bg-emerald-500/10 text-emerald-500"
            sublabel="Closed + reviewed"
            active={activeFilter === "closed"}
            onClick={() =>
              setActiveFilter((p) => (p === "closed" ? "all" : "closed"))
            }
          />
          <StatCard
            label="Overdue"
            value={counts.overdue}
            icon={AlertCircle}
            accent="bg-red-500"
            borderL="border-l-red-500"
            iconClass="bg-red-500/10 text-red-500"
            sublabel="Past due date"
          />
        </div>

        {/* ── Completion bar ── */}
        {tasks.length > 0 && (
          <div className="bg-card rounded-xl border border-border px-5 py-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" />
                Overall Progress
              </span>
              <span className="text-foreground font-semibold">
                {counts.completed} / {counts.total} completed
                {counts.total > 0 && (
                  <span className="text-muted-foreground font-normal ml-1">
                    ({Math.round((counts.completed / counts.total) * 100)}%)
                  </span>
                )}
              </span>
            </div>
            <CompletionBar tasks={tasks} />
            <div className="flex items-center gap-5 pt-0.5">
              {[
                { color: "bg-muted-foreground/40", label: "Open" },
                { color: "bg-blue-400", label: "In Progress" },
                { color: "bg-emerald-400", label: "Closed" },
                { color: "bg-primary", label: "Reviewed" },
              ].map((l) => (
                <span
                  key={l.label}
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                >
                  <span className={`w-2 h-2 rounded-full ${l.color}`} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Table Card ── */}
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              {/* Status tabs */}
              <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                      activeFilter === tab.key
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                        activeFilter === tab.key
                          ? "bg-primary/10 text-primary"
                          : "bg-background text-muted-foreground"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {/* Priority filter */}
                <div className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                  <div className="relative">
                    <select
                      value={priorityFilter}
                      onChange={(e) =>
                        setPriorityFilter(e.target.value as "all" | TaskPriority)
                      }
                      className="appearance-none text-sm text-foreground bg-background border border-border rounded-lg pl-2 pr-7 py-1.5 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition-all"
                    >
                      <option value="all">All priorities</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  </div>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tasks…"
                    className="pl-9 pr-4 py-2 w-56 text-sm bg-background border border-border rounded-xl outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition-all placeholder:text-muted-foreground text-foreground"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_144px] gap-3 px-5 py-3 border-b border-border bg-muted/40">
            <div className="grid grid-cols-[minmax(180px,2.5fr)_90px_130px_150px_100px] gap-4">
              {["Task", "Priority", "Assigned To", "Due Date", "Status"].map(
                (h) => (
                  <span
                    key={h}
                    className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                  >
                    {h}
                  </span>
                ),
              )}
            </div>
            <span />
          </div>

          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex flex-col gap-3 p-5">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-muted animate-pulse"
                  style={{ opacity: 1 - i * 0.13 }}
                />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-foreground font-medium">Failed to load tasks</p>
              <button
                onClick={() => refetch()}
                className="text-sm text-primary hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && filteredTasks.length === 0 && (
            <EmptyState search={search} />
          )}

          {/* Rows */}
          {!isLoading &&
            !isError &&
            filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onStatusChange={(id, status) =>
                  updateStatusMutation.mutate({ taskId: id, status })
                }
                isUpdating={updateStatusMutation.isPending}
              />
            ))}

          {/* Footer */}
          {!isLoading && !isError && filteredTasks.length > 0 && (
            <div className="px-5 py-3 border-t border-border bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-semibold text-foreground">
                  {filteredTasks.length}
                </span>{" "}
                of{" "}
                <span className="font-semibold text-foreground">
                  {tasks.length}
                </span>{" "}
                tasks
                {search && ` matching "${search}"`}
              </p>
            </div>
          )}
        </div>
      </FollowupShell>

      {/* ── New Task Dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg">New Task</DialogTitle>
            <DialogDescription className="text-xs mt-0.5">
              Adds a task under{" "}
              <code className="font-mono">module=followup</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Title <span className="text-red-500">*</span>
              </label>
              <Input
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="e.g. Follow up on payment"
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional details…"
                rows={3}
                className="flex w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Priority
                </label>
                <Select
                  value={form.priority}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, priority: v as TaskPriority }))
                  }
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">
                  Due Date <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <CalendarDays size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70" />
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className="w-full pl-8 pr-3 py-2 rounded-xl text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">
                Assign To <span className="text-red-500">*</span>
              </label>
              <Select
                value={form.assignedTo}
                onValueChange={(v) => setForm((f) => ({ ...f, assignedTo: v }))}
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {allUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="mt-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setIsDialogOpen(false)}
              className="rounded-xl flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  title: form.title.trim(),
                  description: form.description.trim() || undefined,
                  priority: form.priority,
                  assignedTo: form.assignedTo,
                  dueDate: form.dueDate,
                  module: "followup",
                })
              }
              disabled={
                !form.title.trim() ||
                !form.assignedTo ||
                !form.dueDate ||
                createMutation.isPending
              }
              className="rounded-xl flex-1 gradient-accent text-primary-foreground"
            >
              {createMutation.isPending ? "Creating…" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
