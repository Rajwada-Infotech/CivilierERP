import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  useTask,
  Task,
  TaskStatus,
  TaskPriority,
} from "@/contexts/TaskContext";
import { useReminders, formatRelative } from "@/hooks/useReminders";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus,
  Search,
  Clock,
  CheckCircle2,
  Circle,
  AlertCircle,
  ChevronRight,
  CalendarDays,
  User,
  Flag,
  RefreshCw,
  Loader2,
  Bell,
  CreditCard,
  Package,
  BookOpen,
  FileWarning,
  CheckSquare,
  ShoppingCart,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import TaskFormModal from "./tasks/TaskFormModal";

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TaskStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  open: {
    label: "Open",
    color: "text-blue-400",
    bg: "bg-blue-500/15",
    icon: Circle,
  },
  in_progress: {
    label: "In Progress",
    color: "text-yellow-400",
    bg: "bg-yellow-500/15",
    icon: Clock,
  },
  closed: {
    label: "Closed",
    color: "text-purple-400",
    bg: "bg-purple-500/15",
    icon: CheckCircle2,
  },
  reviewed: {
    label: "Reviewed",
    color: "text-green-400",
    bg: "bg-green-500/15",
    icon: CheckCircle2,
  },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> =
  {
    low: { label: "Low", color: "text-muted-foreground" },
    medium: { label: "Medium", color: "text-yellow-400" },
    high: { label: "High", color: "text-red-400" },
  };

const URGENCY_CONFIG = {
  overdue: {
    label: "Overdue",
    className: "bg-red-500/15 text-red-600 border-red-400/30",
    dot: "bg-red-500",
  },
  today: {
    label: "Today",
    className: "bg-amber-500/15 text-amber-600 border-amber-400/30",
    dot: "bg-amber-500",
  },
  soon: {
    label: "Soon",
    className: "bg-blue-500/15 text-blue-600 border-blue-400/30",
    dot: "bg-blue-500",
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
};

const REM_ICON: Record<string, React.ElementType> = {
  payment: CreditCard,
  deadline: CalendarDays,
  purchase_order: ShoppingCart,
  grn: Package,
  cheque: BookOpen,
  tds: FileWarning,
  task: CheckSquare,
  general: Bell,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isOverdue = (task: Task) =>
  (task.status === "open" || task.status === "in_progress") &&
  new Date(task.dueDate) < new Date();

const isDueSoon = (task: Task) => {
  const now = new Date();
  const due = new Date(task.dueDate);
  const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  return (
    (task.status === "open" || task.status === "in_progress") &&
    due >= now &&
    due <= soon
  );
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const TaskCardSkeleton = () => (
  <div className="rounded-xl bg-card border border-border p-4 space-y-3 animate-pulse">
    <div className="h-4 bg-muted rounded w-3/4" />
    <div className="h-3 bg-muted rounded w-full" />
    <div className="h-3 bg-muted rounded w-2/3" />
    <div className="flex gap-2 mt-2">
      <div className="h-5 w-14 bg-muted rounded-full" />
      <div className="h-5 w-20 bg-muted rounded-full" />
    </div>
  </div>
);

// ─── Task card ────────────────────────────────────────────────────────────────

const TaskCard = ({ task, onClick }: { task: Task; onClick: () => void }) => {
  const overdue = isOverdue(task);
  const dueSoon = isDueSoon(task);
  const cfg = STATUS_CONFIG[task.status];
  const StatusIcon = cfg.icon;
  const metCount = task.qualityCriteria.filter((q) => q.met).length;
  const totalCount = task.qualityCriteria.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={onClick}
      className="rounded-xl bg-card border border-border p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
      style={
        overdue
          ? { borderLeftWidth: 3, borderLeftColor: "hsl(0,72%,51%)" }
          : dueSoon
            ? { borderLeftWidth: 3, borderLeftColor: "hsl(38,92%,50%)" }
            : {}
      }
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon size={15} className={`${cfg.color} shrink-0`} />
          <h3 className="text-sm font-heading font-semibold text-foreground line-clamp-1">
            {task.title}
          </h3>
        </div>
        <ChevronRight
          size={15}
          className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors"
        />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
        {task.description}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`flex items-center gap-1 text-xs font-heading ${PRIORITY_CONFIG[task.priority].color}`}
        >
          <Flag size={11} /> {PRIORITY_CONFIG[task.priority].label}
        </span>
        <span
          className={`flex items-center gap-1 text-xs font-heading ${overdue ? "text-red-400" : dueSoon ? "text-yellow-400" : "text-muted-foreground"}`}
        >
          <CalendarDays size={11} />
          <span className="hidden sm:inline">
            {overdue ? "Overdue · " : dueSoon ? "Due soon · " : ""}
          </span>
          {formatDate(task.dueDate)}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground font-heading ml-auto">
          <User size={11} />{" "}
          <span className="truncate max-w-[80px]">{task.assignedToName}</span>
        </span>
      </div>

      {totalCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground font-heading">
              Quality
            </span>
            <span className="text-[10px] text-muted-foreground font-heading">
              {metCount}/{totalCount}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${totalCount > 0 ? (metCount / totalCount) * 100 : 0}%`,
                background: "hsl(var(--primary))",
              }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span
          className={`px-2 py-0.5 rounded-full text-[11px] font-heading ${cfg.bg} ${cfg.color}`}
        >
          {cfg.label}
        </span>
        {task.comments.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {task.comments.length} comment
            {task.comments.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </motion.div>
  );
};

// ─── Reminders panel ──────────────────────────────────────────────────────────

const RemindersPanel = () => {
  const navigate = useNavigate();
  const { reminders, loading, refresh, fetched } = useReminders({
    fetchOnMount: true,
  });

  const urgencyCounts = reminders.reduce(
    (acc, r) => {
      acc[r.urgency] = (acc[r.urgency] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-amber-500" />
          <span className="text-sm font-heading font-semibold text-foreground">
            Reminders
          </span>
          {(urgencyCounts.overdue || 0) + (urgencyCounts.today || 0) > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white leading-none">
              {(urgencyCounts.overdue || 0) + (urgencyCounts.today || 0)}
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          title="Refresh reminders"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Summary pills */}
      {!loading && reminders.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border/60 flex-wrap">
          {(["overdue", "today", "soon"] as const).map((u) =>
            urgencyCounts[u] ? (
              <span
                key={u}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${URGENCY_CONFIG[u].className}`}
              >
                {urgencyCounts[u]} {URGENCY_CONFIG[u].label}
              </span>
            ) : null,
          )}
        </div>
      )}

      {/* Body */}
      {loading && !fetched ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <RefreshCw size={16} className="text-muted-foreground animate-spin" />
          <span className="text-xs text-muted-foreground">
            Loading reminders…
          </span>
        </div>
      ) : reminders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
          <CheckCircle2 size={28} className="text-emerald-500" />
          <p className="text-sm font-heading font-semibold text-foreground">
            All clear!
          </p>
          <p className="text-xs text-muted-foreground">
            No overdue or upcoming items in the next 7 days.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60 max-h-80 overflow-y-auto">
          {reminders.map((r) => {
            const Icon = REM_ICON[r.type] ?? Bell;
            const cfg = URGENCY_CONFIG[r.urgency];
            const isTask = r.type === "task";
            return (
              <div
                key={r.id}
                onClick={() => {
                  if (isTask)
                    navigate(r.taskId ? `/tasks/${r.taskId}` : "/tasks");
                }}
                className={`flex items-start gap-3 px-4 py-3 transition-colors
                  ${isTask ? "cursor-pointer" : "cursor-default"}
                  ${r.urgency === "overdue" ? "bg-red-500/5 hover:bg-red-500/10" : r.urgency === "today" ? "bg-amber-500/5 hover:bg-amber-500/10" : "hover:bg-muted/40"}`}
              >
                <div
                  className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${cfg.className}`}
                >
                  <Icon size={13} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-1">
                    <p className="text-xs font-semibold text-foreground truncate">
                      {r.title}
                    </p>
                    {r.amount !== undefined && (
                      <span className="text-[10px] font-bold text-emerald-600 shrink-0">
                        ₹{r.amount.toLocaleString("en-IN")}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {r.subtitle}
                  </p>
                  <div className="mt-1">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${cfg.className}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {formatRelative(r.dueDate, r.timeSlot)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-border px-4 py-2">
        <p className="text-[10px] text-muted-foreground text-center">
          Overdue · Today · Next 7 days · Tasks &amp; finance items
        </p>
      </div>
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Tasks() {
  const { tasks, loading, error, refetch } = useTask();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);

  const canCreate =
    currentUser?.role === "super_admin" || currentUser?.role === "admin";

  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        const matchSearch =
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          t.assignedToName.toLowerCase().includes(search.toLowerCase());
        const matchStatus = statusFilter === "all" || t.status === statusFilter;
        const matchUser =
          currentUser?.role !== "user" ||
          t.assignedTo === String(currentUser.id) ||
          t.createdBy === String(currentUser.id);
        return matchSearch && matchStatus && matchUser;
      }),
    [tasks, search, statusFilter, currentUser],
  );

  const overdueTasks = tasks.filter(isOverdue);
  const dueSoonTasks = tasks.filter(isDueSoon);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Tasks"]} />

      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">
            Tasks
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 hidden sm:block">
            Manage, assign and review tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            disabled={loading}
            title="Refresh tasks"
            className="p-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
          </button>
          {canCreate && (
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all shrink-0"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">New Task</span>
              <span className="sm:hidden">New</span>
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout on large screens: tasks left, reminders right */}
      <div className="flex gap-6 items-start">
        {/* ── Left: tasks list ── */}
        <div className="flex-1 min-w-0">
          {/* Error banner */}
          {error && (
            <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
              <button
                onClick={refetch}
                className="ml-auto text-xs underline hover:no-underline"
              >
                Retry
              </button>
            </div>
          )}

          {/* Alert banners */}
          <AnimatePresence>
            {!loading && overdueTasks.length > 0 && (
              <motion.div
                key="overdue-alert"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400"
              >
                <AlertCircle size={16} className="shrink-0" />
                <span className="text-sm font-heading">
                  {overdueTasks.length} task
                  {overdueTasks.length !== 1 ? "s" : ""} overdue
                </span>
              </motion.div>
            )}
            {!loading && dueSoonTasks.length > 0 && (
              <motion.div
                key="due-soon-alert"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400"
              >
                <Clock size={16} className="shrink-0" />
                <span className="text-sm font-heading">
                  {dueSoonTasks.length} task
                  {dueSoonTasks.length !== 1 ? "s" : ""} due within 48 hours
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search tasks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {(
                ["all", "open", "in_progress", "closed", "reviewed"] as const
              ).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-heading transition-all whitespace-nowrap ${
                    statusFilter === s
                      ? "gradient-accent text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {s === "all" ? "All" : STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <TaskCardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              <Circle size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-heading">No tasks found</p>
              {tasks.length === 0 && !error && (
                <p className="text-xs mt-1 text-muted-foreground">
                  Create your first task to get started
                </p>
              )}
            </div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
            >
              <AnimatePresence>
                {filtered.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => navigate(`/tasks/${task.id}`)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>

        {/* ── Right: reminders panel (desktop only) ── */}
        <div className="hidden lg:block w-80 shrink-0 sticky top-20">
          <RemindersPanel />
        </div>
      </div>

      {/* Reminders panel for mobile — below the grid */}
      <div className="lg:hidden mt-6">
        <RemindersPanel />
      </div>

      <AnimatePresence>
        {showForm && <TaskFormModal onClose={() => setShowForm(false)} />}
      </AnimatePresence>
    </>
  );
}
