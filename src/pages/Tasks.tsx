import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useTask, Task, TaskStatus, TaskPriority } from "@/contexts/TaskContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Plus, Search, Clock, CheckCircle2, Circle, AlertCircle,
  ChevronRight, CalendarDays, User, Flag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import TaskFormModal from "./tasks/TaskFormModal";

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  open:        { label: "Open",        color: "text-blue-400",   bg: "bg-blue-500/15",   icon: Circle },
  in_progress: { label: "In Progress", color: "text-yellow-400", bg: "bg-yellow-500/15", icon: Clock },
  closed:      { label: "Closed",      color: "text-purple-400", bg: "bg-purple-500/15", icon: CheckCircle2 },
  reviewed:    { label: "Reviewed",    color: "text-green-400",  bg: "bg-green-500/15",  icon: CheckCircle2 },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  low:    { label: "Low",    color: "text-muted-foreground" },
  medium: { label: "Medium", color: "text-yellow-400" },
  high:   { label: "High",   color: "text-red-400" },
};

const isOverdue = (task: Task) =>
  (task.status === "open" || task.status === "in_progress") && new Date(task.dueDate) < new Date();

const isDueSoon = (task: Task) => {
  const now = new Date();
  const due = new Date(task.dueDate);
  const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  return (task.status === "open" || task.status === "in_progress") && due >= now && due <= soon;
};

const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TaskCard = ({ task, onClick }: { task: Task; onClick: () => void }) => {
  const overdue = isOverdue(task);
  const dueSoon = isDueSoon(task);
  const cfg = STATUS_CONFIG[task.status];
  const StatusIcon = cfg.icon;
  const metCount = task.qualityCriteria.filter(q => q.met).length;
  const totalCount = task.qualityCriteria.length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      onClick={onClick}
      className="rounded-xl bg-card border border-border p-4 cursor-pointer hover:border-primary/50 hover:shadow-md transition-all group"
      style={overdue ? { borderLeftWidth: 3, borderLeftColor: "hsl(0,72%,51%)" } : dueSoon ? { borderLeftWidth: 3, borderLeftColor: "hsl(38,92%,50%)" } : {}}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon size={15} className={`${cfg.color} shrink-0`} />
          <h3 className="text-sm font-heading font-semibold text-foreground line-clamp-1">{task.title}</h3>
        </div>
        <ChevronRight size={15} className="text-muted-foreground shrink-0 group-hover:text-primary transition-colors" />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{task.description}</p>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`flex items-center gap-1 text-xs font-heading ${PRIORITY_CONFIG[task.priority].color}`}>
          <Flag size={11} /> {PRIORITY_CONFIG[task.priority].label}
        </span>
        <span className={`flex items-center gap-1 text-xs font-heading ${overdue ? "text-red-400" : dueSoon ? "text-yellow-400" : "text-muted-foreground"}`}>
          <CalendarDays size={11} />
          <span className="hidden sm:inline">{overdue ? "Overdue · " : dueSoon ? "Due soon · " : ""}</span>
          {formatDate(task.dueDate)}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground font-heading ml-auto">
          <User size={11} /> <span className="truncate max-w-[80px]">{task.assignedToName}</span>
        </span>
      </div>

      {totalCount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground font-heading">Quality</span>
            <span className="text-[10px] text-muted-foreground font-heading">{metCount}/{totalCount}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${totalCount > 0 ? (metCount / totalCount) * 100 : 0}%`, background: "hsl(var(--primary))" }} />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-heading ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
        {task.comments.length > 0 && (
          <span className="text-[10px] text-muted-foreground">{task.comments.length} comment{task.comments.length !== 1 ? "s" : ""}</span>
        )}
      </div>
    </motion.div>
  );
};

export default function Tasks() {
  const { tasks } = useTask();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [showForm, setShowForm] = useState(false);

  const canCreate = currentUser?.role === "super_admin" || currentUser?.role === "admin";

  const filtered = useMemo(() => tasks.filter(t => {
    const matchSearch = t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.assignedToName.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || t.status === statusFilter;
    const matchUser = currentUser?.role !== "user" || t.assignedTo === currentUser.id || t.createdBy === currentUser.id;
    return matchSearch && matchStatus && matchUser;
  }), [tasks, search, statusFilter, currentUser]);

  const overdueTasks = tasks.filter(isOverdue);
  const dueSoonTasks = tasks.filter(isDueSoon);

  return (
    <AppLayout>
      <Breadcrumbs items={["Dashboard", "Tasks"]} />

      <div className="flex items-center justify-between mb-5 gap-3">
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-0.5 hidden sm:block">Manage, assign and review tasks</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-heading font-semibold gradient-accent text-primary-foreground hover:-translate-y-0.5 transition-all shrink-0">
            <Plus size={15} /> <span className="hidden sm:inline">New Task</span><span className="sm:hidden">New</span>
          </button>
        )}
      </div>

      {/* Alert banners */}
      <AnimatePresence>
        {overdueTasks.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
            <AlertCircle size={16} className="shrink-0" />
            <span className="text-sm font-heading">{overdueTasks.length} task{overdueTasks.length !== 1 ? "s" : ""} overdue</span>
          </motion.div>
        )}
        {dueSoonTasks.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400">
            <Clock size={16} className="shrink-0" />
            <span className="text-sm font-heading">{dueSoonTasks.length} task{dueSoonTasks.length !== 1 ? "s" : ""} due within 48 hours</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" placeholder="Search tasks..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {(["all", "open", "in_progress", "closed", "reviewed"] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-heading transition-all whitespace-nowrap ${statusFilter === s ? "gradient-accent text-primary-foreground" : "border border-border text-muted-foreground hover:bg-muted"}`}>
              {s === "all" ? "All" : STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Circle size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm font-heading">No tasks found</p>
        </div>
      ) : (
        <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <AnimatePresence>
            {filtered.map(task => (
              <TaskCard key={task.id} task={task} onClick={() => navigate(`/tasks/${task.id}`)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      <AnimatePresence>
        {showForm && <TaskFormModal onClose={() => setShowForm(false)} />}
      </AnimatePresence>
    </AppLayout>
  );
}
