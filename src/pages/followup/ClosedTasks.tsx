import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Search, CheckCircle2, ClipboardList } from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ProgressBar } from "@/components/followup/ProgressBar";
import { ExportMenu } from "@/components/ExportMenu";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/task-master";
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;

// Same teal identity as the rest of the Follow-Up module — kept in sync
// deliberately (see FollowUp.tsx/FollowupShell.tsx).
const ACCENT = "#0d9488";
const ACCENT_SOFT = "#2dd4bf";

const PRIORITY_COLORS: Record<(typeof PRIORITIES)[number], string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
};

interface ClosedTask {
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
  ParentTaskId: number | null;
  ParentTaskNo: string | null;
  ParentTaskSubject: string | null;
  ClosedAt: string | null;
  Tags: { Id: number; Name: string }[];
  Progress: number;
  EffectiveProgress: number;
  HasChildren: boolean;
}

async function fetchClosedBoard(): Promise<ClosedTask[]> {
  const res = await fetchWithAuth(`${API}/closed-board`);
  if (!res.ok) throw new Error("Failed to fetch closed tasks");
  return res.json().catch(() => []);
}

function formatDate(dateStr: string): string {
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

const TABLE_HEAD_CLS = "px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap";

// Row-wise replacement for the old ClosedTaskCard — same fields, laid out as
// a compact <tr> so many closed tasks are visible at once instead of one per
// large card.
const ClosedTaskRow: React.FC<{ task: ClosedTask; index: number; onClick: () => void }> = ({
  task,
  index,
  onClick,
}) => {
  const color = PRIORITY_COLORS[task.Priority as (typeof PRIORITIES)[number]] ?? PRIORITY_COLORS.Normal;

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
      className="group cursor-pointer transition-colors hover:bg-muted/40"
    >
      <td className="pl-3 pr-2 py-2.5 align-top relative">
        <div
          className="absolute left-0 top-0 bottom-0 w-0.5"
          style={{ background: "linear-gradient(to bottom, transparent 10%, #64748b 30%, #64748b 70%, transparent 90%)" }}
        />
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {task.TaskNo || "—"}
        </span>
        <p className="text-sm font-semibold text-foreground truncate">{task.Subject}</p>
        {task.ParentTaskNo && (
          <p className="text-[11px] text-muted-foreground truncate">
            Subtask of {task.ParentTaskNo}
            {task.ParentTaskSubject ? ` — ${task.ParentTaskSubject}` : ""}
          </p>
        )}
        {task.CaseProjectName && (
          <p className="text-[11px] text-muted-foreground truncate">{task.CaseProjectName}</p>
        )}
        {task.Tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {task.Tags.map((tag) => (
              <span
                key={tag.Id}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-medium truncate max-w-[100px]"
                style={{ background: "rgba(13,148,136,0.12)", border: "1px solid rgba(13,148,136,0.3)", color: ACCENT }}
                title={tag.Name}
              >
                {tag.Name}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2.5 align-top text-xs font-medium text-muted-foreground whitespace-nowrap">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md mb-1"
          style={{ background: "rgba(100,116,139,0.14)", color: "#64748b" }}
        >
          <CheckCircle2 size={10} /> Closed
        </span>
        <div>{task.ClosedAt ? formatDate(task.ClosedAt) : "—"}</div>
      </td>
      <td className="px-2 py-2.5 align-top">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap"
          style={{ borderColor: `${color}4d`, color, background: `${color}1A` }}
        >
          {task.Priority}
        </span>
      </td>
      <td className="px-2 py-2.5 align-top text-xs text-muted-foreground font-mono whitespace-nowrap">
        {task.CaseNumber || "—"}
      </td>
      <td className="pl-2 pr-3 py-2.5 align-top w-[150px]" onClick={(e) => e.stopPropagation()}>
        {/* Read-only here — a closed task reads as complete; edit progress
            from the drawer/active board instead of implying you can reopen
            it by dragging this bar back down. */}
        <ProgressBar value={task.EffectiveProgress ?? task.Progress ?? 100} onCommit={() => {}} disabled size="sm" />
      </td>
    </motion.tr>
  );
};

const ClosedTasks: React.FC = () => {
  const queryClient = useQueryClient();
  usePageRights("followup-close-tasks");
  const { glassCard } = useGlass();
  const [search, setSearch] = React.useState("");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["closed-board"],
    queryFn: fetchClosedBoard,
    staleTime: 60 * 1000,
  });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((t) => {
      const haystack = [
        t.TaskNo,
        t.Subject,
        t.Details,
        t.Department,
        t.CaseNumber,
        t.Priority,
        t.CaseCompanyName,
        t.CaseProjectName,
        t.CaseFinYearName,
        t.ClosedAt ? formatDate(t.ClosedAt) : null,
        ...(t.Tags?.map((tag) => tag.Name) ?? []),
      ];
      return haystack.some((field) => field?.toString().toLowerCase().includes(q));
    });
  }, [tasks, search]);

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
      queryClient.invalidateQueries({ queryKey: ["closed-board"] }),
      queryClient.invalidateQueries({ queryKey: ["followup-task", id] }),
      queryClient.invalidateQueries({ queryKey: ["cancelled-board-count"] }),
    ]);
  };

  const exportColumns: ExportColumn[] = [
    { header: "Task No.", accessor: "TaskNo" },
    { header: "Subject", accessor: "Subject" },
    { header: "Department", accessor: "Department" },
    { header: "Due Date", accessor: "DueDate" },
    { header: "Case Number", accessor: "CaseNumber" },
    { header: "Priority", accessor: "Priority" },
    { header: "Company", accessor: "CaseCompanyName" },
    { header: "Project", accessor: "CaseProjectName" },
    { header: "Closed At", accessor: "ClosedAt" },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Closed Tasks"]} />
      <FollowupShell
        title="Close Task"
      subtitle="All tasks that have been closed"
      icon={CheckCircle2}
      action={
        <ExportMenu
          data={filtered as unknown as Record<string, unknown>[]}
          columns={exportColumns}
          title="Closed Tasks"
          filename="closed-tasks"
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
          placeholder="Search closed tasks…"
          className="w-full pl-10 pr-3 py-3 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground"
        />
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: "rgba(13,148,136,0.2)", borderTopColor: ACCENT }}
          />
        </div>
      ) : filtered.length === 0 ? (
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
          <p className="text-sm font-medium text-foreground">No closed tasks</p>
          <p className="text-xs text-muted-foreground">Tasks you close from the Follow-Up drawer show up here.</p>
        </motion.div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT_SOFT }}>
              Closed
            </p>
            <span className="text-[10px] text-muted-foreground">{filtered.length}</span>
            <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, rgba(13,148,136,0.25), transparent)" }} />
          </div>
          <div className="rounded-xl overflow-hidden" style={glassCard}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "rgba(13,148,136,0.15)" }}>
                    <th className={`${TABLE_HEAD_CLS} pl-3`}>Task</th>
                    <th className={TABLE_HEAD_CLS}>Status / Closed</th>
                    <th className={TABLE_HEAD_CLS}>Priority</th>
                    <th className={TABLE_HEAD_CLS}>Case No.</th>
                    <th className={`${TABLE_HEAD_CLS} pr-3`}>Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((t, i) => (
                    <ClosedTaskRow key={t.Id} task={t} index={i} onClick={() => setSelectedTaskId(String(t.Id))} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <TaskDrawer
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onStatusChange={handleStatusChange}
      />
      </FollowupShell>
    </>
  );
};

export default ClosedTasks;
