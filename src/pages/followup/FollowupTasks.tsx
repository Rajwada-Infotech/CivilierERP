import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Activity,
  ListTodo,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

interface FollowupTask {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n ?? 0);

const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

function isOverdue(task: FollowupTask) {
  if (!task.dueDate || task.status === "closed" || task.status === "reviewed")
    return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate);
  due.setHours(0, 0, 0, 0);
  return due < today;
}

// ─── Status / Priority badges ─────────────────────────────────────────────────
const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "bg-slate-500/10 text-slate-600 border-slate-400/20",
  in_progress: "bg-blue-500/10 text-blue-600 border-blue-400/20",
  closed: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  reviewed: "bg-purple-500/10 text-purple-600 border-purple-400/20",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-400/20",
  medium: "bg-amber-500/10 text-amber-600 border-amber-400/20",
  high: "bg-red-500/10 text-red-600 border-red-400/20",
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_COLORS[status as TaskStatus] ??
    "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  const p = (priority ?? "medium") as TaskPriority;
  const cls =
    PRIORITY_COLORS[p] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border capitalize ${cls}`}
    >
      {p}
    </span>
  );
}

// ─── API fns ──────────────────────────────────────────────────────────────────
async function fetchFollowupTasks(): Promise<FollowupTask[]> {
  const res = await fetchWithAuth("/api/tasks?module=followup");
  if (!res.ok) throw new Error("Failed to load follow-up tasks");
  return res.json();
}

async function createFollowupTask(payload: {
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

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor = "text-indigo-600",
  iconBg = "bg-indigo-500/10",
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  iconColor?: string;
  iconBg?: string;
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
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-indigo-600" />
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

// ─── Column defs ──────────────────────────────────────────────────────────────
function makeColumns(
  updateStatusMutation: ReturnType<
    typeof useMutation<void, Error, { taskId: string; status: TaskStatus }>
  >,
): ColumnDef<FollowupTask>[] {
  return [
    {
      id: "title",
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <div className={isOverdue(row.original) ? "text-red-600" : ""}>
          <p className="text-xs font-medium text-foreground leading-snug line-clamp-1">
            {row.original.title}
          </p>
          {row.original.description && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
              {row.original.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "priority",
      accessorKey: "priority",
      header: "Priority",
      cell: ({ getValue }) => (
        <PriorityBadge priority={getValue() as string | null} />
      ),
    },
    {
      id: "assignedToName",
      accessorKey: "assignedToName",
      header: "Assigned To",
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">
          {(getValue() as string) || "—"}
        </span>
      ),
    },
    {
      id: "dueDate",
      accessorKey: "dueDate",
      header: "Due Date",
      cell: ({ row }) => (
        <span
          className={`text-xs ${
            isOverdue(row.original)
              ? "text-red-600 font-medium"
              : "text-muted-foreground"
          }`}
        >
          {fmtDate(row.original.dueDate)}
        </span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
    },
    {
      id: "actions",
      header: "Update",
      cell: ({ row }) => (
        <Select
          value={row.original.status}
          onValueChange={(val) =>
            updateStatusMutation.mutate({
              taskId: row.original.id,
              status: val as TaskStatus,
            })
          }
        >
          <SelectTrigger className="h-7 w-32 text-[10px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ];
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────
function StatusBreakdown({ tasks }: { tasks: FollowupTask[] }) {
  const entries = [
    { status: "open", label: "Open", color: "bg-slate-400" },
    { status: "in_progress", label: "In Progress", color: "bg-blue-500" },
    { status: "closed", label: "Closed", color: "bg-emerald-500" },
    { status: "reviewed", label: "Reviewed", color: "bg-purple-500" },
  ].map((e) => ({
    ...e,
    count: tasks.filter((t) => t.status === e.status).length,
  }));

  const total = tasks.length || 1;

  return (
    <div className="space-y-2 mt-2">
      {entries.map(({ status, label, color, count }) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={status}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{label}</span>
              <span className="font-medium text-foreground">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Priority Breakdown ───────────────────────────────────────────────────────
function PriorityBreakdown({ tasks }: { tasks: FollowupTask[] }) {
  const entries = [
    { priority: "high", label: "High", color: "bg-red-500" },
    { priority: "medium", label: "Medium", color: "bg-amber-500" },
    { priority: "low", label: "Low", color: "bg-emerald-500" },
  ].map((e) => ({
    ...e,
    count: tasks.filter((t) => (t.priority ?? "medium") === e.priority).length,
  }));

  const total = tasks.length || 1;

  return (
    <div className="space-y-2 mt-2">
      {entries.map(({ priority, label, color, count }) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={priority}>
            <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
              <span>{label}</span>
              <span className="font-medium text-foreground">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function FollowupTasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentUser, allUsers } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);

  const canCreate =
    currentUser?.role === "admin" ||
    currentUser?.role === "super_admin" ||
    currentUser?.role === "dba";

  const {
    data: tasks = [],
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["followup-tasks"],
    queryFn: fetchFollowupTasks,
    staleTime: 2 * 60 * 1000,
  });

  const createMutation = useMutation({
    mutationFn: createFollowupTask,
    onSuccess: () => {
      toast.success("Task created");
      queryClient.invalidateQueries({ queryKey: ["followup-tasks"] });
      setForm(EMPTY_FORM);
      setIsDialogOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      updateTaskStatus(taskId, status),
    onSuccess: () => {
      toast.success("Task updated");
      queryClient.invalidateQueries({ queryKey: ["followup-tasks"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const columns = makeColumns(updateStatusMutation);

  const openCount = tasks.filter((t) => t.status === "open").length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const completedCount = tasks.filter(
    (t) => t.status === "closed" || t.status === "reviewed",
  ).length;
  const overdueCount = tasks.filter(isOverdue).length;

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Tasks", path: "/followup/follow-ups/tasks" },
        ]}
      />
      <div className="relative space-y-8 mt-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-heading font-bold text-foreground">
              Follow-Up Tasks
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live task list filtered to the follow-up module
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                className={isFetching ? "animate-spin" : ""}
              />
              Refresh
            </button>
            {canCreate && (
              <Button
                onClick={() => setIsDialogOpen(true)}
                className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
              >
                <Plus size={14} />
                New Task
              </Button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Open Tasks"
            value={fmtNum(openCount)}
            sub={`${fmtNum(tasks.length)} total`}
            icon={AlertCircle}
            iconColor="text-slate-600"
            iconBg="bg-slate-500/10"
          />
          <StatCard
            label="In Progress"
            value={fmtNum(inProgressCount)}
            sub="Currently active"
            icon={Activity}
            iconColor="text-blue-600"
            iconBg="bg-blue-500/10"
          />
          <StatCard
            label="Completed"
            value={fmtNum(completedCount)}
            sub="Closed + reviewed"
            icon={CheckCircle2}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-500/10"
          />
          <StatCard
            label="Overdue"
            value={fmtNum(overdueCount)}
            sub="Past due date"
            icon={Clock}
            iconColor="text-red-600"
            iconBg="bg-red-500/10"
          />
        </div>

        {/* Main content: table + breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Task Table — takes 2/3 width */}
          <div className="lg:col-span-2 rounded-xl border border-border bg-card overflow-hidden">
            <div className="p-4 border-b border-border">
              <SectionHeader
                icon={ListTodo}
                title="All Follow-Up Tasks"
                sub="module=followup"
              />
            </div>
            <DataTable
              data={tasks}
              columns={columns}
              searchable
              searchPlaceholder="Search title, description or assignee…"
              paginated
              defaultPageSize={10}
              loading={isLoading}
              emptyMessage="No follow-up tasks found."
              rowClassName={(row) =>
                isOverdue(row.original) ? "bg-red-500/5" : ""
              }
            />
          </div>

          {/* Breakdowns — takes 1/3 width */}
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader icon={ListTodo} title="Status Breakdown" />
              {isLoading ? (
                <div className="space-y-2 animate-pulse">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-5 bg-muted rounded" />
                  ))}
                </div>
              ) : (
                <StatusBreakdown tasks={tasks} />
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <SectionHeader icon={Activity} title="Priority Breakdown" />
              {isLoading ? (
                <div className="space-y-2 animate-pulse">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-5 bg-muted rounded" />
                  ))}
                </div>
              ) : (
                <PriorityBreakdown tasks={tasks} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New Task Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Follow-Up Task</DialogTitle>
            <DialogDescription>
              Creates a task with{" "}
              <code className="text-xs">module=followup</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(e) =>
                  setForm((c) => ({ ...c, title: e.target.value }))
                }
                placeholder="Task title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((c) => ({ ...c, description: e.target.value }))
                }
                placeholder="Optional details"
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select
                  value={form.priority}
                  onValueChange={(v) =>
                    setForm((c) => ({ ...c, priority: v as TaskPriority }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Due Date</label>
                <div className="relative">
                  <CalendarDays
                    size={13}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground pointer-events-none opacity-70"
                  />
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) =>
                      setForm((c) => ({ ...c, dueDate: e.target.value }))
                    }
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Assign To</label>
              <Select
                value={form.assignedTo}
                onValueChange={(v) => setForm((c) => ({ ...c, assignedTo: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
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

          <DialogFooter>
            <button type="button" className="px-4 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </button>
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
              className="gradient-accent gap-1.5 shrink-0 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {createMutation.isPending ? "Creating…" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}