import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Search, Flame, Clock3, CalendarDays, ArrowRight, ClipboardList, Pause, Check, ChevronRight, ChevronDown, CornerDownRight, CheckCircle2 } from "lucide-react";
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
  ParentTaskId: number | null;
  ParentTaskNo: string | null;
  ParentTaskSubject: string | null;
}

// Standalone data source — Follow-Up never reads Task Master's cache/shape,
// it fetches its own board feed and refetches whenever a task is plugged in.
async function fetchFollowUpBoard(): Promise<Task[]> {
  const res = await fetchWithAuth(`${API}/followup-board`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json().catch(() => []);
}

// Closed tasks live entirely outside the Active/Hold board above (see
// GET /closed-board in backend/routes/taskMaster.js) — fetched separately
// here purely for the "Close" tile's count; the full list lives on its own
// page at /followup/close-tasks (src/pages/followup/ClosedTasks.tsx).
async function fetchClosedCount(): Promise<number> {
  const res = await fetchWithAuth(`${API}/closed-board`);
  if (!res.ok) return 0;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
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

const BUCKET_LABELS = {
  dueToday: "Due Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  onHold: "On Hold",
} as const;

const PRIORITY_COLORS: Record<(typeof PRIORITIES)[number], string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
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

const TaskCard: React.FC<{
  task: Task;
  index: number;
  onClick: () => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  depth?: number;
  hasChildren?: boolean;
  childCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}> = ({ task, index, onClick, onPriorityChange, depth = 0, hasChildren = false, childCount = 0, expanded = false, onToggleExpand }) => {
  const { glassCard } = useGlass();
  // A Held task isn't "overdue" in the actionable sense — it's paused — so
  // skip the red urgency styling for anything that isn't Active.
  const overdue = task.Status === "Active" && dueLabel(task.DueDate).includes("overdue");
  // Nested subtask cards read as a smaller, secondary tier under their
  // parent — tighter padding/spacing and a size step down on every label.
  const isChild = depth > 0;

  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className={`relative w-full text-left rounded-xl group overflow-hidden cursor-pointer ${
        isChild ? "p-2.5 space-y-1" : "p-4 space-y-1.5"
      }`}
      style={glassCard}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: overdue ? "#ef4444" : `linear-gradient(to bottom, transparent 10%, ${ACCENT} 30%, ${ACCENT} 70%, transparent 90%)` }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1 font-mono text-muted-foreground uppercase tracking-widest ${isChild ? "text-[10px]" : "text-[11px]"}`}>
          {isChild && <CornerDownRight size={10} className="shrink-0" />}
          {task.TaskNo || "—"}
        </span>
        <div className="flex items-center gap-1">
          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand?.();
              }}
              className="p-1 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title={expanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              {expanded ? <ChevronDown size={isChild ? 11 : 13} /> : <ChevronRight size={isChild ? 11 : 13} />}
              <span className="sr-only">{childCount} subtasks</span>
            </button>
          )}
          <ArrowRight
            size={isChild ? 11 : 13}
            className="opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all"
            style={{ color: ACCENT_SOFT }}
          />
        </div>
      </div>
      <p className={`font-semibold text-foreground truncate ${isChild ? "text-xs" : "text-sm"}`}>
        {task.Subject}
        {hasChildren && (
          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">({childCount})</span>
        )}
      </p>
      {task.CaseProjectName && !isChild && (
        <p className="text-xs text-muted-foreground truncate">{task.CaseProjectName}</p>
      )}
      <p className={`font-medium ${isChild ? "text-[11px]" : "text-xs"} ${overdue ? "text-red-500" : "text-muted-foreground"}`}>
        {dueLabel(task.DueDate)}
      </p>
      {task.NextFollowUpAt && !isChild && (
        <p className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/25">
          Next follow-up · {formatDate(task.NextFollowUpAt)}
        </p>
      )}
      <div className={`flex items-center pt-1 ${isChild ? "gap-1" : "gap-1.5"}`} onClick={(e) => e.stopPropagation()}>
        {PRIORITIES.map((p) => {
          const color = PRIORITY_COLORS[p];
          const checked = task.Priority === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPriorityChange(task.Id, p)}
              className={`inline-flex items-center gap-1 font-semibold rounded-md border transition-colors ${
                isChild ? "text-[9px] px-1 py-0.5" : "text-[10px] px-1.5 py-0.5"
              }`}
              style={{
                borderColor: checked ? color : "rgba(148,163,184,0.3)",
                color: checked ? color : undefined,
                background: checked ? `${color}1A` : "transparent",
              }}
            >
              <span
                className={`rounded-[3px] border flex items-center justify-center shrink-0 ${isChild ? "w-2.5 h-2.5" : "w-3 h-3"}`}
                style={{ borderColor: color, background: checked ? color : "transparent" }}
              >
                {checked && <Check size={isChild ? 7 : 9} color="#fff" strokeWidth={3} />}
              </span>
              {p}
            </button>
          );
        })}
        {task.CaseNumber && !isChild && (
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">{task.CaseNumber}</span>
        )}
      </div>
    </motion.div>
  );
};

const StatCard: React.FC<{
  label: string;
  count: number;
  icon: React.ElementType;
  color: string;
  delay: number;
  active: boolean;
  onClick: () => void;
}> = ({ label, count, icon: Icon, color, delay, active, onClick }) => {
  const { glassCard } = useGlass();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="flex-1 min-w-[160px] rounded-xl p-4 flex items-center gap-3 text-left transition-shadow"
      style={{
        ...glassCard,
        outline: active ? `2px solid ${color}` : "none",
        outlineOffset: -1,
      }}
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
    </motion.button>
  );
};

const FollowUp: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { glassCard } = useGlass();
  const [search, setSearch] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<(typeof PRIORITIES)[number] | null>(null);
  const [bucketFilter, setBucketFilter] = React.useState<keyof typeof BUCKET_LABELS | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    searchParams.get("view"),
  );

  // Collapsed by default — a parent card's subtasks only appear nested
  // beneath it once its chevron is clicked.
  const [expandedIds, setExpandedIds] = React.useState<Set<number>>(() => new Set());
  const toggleExpanded = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Deep-link support (e.g. from the reminder bell's Follow-Up pill) — open
  // straight to the task the ?view= param names, then drop the param so it
  // doesn't reopen on a later back/refresh.
  React.useEffect(() => {
    const view = searchParams.get("view");
    if (!view) return;
    setSelectedTaskId(view);
    const next = new URLSearchParams(searchParams);
    next.delete("view");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["followup-board"],
    queryFn: fetchFollowUpBoard,
    staleTime: 60 * 1000,
  });

  const { data: closedCount = 0 } = useQuery({
    queryKey: ["closed-board-count"],
    queryFn: fetchClosedCount,
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

  // Subtasks nest under their parent's card (click to expand) rather than
  // appearing as their own top-level cards — so bucketing (which drives the
  // Overdue/Today/Upcoming/On Hold split) only ever looks at top-level
  // tasks. A subtask's own due date still shows on its nested card, it just
  // doesn't independently place it in a bucket.
  const childrenByParent = React.useMemo(() => {
    const map = new Map<number, Task[]>();
    for (const t of filtered) {
      if (!t.ParentTaskId) continue;
      const arr = map.get(t.ParentTaskId) ?? [];
      arr.push(t);
      map.set(t.ParentTaskId, arr);
    }
    return map;
  }, [filtered]);

  const topLevelFiltered = React.useMemo(
    () => filtered.filter((t) => !t.ParentTaskId),
    [filtered],
  );

  const buckets = React.useMemo(() => {
    const active = topLevelFiltered.filter((t) => t.Status === "Active" && t.DueDate);
    const onHold = topLevelFiltered.filter((t) => t.Status === "Hold" && t.DueDate);
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
  }, [topLevelFiltered]);

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

  const handlePriorityChange = async (id: number, priority: (typeof PRIORITIES)[number]) => {
    const res = await fetchWithAuth(`${API}/${id}/priority`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Priority: priority }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Failed to update priority");
      return;
    }
    toast.success(`Priority set to ${priority}`);
    await queryClient.invalidateQueries({ queryKey: ["followup-board"] });
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
          const color = PRIORITY_COLORS[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => setPriorityFilter(active ? null : p)}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg border transition-colors ${
                active ? "" : "border-border text-muted-foreground hover:bg-muted"
              }`}
              style={active ? { background: `${color}29`, borderColor: `${color}73`, color } : undefined}
            >
              {p}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <StatCard
          label="Due Today"
          count={buckets.dueToday.length}
          icon={Clock3}
          color="#3b82f6"
          delay={0.05}
          active={bucketFilter === "dueToday"}
          onClick={() => setBucketFilter((f) => (f === "dueToday" ? null : "dueToday"))}
        />
        <StatCard
          label="Overdue"
          count={buckets.overdue.length}
          icon={Flame}
          color="#ef4444"
          delay={0.1}
          active={bucketFilter === "overdue"}
          onClick={() => setBucketFilter((f) => (f === "overdue" ? null : "overdue"))}
        />
        <StatCard
          label="Upcoming"
          count={buckets.upcoming.length}
          icon={CalendarDays}
          color="#10b981"
          delay={0.15}
          active={bucketFilter === "upcoming"}
          onClick={() => setBucketFilter((f) => (f === "upcoming" ? null : "upcoming"))}
        />
        <StatCard
          label="On Hold"
          count={buckets.onHold.length}
          icon={Pause}
          color="#f59e0b"
          delay={0.2}
          active={bucketFilter === "onHold"}
          onClick={() => setBucketFilter((f) => (f === "onHold" ? null : "onHold"))}
        />
        <StatCard
          label="Close"
          count={closedCount}
          icon={CheckCircle2}
          color="#64748b"
          delay={0.25}
          active={false}
          onClick={() => navigate("/followup/close-tasks")}
        />
      </div>

      {bucketFilter && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Showing</span>
          <span
            className="inline-flex items-center gap-1.5 font-semibold px-2 py-1 rounded-lg"
            style={{ background: "rgba(13,148,136,0.14)", color: ACCENT }}
          >
            {BUCKET_LABELS[bucketFilter]}
            <button
              type="button"
              onClick={() => setBucketFilter(null)}
              className="hover:opacity-70 transition-opacity"
              aria-label="Clear filter"
            >
              ×
            </button>
          </span>
        </div>
      )}

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
          {(!bucketFilter || bucketFilter === "overdue") && (
            <TaskGroup title="Overdue" tasks={buckets.overdue} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "dueToday") && (
            <TaskGroup title="Today" tasks={buckets.dueToday} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "upcoming") && (
            <TaskGroup title="Upcoming" tasks={buckets.upcoming} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "onHold") && (
            <TaskGroup title="On Hold" tasks={buckets.onHold} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {bucketFilter && buckets[bucketFilter].length === 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl p-8 flex flex-col items-center gap-1.5 text-center"
              style={glassCard}
            >
              <p className="text-sm font-medium text-foreground">No {BUCKET_LABELS[bucketFilter].toLowerCase()} tasks</p>
              <p className="text-xs text-muted-foreground">Nothing here right now.</p>
            </motion.div>
          )}
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

// One top-level task plus its (possibly nested) subtasks, expanded/collapsed
// as a unit — this whole node is a single grid cell so a task's subtree
// stays visually together instead of scattering across grid columns.
const TaskNode: React.FC<{
  task: Task;
  index: number;
  depth: number;
  onSelect: (id: string) => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  childrenByParent: Map<number, Task[]>;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
}> = ({ task, index, depth, onSelect, onPriorityChange, childrenByParent, expandedIds, onToggleExpand }) => {
  const children = childrenByParent.get(task.Id) ?? [];
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(task.Id);

  return (
    <div className={depth > 0 ? "pl-4 border-l border-border/50 ml-1" : ""}>
      <TaskCard
        task={task}
        index={index}
        onClick={() => onSelect(String(task.Id))}
        onPriorityChange={onPriorityChange}
        depth={depth}
        hasChildren={hasChildren}
        childCount={children.length}
        expanded={expanded}
        onToggleExpand={() => onToggleExpand(task.Id)}
      />
      {hasChildren && expanded && (
        <div className="space-y-2 mt-2">
          {children.map((c, i) => (
            <TaskNode
              key={c.Id}
              task={c}
              index={i}
              depth={depth + 1}
              onSelect={onSelect}
              onPriorityChange={onPriorityChange}
              childrenByParent={childrenByParent}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TaskGroup: React.FC<{
  title: string;
  tasks: Task[];
  onSelect: (id: string) => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  childrenByParent: Map<number, Task[]>;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
}> = ({ title, tasks, onSelect, onPriorityChange, childrenByParent, expandedIds, onToggleExpand }) => {
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
        {tasks.map((t, i) => (
          <TaskNode
            key={t.Id}
            task={t}
            index={i}
            depth={0}
            onSelect={onSelect}
            onPriorityChange={onPriorityChange}
            childrenByParent={childrenByParent}
            expandedIds={expandedIds}
            onToggleExpand={onToggleExpand}
          />
        ))}
      </div>
    </div>
  );
};

export default FollowUp;
