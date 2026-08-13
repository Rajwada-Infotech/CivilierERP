import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Search, CheckCircle2, ClipboardList } from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { TaskDrawer } from "@/components/followup/TaskDrawer";
import { ExportMenu } from "@/components/ExportMenu";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import type { ExportColumn } from "@/lib/export";

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

const ClosedTaskCard: React.FC<{ task: ClosedTask; index: number; onClick: () => void }> = ({
  task,
  index,
  onClick,
}) => {
  const { glassCard } = useGlass();
  const color = PRIORITY_COLORS[task.Priority as (typeof PRIORITIES)[number]] ?? PRIORITY_COLORS.Normal;

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
      className="relative w-full text-left rounded-xl p-4 space-y-1.5 group overflow-hidden cursor-pointer"
      style={glassCard}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ background: "linear-gradient(to bottom, transparent 10%, #64748b 30%, #64748b 70%, transparent 90%)" }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest">
          {task.TaskNo || "—"}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
          style={{ background: "rgba(100,116,139,0.14)", color: "#64748b" }}
        >
          <CheckCircle2 size={10} /> Closed
        </span>
      </div>
      <p className="text-sm font-semibold text-foreground truncate">{task.Subject}</p>
      {task.ParentTaskNo && (
        <p className="text-[11px] text-muted-foreground truncate">
          Subtask of {task.ParentTaskNo}
          {task.ParentTaskSubject ? ` — ${task.ParentTaskSubject}` : ""}
        </p>
      )}
      {task.CaseProjectName && (
        <p className="text-xs text-muted-foreground truncate">{task.CaseProjectName}</p>
      )}
      <p className="text-xs font-medium text-muted-foreground">
        {task.ClosedAt ? `Closed ${formatDate(task.ClosedAt)}` : "Closed"}
      </p>
      <div className="flex items-center gap-1.5 pt-1">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border"
          style={{ borderColor: `${color}4d`, color, background: `${color}1A` }}
        >
          {task.Priority}
        </span>
        {task.CaseNumber && (
          <span className="ml-auto text-[11px] text-muted-foreground font-mono">{task.CaseNumber}</span>
        )}
      </div>
    </motion.div>
  );
};

const ClosedTasks: React.FC = () => {
  const queryClient = useQueryClient();
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
      ];
      return haystack.some((field) => field?.toString().toLowerCase().includes(q));
    });
  }, [tasks, search]);

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
      queryClient.invalidateQueries({ queryKey: ["closed-board"] }),
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
    { header: "Closed At", accessor: "ClosedAt" },
  ];

  return (
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((t, i) => (
              <ClosedTaskCard key={t.Id} task={t} index={i} onClick={() => setSelectedTaskId(String(t.Id))} />
            ))}
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

export default ClosedTasks;
