import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Search, Flame, Clock3, CalendarDays, ArrowRight, ClipboardList, Pause } from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";

const API = "/api/task-master";
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;

// Same teal identity as FollowupShell — kept in sync deliberately.
const ACCENT = "#0d9488";
const ACCENT_SOFT = "#2dd4bf";

interface Task {
  Id: number;
  TaskNo: string;
  Subject: string;
  Details: string | null;
  Department: string | null;
  DueDate: string | null;
  CaseNumber: string | null;
  Priority: string;
  Status: string;
  CaseCompanyName: string | null;
  CaseProjectName: string | null;
  CaseFinYearName: string | null;
  NextFollowUpAt: string | null;
}

// Standalone data source — Follow-Up never reads Task Master's cache/shape,
// it fetches its own board feed and refetches whenever a task is plugged in.
async function fetchFollowUpBoard(): Promise<Task[]> {
  const res = await fetchWithAuth(`${API}/followup-board`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json().catch(() => []);
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDate(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function dueLabel(dueDate: string | null): string {
  if (!dueDate) return "";
  const today = startOfDay(new Date());
  const due = startOfDay(new Date(dueDate));
  const diffDays = Math.round((due - today) / 86400000);
  const dateStr = formatDate(dueDate);
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue · ${dateStr}`;
  if (diffDays === 0) return `Due Today · ${dateStr}`;
  if (diffDays === 1) return `Due Tomorrow · ${dateStr}`;
  return `Due in ${diffDays}d · ${dateStr}`;
}

const PRIORITY_STYLE: Record<string, { classes: string }> = {
  "Very Important": { classes: "bg-red-500/10 text-red-500 border-red-500/25" },
  Important: { classes: "bg-amber-500/10 text-amber-600 border-amber-500/25" },
  Normal: { classes: "" },
};

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

const TaskCard: React.FC<{ task: Task; index: number; onClick: () => void }> = ({ task, index, onClick }) => {
  const { glassCard } = useGlass();
  const priority = PRIORITY_STYLE[task.Priority] || PRIORITY_STYLE.Normal;
  // A Held task isn't "overdue" in the actionable sense — it's paused — so
  // skip the red urgency styling for anything that isn't Active.
  const overdue = task.Status === "Active" && dueLabel(task.DueDate).includes("overdue");

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="relative w-full text-left rounded-xl p-4 space-y-1.5 group overflow-hidden"
      style={glassCard}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: overdue ? "#ef4444" : `linear-gradient(to bottom, transparent 10%, ${ACCENT} 30%, ${ACCENT} 70%, transparent 90%)` }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
          {task.TaskNo || "—"}
        </span>
        <ArrowRight
          size={13}
          className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
          style={{ color: ACCENT_SOFT }}
        />
      </div>
      <p className="text-sm font-semibold text-foreground truncate">{task.Subject}</p>
      {task.CaseProjectName && (
        <p className="text-xs text-muted-foreground truncate">{task.CaseProjectName}</p>
      )}
      <p className={`text-xs font-medium ${overdue ? "text-red-500" : "text-muted-foreground"}`}>
        {dueLabel(task.DueDate)}
      </p>
      {task.NextFollowUpAt && (
        <p className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/25">
          Next follow-up · {formatDate(task.NextFollowUpAt)}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        {priority.classes && (
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md border ${priority.classes}`}>
            {task.Priority}
          </span>
        )}
        {task.CaseNumber && (
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">{task.CaseNumber}</span>
        )}
      </div>
    </motion.button>
  );
};

const StatCard: React.FC<{ label: string; count: number; icon: React.ElementType; color: string; delay: number }> = ({
  label,
  count,
  icon: Icon,
  color,
  delay,
}) => {
  const { glassCard } = useGlass();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      className="flex-1 min-w-[160px] rounded-xl p-4 flex items-center gap-3"
      style={glassCard}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}1A`, border: `1px solid ${color}40`, boxShadow: `0 0 12px ${color}26` }}
      >
        <Icon size={17} style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-foreground leading-none">{count}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </div>
    </motion.div>
  );
};

const FollowUp: React.FC = () => {
  const queryClient = useQueryClient();
  const { glassCard } = useGlass();
  const [search, setSearch] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<(typeof PRIORITIES)[number] | null>(null);
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["followup-board"],
    queryFn: fetchFollowUpBoard,
    staleTime: 60 * 1000,
  });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (priorityFilter && t.Priority !== priorityFilter) return false;
      if (!q) return true;
      // Search every field a case card could plausibly be found by — not just
      // subject/project. Dates are matched both as the raw ISO string and as
      // the "15 Aug 2026" label shown on the card, so either form works.
      const haystack = [
        t.TaskNo,
        t.Subject,
        t.Details,
        t.Department,
        t.CaseNumber,
        t.Priority,
        t.Status,
        t.CaseCompanyName,
        t.CaseProjectName,
        t.CaseFinYearName,
        t.DueDate,
        t.DueDate ? formatDate(t.DueDate) : null,
        t.NextFollowUpAt ? formatDate(t.NextFollowUpAt) : null,
      ];
      return haystack.some((field) => field?.toString().toLowerCase().includes(q));
    });
  }, [tasks, search, priorityFilter]);

  const buckets = React.useMemo(() => {
    const active = filtered.filter((t) => t.Status === "Active" && t.DueDate);
    const onHold = filtered.filter((t) => t.Status === "Hold" && t.DueDate);
    const today = startOfDay(new Date());
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const upcoming: Task[] = [];
    for (const t of active) {
      const due = startOfDay(new Date(t.DueDate as string));
      if (due < today) overdue.push(t);
      else if (due === today) dueToday.push(t);
      else upcoming.push(t);
    }
    const byDue = (a: Task, b: Task) => new Date(a.DueDate as string).getTime() - new Date(b.DueDate as string).getTime();
    return {
      overdue: overdue.sort(byDue),
      dueToday: dueToday.sort(byDue),
      upcoming: upcoming.sort(byDue),
      onHold: onHold.sort(byDue),
    };
  }, [filtered]);

  const totalActive =
    buckets.overdue.length + buckets.dueToday.length + buckets.upcoming.length + buckets.onHold.length;

  const handleStatusChange = async (id: string, status: string) => {
    const res = await fetchWithAuth(`${API}/${id}/status`, {
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
      queryClient.invalidateQueries({ queryKey: ["followup-board"] }),
      queryClient.invalidateQueries({ queryKey: ["followup-task", id] }),
    ]);
  };

  const exportColumns: ExportColumn[] = [
    { header: "Task No.", accessor: "TaskNo" },
    { header: "Subject", accessor: "Subject" },
    { header: "Department", accessor: "Department" },
    { header: "Due Date", accessor: "DueDate" },
    { header: "Case Number", accessor: "CaseNumber" },
    { header: "Priority", accessor: "Priority" },
    { header: "Status", accessor: "Status" },
    { header: "Company", accessor: "CaseCompanyName" },
    { header: "Project", accessor: "CaseProjectName" },
    { header: "Next Follow-Up", accessor: "NextFollowUpAt" },
  ];

  return (
    <FollowupShell
      title="Follow-Up"
      subtitle="Cases needing attention, sorted by urgency"
      action={
        <ExportMenu
          data={filtered as unknown as Record<string, unknown>[]}
          columns={exportColumns}
          title="Follow-Up Cases"
          filename="followup-cases"
          disabled={filtered.length === 0}
        />
      }
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative rounded-xl overflow-hidden"
        style={glassCard}
      >
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: ACCENT_SOFT }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cases…"
          className="w-full pl-10 pr-3 py-3 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground"
        />
      </motion.div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mr-1">Priority</span>
        {PRIORITIES.map((p) => {
          const active = priorityFilter === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPriorityFilter(active ? null : p)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                active ? "" : "border-border text-muted-foreground hover:bg-muted"
              }`}
              style={active ? { background: "rgba(13,148,136,0.16)", borderColor: "rgba(13,148,136,0.45)", color: ACCENT } : undefined}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard label="Due Today" count={buckets.dueToday.length} icon={Clock3} color="#3b82f6" delay={0.05} />
        <StatCard label="Overdue" count={buckets.overdue.length} icon={Flame} color="#ef4444" delay={0.1} />
        <StatCard label="Upcoming" count={buckets.upcoming.length} icon={CalendarDays} color="#10b981" delay={0.15} />
        <StatCard label="On Hold" count={buckets.onHold.length} icon={Pause} color="#f59e0b" delay={0.2} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(13,148,136,0.2)", borderTopColor: ACCENT }}
          />
        </div>
      ) : totalActive === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-xl p-10 flex flex-col items-center gap-2 text-center"
          style={glassCard}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center mb-1"
            style={{ background: "rgba(13,148,136,0.14)", border: "1px solid rgba(13,148,136,0.3)" }}
          >
            <ClipboardList size={18} style={{ color: ACCENT_SOFT }} />
          </div>
          <p className="text-sm font-medium text-foreground">No active tasks with a due date</p>
          <p className="text-xs text-muted-foreground">Create one from Task Master to see it here.</p>
        </motion.div>
      ) : (
        <>
          <TaskGroup title="Overdue" tasks={buckets.overdue} onSelect={setSelectedTaskId} />
          <TaskGroup title="Today" tasks={buckets.dueToday} onSelect={setSelectedTaskId} />
          <TaskGroup title="Upcoming" tasks={buckets.upcoming} onSelect={setSelectedTaskId} />
          <TaskGroup title="On Hold" tasks={buckets.onHold} onSelect={setSelectedTaskId} />
        </>
      )}

      <TaskDrawer
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={handleStatusChange}
      />
    </FollowupShell>
  );
};

const TaskGroup: React.FC<{ title: string; tasks: Task[]; onSelect: (id: string) => void }> = ({
  title,
  tasks,
  onSelect,
}) => {
  if (tasks.length === 0) return null;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT_SOFT }}>
          {title}
        </p>
        <span className="text-[10px] text-muted-foreground">{tasks.length}</span>
        <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, rgba(13,148,136,0.25), transparent)" }} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tasks.map((t, i) => (
          <TaskCard key={t.Id} task={t} index={i} onClick={() => onSelect(String(t.Id))} />
        ))}
      </div>
    </div>
  );
};

export default FollowUp;
