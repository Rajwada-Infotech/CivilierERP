import { PRIORITY_TONES } from "@/components/followup/sheetParts";
import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Search, XCircle, ClipboardList } from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";

const API = "/api/task-master";
const PRIORITIES = ["Very Important", "Important", "Normal"] as const;

// Ink on paper, like the rest of the Follow-Up module
// deliberately (see FollowUp.tsx/FollowupShell.tsx). Cancelled cards use a
// red accent for the left rail/status pill instead, matching TaskDrawer's
// own cancellation styling.
const ACCENT = "hsl(var(--foreground))";
const ACCENT_SOFT = "hsl(var(--foreground))";
const CANCEL_RED = "hsl(var(--destructive))";

const PRIORITY_COLORS: Record<(typeof PRIORITIES)[number], string> = {
  "Very Important": "hsl(var(--destructive))",
  Important: "hsl(var(--foreground))",
  Normal: "hsl(var(--primary))",
};

interface CancelledTask {
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
  CancelledAt: string | null;
  CancelReasonId: number | null;
  CancelReasonLabel: string | null;
  CancelledBy: number | null;
  CancelledByName: string | null;
  Tags: { Id: number; Name: string }[];
  Progress: number;
}

async function fetchCancelledBoard(): Promise<CancelledTask[]> {
  const res = await fetchWithAuth(`${API}/cancelled-board`);
  if (!res.ok) throw new Error("Failed to fetch cancelled tasks");
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
  const isDark = !isLightTheme(theme);
  const glassCard = isDark
    ? {
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--foreground) / 0.18)",
      }
    : {
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--foreground) / 0.20)",
      };
  return { isDark, glassCard };
}

const TABLE_HEAD_CLS = "px-2 py-2 text-left text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap";

// Row-wise replacement for the old CancelledTaskCard — same fields, laid out
// as a compact <tr> so many cancelled tasks are visible at once instead of
// one per large card.
const CancelledTaskRow: React.FC<{ task: CancelledTask; index: number; onClick: () => void }> = ({
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
          style={{ background: CANCEL_RED }}
        />
        <span className="tabular-nums text-[0.625rem] text-muted-foreground uppercase tracking-widest">
          {task.TaskNo || "—"}
        </span>
        <p className="text-sm font-semibold text-foreground truncate">{task.Subject}</p>
        {task.ParentTaskNo && (
          <p className="text-[0.6875rem] text-muted-foreground truncate">
            Subtask of {task.ParentTaskNo}
            {task.ParentTaskSubject ? ` — ${task.ParentTaskSubject}` : ""}
          </p>
        )}
        {task.CaseProjectName && (
          <p className="text-[0.6875rem] text-muted-foreground truncate">{task.CaseProjectName}</p>
        )}
        {task.Tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {task.Tags.map((tag) => (
              <span
                key={tag.Id}
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.5625rem] font-medium truncate max-w-[100px]"
                style={{ background: "hsl(var(--foreground) / 0.12)", border: "1px solid hsl(var(--foreground) / 0.3)", color: ACCENT }}
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
          className="inline-flex items-center gap-1 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-md mb-1"
          style={{ background: "hsl(var(--destructive) / 0.12)", color: CANCEL_RED }}
        >
          <XCircle size={10} /> Cancelled
        </span>
        <div>{task.CancelledAt ? formatDate(task.CancelledAt) : "—"}</div>
        {task.CancelledByName && <div className="text-[0.6875rem]">{task.CancelledByName}</div>}
      </td>
      <td className="px-2 py-2.5 align-top text-xs max-w-[220px]">
        {task.CancelReasonLabel ? (
          <span
            className="inline-block px-2 py-1 rounded-lg text-[0.6875rem]"
            style={{ background: "hsl(var(--destructive) / 0.06)", border: "1px solid hsl(var(--destructive) / 0.15)" }}
          >
            {task.CancelReasonLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2.5 align-top">
        <span
          className="inline-flex items-center gap-1 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-md border whitespace-nowrap"
          style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, color, background: `color-mix(in srgb, ${color} 10%, transparent)` }}
        >
          {task.Priority}
        </span>
      </td>
      <td className="pl-2 pr-3 py-2.5 align-top text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        {task.CaseNumber || "—"}
      </td>
    </motion.tr>
  );
};

const CancelledTasks: React.FC = () => {
  usePageRights("followup-cancelled-tasks");
  const queryClient = useQueryClient();
  const { glassCard } = useGlass();
  const [search, setSearch] = React.useState("");
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["cancelled-board"],
    queryFn: fetchCancelledBoard,
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
        t.CancelReasonLabel,
        t.CancelledByName,
        t.CancelledAt ? formatDate(t.CancelledAt) : null,
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
      queryClient.invalidateQueries({ queryKey: ["cancelled-board"] }),
      queryClient.invalidateQueries({ queryKey: ["cancelled-board-count"] }),
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
    { header: "Company", accessor: "CaseCompanyName" },
    { header: "Project", accessor: "CaseProjectName" },
    { header: "Cancel Reason", accessor: "CancelReasonLabel" },
    { header: "Cancelled By", accessor: "CancelledByName" },
    { header: "Cancelled At", accessor: "CancelledAt" },
  ];

  return (
    <FollowupShell
      title="Cancelled Tasks"
      subtitle="All tasks that have been cancelled — kept for history and reports"
      icon={XCircle}
      action={
        <ExportMenu
          data={filtered as unknown as Record<string, unknown>[]}
          columns={exportColumns}
          title="Cancelled Tasks"
          filename="cancelled-tasks"
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
          placeholder="Search cancelled tasks…"
          className="w-full pl-10 pr-3 py-3 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground"
        />
      </motion.div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: "hsl(var(--foreground) / 0.2)", borderTopColor: ACCENT }}
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
            style={{ background: "hsl(var(--foreground) / 0.14)", border: "1px solid hsl(var(--foreground) / 0.3)" }}
          >
            <ClipboardList size={18} style={{ color: ACCENT_SOFT }} />
          </div>
          <p className="text-sm font-medium text-foreground">No cancelled tasks</p>
          <p className="text-xs text-muted-foreground">Tasks you cancel from the Follow-Up drawer show up here.</p>
        </motion.div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <p className="text-[0.6875rem] font-heading font-semibold uppercase tracking-widest" style={{ color: CANCEL_RED }}>
              Cancelled
            </p>
            <span className="text-[0.625rem] text-muted-foreground">{filtered.length}</span>
            <div className="flex-1 h-px" style={{ background: "linear-gradient(to right, hsl(var(--destructive) / 0.25), transparent)" }} />
          </div>
          <div className="rounded-xl overflow-hidden" style={glassCard}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead>
                  <tr className="border-b" style={{ borderColor: "hsl(var(--destructive) / 0.15)" }}>
                    <th className={`${TABLE_HEAD_CLS} pl-3`}>Task</th>
                    <th className={TABLE_HEAD_CLS}>Status / Cancelled</th>
                    <th className={TABLE_HEAD_CLS}>Reason</th>
                    <th className={TABLE_HEAD_CLS}>Priority</th>
                    <th className={`${TABLE_HEAD_CLS} pr-3`}>Case No.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filtered.map((t, i) => (
                    <CancelledTaskRow key={t.Id} task={t} index={i} onClick={() => setSelectedTaskId(String(t.Id))} />
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
  );
};

export default CancelledTasks;
