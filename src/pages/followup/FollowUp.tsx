import React from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Search, Flame, Clock3, CalendarDays, ArrowRight, ClipboardList, Pause, Check, ChevronRight, ChevronDown, CornerDownRight, CheckCircle2, XCircle, ListPlus } from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ProgressBar } from "@/components/followup/ProgressBar";
import { ExportMenu } from "@/components/ExportMenu";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

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
  Tags: { Id: number; Name: string }[];
  Progress: number;
  EffectiveProgress: number;
  HasChildren: boolean;
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

// Same reasoning as fetchClosedCount — Cancelled tasks live entirely outside
// the Active/Hold board, kept as their own separate history rather than
// mixed into Closed, so cancelling a task never quietly inflates the
// "Completed" count. Full list lives at /followup/cancelled-tasks.
async function fetchCancelledCount(): Promise<number> {
  const res = await fetchWithAuth(`${API}/cancelled-board`);
  if (!res.ok) return 0;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

// Used only to populate the Assignee dropdown in the Create Subtask dialog —
// same endpoint/shape Task Master's own quick-add subtask dialog uses.
async function fetchAssigneeOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth(`${API}/assignable-users`);
  if (!res.ok) return [];
  const data: { id: number; name: string }[] = await res.json().catch(() => []);
  return data.map((u) => ({ value: String(u.id), label: u.name }));
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

// Row-wise replacement for the old TaskCard — same fields, same handlers,
// laid out as a compact <tr> so many Follow-Ups are visible at once instead
// of one per large card. All priority/progress/status/bucket logic below is
// untouched; only the presentation changed from a card to a table row.
const TaskRow: React.FC<{
  task: Task;
  index: number;
  onClick: () => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  onProgressChange: (id: number, progress: number) => void;
  onCreateSubtask: (task: Task) => void;
  depth?: number;
  hasChildren?: boolean;
  childCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
}> = ({ task, index, onClick, onPriorityChange, onProgressChange, onCreateSubtask, depth = 0, hasChildren = false, childCount = 0, expanded = false, onToggleExpand }) => {
  // A Held task isn't "overdue" in the actionable sense — it's paused — so
  // skip the red urgency styling for anything that isn't Active.
  const overdue = task.Status === "Active" && dueLabel(task.DueDate).includes("overdue");
  const isChild = depth > 0;

  return (
    <motion.tr
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay: Math.min(index, 10) * 0.02, ease: "easeOut" }}
      className={`group cursor-pointer transition-colors hover:bg-muted/40 ${isChild ? "bg-muted/[0.06]" : ""}`}
    >
      <td className="pl-3 pr-2 py-2.5 align-top relative">
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: overdue ? "#ef4444" : `linear-gradient(to bottom, transparent 10%, ${ACCENT} 30%, ${ACCENT} 70%, transparent 90%)` }}
        />
        <div className="flex items-start gap-1.5" style={{ paddingLeft: depth * 18 }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              className="mt-0.5 p-0.5 -m-0.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
              title={expanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span className="sr-only">{childCount} subtasks</span>
            </button>
          ) : isChild ? (
            <CornerDownRight size={11} className="mt-1 text-muted-foreground shrink-0" />
          ) : (
            <span className="w-[13px] shrink-0" />
          )}
          <div className="min-w-0">
            <span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              {task.TaskNo || "—"}
              {hasChildren && <span className="text-muted-foreground/70 normal-case tracking-normal">({childCount})</span>}
            </span>
            <p className={`font-semibold text-foreground truncate ${isChild ? "text-xs" : "text-sm"}`}>{task.Subject}</p>
            {task.CaseProjectName && (
              <p className="text-[11px] text-muted-foreground truncate">{task.CaseProjectName}</p>
            )}
            {task.Tags?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {task.Tags.map((tag) => (
                  <span
                    key={tag.Id}
                    className="inline-flex items-center rounded-full font-medium truncate max-w-[100px] text-[9px] px-1.5 py-0.5"
                    style={{ background: "rgba(13,148,136,0.12)", border: "1px solid rgba(13,148,136,0.3)", color: ACCENT }}
                    title={tag.Name}
                  >
                    {tag.Name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className={`px-2 py-2.5 align-top text-xs font-medium whitespace-nowrap ${overdue ? "text-red-500" : "text-muted-foreground"}`}>
        {dueLabel(task.DueDate) || "—"}
      </td>
      <td className="px-2 py-2.5 align-top text-xs whitespace-nowrap">
        {task.NextFollowUpAt ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/25">
            {formatDate(task.NextFollowUpAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1 flex-wrap max-w-[220px]">
          {PRIORITIES.map((p) => {
            const color = PRIORITY_COLORS[p];
            const checked = task.Priority === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPriorityChange(task.Id, p)}
                title={p}
                className="inline-flex items-center gap-1 font-semibold rounded-md border text-[9px] px-1.5 py-0.5 transition-colors"
                style={{
                  borderColor: checked ? color : "rgba(148,163,184,0.3)",
                  color: checked ? color : undefined,
                  background: checked ? `${color}1A` : "transparent",
                }}
              >
                <span
                  className="rounded-[3px] border w-2.5 h-2.5 flex items-center justify-center shrink-0"
                  style={{ borderColor: color, background: checked ? color : "transparent" }}
                >
                  {checked && <Check size={7} color="#fff" strokeWidth={3} />}
                </span>
                {p}
              </button>
            );
          })}
        </div>
      </td>
      <td className="px-2 py-2.5 align-top text-xs text-muted-foreground whitespace-nowrap">
        {task.Status}
        {task.CaseNumber && <div className="font-mono text-[10px] mt-0.5">{task.CaseNumber}</div>}
      </td>
      <td className="px-2 py-2.5 align-top w-[150px]" onClick={(e) => e.stopPropagation()}>
        <ProgressBar
          value={task.EffectiveProgress ?? task.Progress ?? 0}
          onCommit={(v) => onProgressChange(task.Id, v)}
          disabled={task.HasChildren}
          size="sm"
        />
      </td>
      <td className="pl-2 pr-3 py-2.5 align-top text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => onCreateSubtask(task)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-colors hover:bg-muted/60"
          style={{ borderColor: "rgba(13,148,136,0.35)", color: ACCENT }}
          title="Create a subtask under this follow-up"
        >
          <ListPlus size={12} /> Subtask
        </button>
      </td>
    </motion.tr>
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
  usePageRights("followup-dashboard");
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

  // "Create Subtask" — a lightweight dialog opened from a row's action
  // button, mirroring Task Master's own quick-add subtask dialog. The parent
  // Follow-Up's Id is captured when the dialog opens and posted straight
  // through as ParentTaskId — the user never picks a parent themselves.
  // Department/CaseNumber are inherited from the parent (already present on
  // the board feed); reuses the existing POST /api/task-master create
  // endpoint unchanged, so all task-creation logic stays exactly as-is.
  const [subtaskParent, setSubtaskParent] = React.useState<Task | null>(null);
  const [subtaskForm, setSubtaskForm] = React.useState({ subject: "", dueDate: "", assignedTo: "", priority: "Normal" as string });
  const [savingSubtask, setSavingSubtask] = React.useState(false);

  const { data: assigneeOptions = [] } = useQuery({
    queryKey: ["task-master-assignable-users"],
    queryFn: fetchAssigneeOptions,
    staleTime: 5 * 60 * 1000,
  });

  const openSubtaskDialog = (task: Task) => {
    setSubtaskParent(task);
    setSubtaskForm({ subject: "", dueDate: "", assignedTo: "", priority: "Normal" });
  };

  const handleCreateSubtask = async () => {
    if (!subtaskParent) return;
    if (!subtaskForm.subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    setSavingSubtask(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          Subject: subtaskForm.subject.trim(),
          DueDate: subtaskForm.dueDate || null,
          AssignedTo: subtaskForm.assignedTo ? parseInt(subtaskForm.assignedTo) : null,
          Priority: subtaskForm.priority,
          Department: subtaskParent.Department || null,
          CaseNumber: subtaskParent.CaseNumber || null,
          ParentTaskId: subtaskParent.Id,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to create subtask");
      toast.success("Subtask created");
      // Auto-expand the parent row so the new subtask is visible right away.
      setExpandedIds((prev) => new Set(prev).add(subtaskParent.Id));
      setSubtaskParent(null);
      await queryClient.invalidateQueries({ queryKey: ["followup-board"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create subtask");
    } finally {
      setSavingSubtask(false);
    }
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

  const { data: cancelledCount = 0 } = useQuery({
    queryKey: ["cancelled-board-count"],
    queryFn: fetchCancelledCount,
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
        ...(t.Tags?.map((tag) => tag.Name) ?? []),
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

  const handleStatusChange = async (id: string, status: string, cancelReasonId?: string) => {
    const res = await fetchWithAuth(`${API}/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Status: status, CancelReasonId: cancelReasonId }),
    });
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({}))).error || "Failed to update status");
      return;
    }
    toast.success(status === "Cancel" ? "Task cancelled" : `Task marked ${status}`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["followup-board"] }),
      queryClient.invalidateQueries({ queryKey: ["followup-task", id] }),
      queryClient.invalidateQueries({ queryKey: ["cancelled-board-count"] }),
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

  const handleProgressChange = async (id: number, progress: number) => {
    const res = await fetchWithAuth(`${API}/${id}/progress`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ Progress: progress }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Failed to update progress");
      // Board still holds the stale value client-side — refetch so the bar
      // snaps back to what's actually saved instead of the rejected drag.
      await queryClient.invalidateQueries({ queryKey: ["followup-board"] });
      return;
    }
    if (progress === 100) toast.success("Task marked Completed");
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
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up"]} />
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
        <StatCard
          label="Cancelled"
          count={cancelledCount}
          icon={XCircle}
          color="#ef4444"
          delay={0.3}
          active={false}
          onClick={() => navigate("/followup/cancelled-tasks")}
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
            <TaskGroup title="Overdue" tasks={buckets.overdue} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} onProgressChange={handleProgressChange} onCreateSubtask={openSubtaskDialog} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "dueToday") && (
            <TaskGroup title="Today" tasks={buckets.dueToday} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} onProgressChange={handleProgressChange} onCreateSubtask={openSubtaskDialog} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "upcoming") && (
            <TaskGroup title="Upcoming" tasks={buckets.upcoming} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} onProgressChange={handleProgressChange} onCreateSubtask={openSubtaskDialog} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
          )}
          {(!bucketFilter || bucketFilter === "onHold") && (
            <TaskGroup title="On Hold" tasks={buckets.onHold} onSelect={setSelectedTaskId} onPriorityChange={handlePriorityChange} onProgressChange={handleProgressChange} onCreateSubtask={openSubtaskDialog} childrenByParent={childrenByParent} expandedIds={expandedIds} onToggleExpand={toggleExpanded} />
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

      <Dialog open={!!subtaskParent} onOpenChange={(open) => !open && setSubtaskParent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Create Subtask{subtaskParent ? ` — under ${subtaskParent.TaskNo}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Subject *</label>
              <input
                type="text"
                autoFocus
                value={subtaskForm.subject}
                onChange={(e) => setSubtaskForm((f) => ({ ...f, subject: e.target.value }))}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="What needs to be done?"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Due Date</label>
                <input
                  type="date"
                  value={subtaskForm.dueDate}
                  onChange={(e) => setSubtaskForm((f) => ({ ...f, dueDate: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <select
                  value={subtaskForm.priority}
                  onChange={(e) => setSubtaskForm((f) => ({ ...f, priority: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Assignee</label>
              <select
                value={subtaskForm.assignedTo}
                onChange={(e) => setSubtaskForm((f) => ({ ...f, assignedTo: e.target.value }))}
                className="w-full mt-1 px-3 py-2 rounded-lg text-sm bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Unassigned</option>
                {assigneeOptions.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setSubtaskParent(null)}
              className="px-3 py-2 rounded-lg text-sm font-medium border border-border text-muted-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateSubtask}
              disabled={savingSubtask}
              className="px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors"
              style={{ background: "rgba(13,148,136,0.14)", border: "1px solid rgba(13,148,136,0.35)", color: ACCENT }}
            >
              {savingSubtask ? "Creating…" : "Create Subtask"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </FollowupShell>
    </>
  );
};

// One top-level task plus its (possibly nested) subtasks, expanded/collapsed
// as a unit — rendered as a run of <tr>s (own row first, then children's
// rows immediately below when expanded) so a task's subtree stays visually
// together inside the same table instead of scattering across grid cells.
const TaskRowNode: React.FC<{
  task: Task;
  index: number;
  depth: number;
  onSelect: (id: string) => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  onProgressChange: (id: number, progress: number) => void;
  onCreateSubtask: (task: Task) => void;
  childrenByParent: Map<number, Task[]>;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
}> = ({ task, index, depth, onSelect, onPriorityChange, onProgressChange, onCreateSubtask, childrenByParent, expandedIds, onToggleExpand }) => {
  const children = childrenByParent.get(task.Id) ?? [];
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(task.Id);

  return (
    <>
      <TaskRow
        task={task}
        index={index}
        onClick={() => onSelect(String(task.Id))}
        onPriorityChange={onPriorityChange}
        onProgressChange={onProgressChange}
        onCreateSubtask={onCreateSubtask}
        depth={depth}
        hasChildren={hasChildren}
        childCount={children.length}
        expanded={expanded}
        onToggleExpand={() => onToggleExpand(task.Id)}
      />
      {hasChildren && expanded && children.map((c, i) => (
        <TaskRowNode
          key={c.Id}
          task={c}
          index={i}
          depth={depth + 1}
          onSelect={onSelect}
          onPriorityChange={onPriorityChange}
          onProgressChange={onProgressChange}
          onCreateSubtask={onCreateSubtask}
          childrenByParent={childrenByParent}
          expandedIds={expandedIds}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
};

const TABLE_HEAD_CLS = "px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap";

const TaskGroup: React.FC<{
  title: string;
  tasks: Task[];
  onSelect: (id: string) => void;
  onPriorityChange: (id: number, priority: (typeof PRIORITIES)[number]) => void;
  onProgressChange: (id: number, progress: number) => void;
  onCreateSubtask: (task: Task) => void;
  childrenByParent: Map<number, Task[]>;
  expandedIds: Set<number>;
  onToggleExpand: (id: number) => void;
}> = ({ title, tasks, onSelect, onPriorityChange, onProgressChange, onCreateSubtask, childrenByParent, expandedIds, onToggleExpand }) => {
  const { glassCard } = useGlass();
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
      <div className="rounded-xl overflow-hidden" style={glassCard}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead>
              <tr className="border-b" style={{ borderColor: "rgba(13,148,136,0.15)" }}>
                <th className={`${TABLE_HEAD_CLS} pl-3`}>Task</th>
                <th className={TABLE_HEAD_CLS}>Due</th>
                <th className={TABLE_HEAD_CLS}>Next Follow-up</th>
                <th className={TABLE_HEAD_CLS}>Priority</th>
                <th className={TABLE_HEAD_CLS}>Status</th>
                <th className={TABLE_HEAD_CLS}>Progress</th>
                <th className={`${TABLE_HEAD_CLS} pr-3 text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {tasks.map((t, i) => (
                <TaskRowNode
                  key={t.Id}
                  task={t}
                  index={i}
                  depth={0}
                  onSelect={onSelect}
                  onPriorityChange={onPriorityChange}
                  onProgressChange={onProgressChange}
                  onCreateSubtask={onCreateSubtask}
                  childrenByParent={childrenByParent}
                  expandedIds={expandedIds}
                  onToggleExpand={onToggleExpand}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default FollowUp;
