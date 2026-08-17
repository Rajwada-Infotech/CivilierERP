import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowLeft,
  Users,
  History,
  ClipboardList,
  Loader2,
} from "lucide-react";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const API = "/api/task-transfer";
const ACCENT = "#0d9488";
const ACCENT_SOFT = "#2dd4bf";

const PRIORITY_COLORS: Record<string, string> = {
  "Very Important": "#ef4444",
  Important: "#22c55e",
  Normal: "#3b82f6",
};

interface TransferUser {
  id: number;
  name: string;
}

interface TransferTask {
  Id: number;
  TaskNo: string | null;
  Subject: string;
  Department: string | null;
  DueDate: string | null;
  CaseNumber: string | null;
  Priority: string;
  Status: string;
  AssignedTo: number;
  CaseCompanyName: string | null;
  CaseProjectName: string | null;
}

interface TransferHistoryRow {
  Id: number;
  TaskId: number;
  TaskNo: string | null;
  TaskSubject: string | null;
  FromUserId: number;
  FromUserName: string | null;
  ToUserId: number;
  ToUserName: string | null;
  TransferredBy: number | null;
  TransferredByName: string | null;
  TransferredAt: string;
  Notes: string | null;
}

async function fetchUsers(): Promise<TransferUser[]> {
  const res = await fetchWithAuth(`${API}/users`);
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json().catch(() => []);
}

async function fetchUserTasks(userId: number | null): Promise<TransferTask[]> {
  if (!userId) return [];
  const res = await fetchWithAuth(`${API}/tasks?userId=${userId}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  return res.json().catch(() => []);
}

async function fetchHistory(): Promise<TransferHistoryRow[]> {
  const res = await fetchWithAuth(`${API}/history?limit=50`);
  if (!res.ok) throw new Error("Failed to fetch transfer history");
  return res.json().catch(() => []);
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
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

const TaskRow: React.FC<{
  task: TransferTask;
  checked: boolean;
  onToggle: () => void;
}> = ({ task, checked, onToggle }) => {
  const color = PRIORITY_COLORS[task.Priority] ?? PRIORITY_COLORS.Normal;
  return (
    <label
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer transition-colors hover:bg-primary/5"
      style={checked ? { background: "rgba(13,148,136,0.10)" } : undefined}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-widest truncate">
            {task.TaskNo || `#${task.Id}`}
          </span>
          <span
            className="shrink-0 inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-md border"
            style={{ borderColor: `${color}4d`, color, background: `${color}1A` }}
          >
            {task.Priority}
          </span>
        </div>
        <p className="text-sm font-medium text-foreground truncate">{task.Subject}</p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-md"
            style={{ background: "rgba(100,116,139,0.14)", color: "#64748b" }}
          >
            {task.Status}
          </span>
          {task.CaseProjectName && <span className="truncate">{task.CaseProjectName}</span>}
          {task.DueDate && <span className="ml-auto shrink-0">{formatDate(task.DueDate)}</span>}
        </div>
      </div>
    </label>
  );
};

const UserPanel: React.FC<{
  title: string;
  users: TransferUser[];
  selectedUserId: number | null;
  onSelectUser: (id: number | null) => void;
  excludeUserId: number | null;
  tasks: TransferTask[];
  isLoading: boolean;
  checkedIds: Set<number>;
  onToggleTask: (id: number) => void;
  onToggleAll: () => void;
}> = ({
  title,
  users,
  selectedUserId,
  onSelectUser,
  excludeUserId,
  tasks,
  isLoading,
  checkedIds,
  onToggleTask,
  onToggleAll,
}) => {
  const { glassCard } = useGlass();
  const allChecked = tasks.length > 0 && tasks.every((t) => checkedIds.has(t.Id));

  return (
    <div className="rounded-xl p-4 flex-1 min-w-0 flex flex-col" style={glassCard}>
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} style={{ color: ACCENT_SOFT }} />
        <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT_SOFT }}>
          {title}
        </p>
      </div>

      <Select
        value={selectedUserId ? String(selectedUserId) : undefined}
        onValueChange={(v) => onSelectUser(v ? parseInt(v, 10) : null)}
      >
        <SelectTrigger className="mb-3">
          <SelectValue placeholder="Select a user…" />
        </SelectTrigger>
        <SelectContent>
          {users
            .filter((u) => u.id !== excludeUserId)
            .map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {!selectedUserId ? (
        <div className="flex-1 flex items-center justify-center py-10 text-center text-xs text-muted-foreground">
          Select a user to see their pending &amp; ongoing tasks
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={18} className="animate-spin" style={{ color: ACCENT }} />
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-10 text-center">
          <ClipboardList size={18} style={{ color: ACCENT_SOFT }} />
          <p className="text-xs text-muted-foreground">No pending or ongoing tasks</p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between px-2.5 pb-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
              Select all ({tasks.length})
            </label>
            {checkedIds.size > 0 && (
              <span className="text-[11px] font-semibold" style={{ color: ACCENT }}>
                {checkedIds.size} selected
              </span>
            )}
          </div>
          <div className="space-y-1 max-h-[420px] overflow-y-auto thin-scroll pr-1">
            {tasks.map((t) => (
              <TaskRow key={t.Id} task={t} checked={checkedIds.has(t.Id)} onToggle={() => onToggleTask(t.Id)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const TaskTransfer: React.FC = () => {
  const queryClient = useQueryClient();
  const { glassCard } = useGlass();

  const [userAId, setUserAId] = React.useState<number | null>(null);
  const [userBId, setUserBId] = React.useState<number | null>(null);
  const [checkedA, setCheckedA] = React.useState<Set<number>>(new Set());
  const [checkedB, setCheckedB] = React.useState<Set<number>>(new Set());
  const [confirmDirection, setConfirmDirection] = React.useState<"AtoB" | "BtoA" | null>(null);
  const [isTransferring, setIsTransferring] = React.useState(false);

  const { data: users = [] } = useQuery({ queryKey: ["task-transfer-users"], queryFn: fetchUsers, staleTime: 60_000 });

  const { data: tasksA = [], isLoading: loadingA } = useQuery({
    queryKey: ["task-transfer-tasks", userAId],
    queryFn: () => fetchUserTasks(userAId),
    enabled: !!userAId,
  });
  const { data: tasksB = [], isLoading: loadingB } = useQuery({
    queryKey: ["task-transfer-tasks", userBId],
    queryFn: () => fetchUserTasks(userBId),
    enabled: !!userBId,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["task-transfer-history"],
    queryFn: fetchHistory,
    staleTime: 30_000,
  });

  React.useEffect(() => setCheckedA(new Set()), [userAId]);
  React.useEffect(() => setCheckedB(new Set()), [userBId]);

  const userAName = users.find((u) => u.id === userAId)?.name || "User 1";
  const userBName = users.find((u) => u.id === userBId)?.name || "User 2";

  const toggleTask = (set: Set<number>, id: number, setter: (s: Set<number>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["task-transfer-tasks", userAId] }),
      queryClient.invalidateQueries({ queryKey: ["task-transfer-tasks", userBId] }),
      queryClient.invalidateQueries({ queryKey: ["task-transfer-history"] }),
    ]);
  };

  const performTransfer = async () => {
    if (!confirmDirection || !userAId || !userBId) return;
    const fromUserId = confirmDirection === "AtoB" ? userAId : userBId;
    const toUserId = confirmDirection === "AtoB" ? userBId : userAId;
    const taskIds = Array.from(confirmDirection === "AtoB" ? checkedA : checkedB);

    setIsTransferring(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ TaskIds: taskIds, FromUserId: fromUserId, ToUserId: toUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to transfer tasks");
      toast.success(data.message || "Tasks transferred successfully");
      setCheckedA(new Set());
      setCheckedB(new Set());
      await invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to transfer tasks");
    } finally {
      setIsTransferring(false);
      setConfirmDirection(null);
    }
  };

  const bothSelected = !!userAId && !!userBId && userAId !== userBId;
  const sameUserPicked = !!userAId && !!userBId && userAId === userBId;

  const confirmTaskIds = confirmDirection === "AtoB" ? checkedA : confirmDirection === "BtoA" ? checkedB : new Set<number>();
  const confirmFromName = confirmDirection === "AtoB" ? userAName : userBName;
  const confirmToName = confirmDirection === "AtoB" ? userBName : userAName;

  return (
    <FollowupShell
      title="Task Transfer"
      subtitle="Move pending & ongoing tasks between two users"
      icon={ArrowRight}
    >
      {/* ── User pickers + panels ─────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row items-stretch gap-3">
        <UserPanel
          title="User 1 (From)"
          users={users}
          selectedUserId={userAId}
          onSelectUser={setUserAId}
          excludeUserId={userBId}
          tasks={tasksA}
          isLoading={loadingA}
          checkedIds={checkedA}
          onToggleTask={(id) => toggleTask(checkedA, id, setCheckedA)}
          onToggleAll={() =>
            setCheckedA(checkedA.size === tasksA.length ? new Set() : new Set(tasksA.map((t) => t.Id)))
          }
        />

        {/* ── Transfer controls ──────────────────────────────────────── */}
        <div className="flex lg:flex-col items-center justify-center gap-3 py-2 lg:py-0 lg:px-1 shrink-0">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-11 w-11 border-2"
            style={{ borderColor: `${ACCENT}55` }}
            disabled={!bothSelected || checkedA.size === 0}
            onClick={() => setConfirmDirection("AtoB")}
            title={`Transfer selected tasks to ${userBName}`}
          >
            <ArrowRight size={18} style={{ color: ACCENT }} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full h-11 w-11 border-2"
            style={{ borderColor: `${ACCENT}55` }}
            disabled={!bothSelected || checkedB.size === 0}
            onClick={() => setConfirmDirection("BtoA")}
            title={`Transfer selected tasks to ${userAName}`}
          >
            <ArrowLeft size={18} style={{ color: ACCENT }} />
          </Button>
        </div>

        <UserPanel
          title="User 2 (To)"
          users={users}
          selectedUserId={userBId}
          onSelectUser={setUserBId}
          excludeUserId={userAId}
          tasks={tasksB}
          isLoading={loadingB}
          checkedIds={checkedB}
          onToggleTask={(id) => toggleTask(checkedB, id, setCheckedB)}
          onToggleAll={() =>
            setCheckedB(checkedB.size === tasksB.length ? new Set() : new Set(tasksB.map((t) => t.Id)))
          }
        />
      </div>

      {sameUserPicked && (
        <p className="text-xs text-center" style={{ color: "#ef4444" }}>
          User 1 and User 2 must be different.
        </p>
      )}

      {/* ── Transfer history ──────────────────────────────────────────── */}
      <div className="rounded-xl p-4" style={glassCard}>
        <div className="flex items-center gap-2 mb-3">
          <History size={14} style={{ color: ACCENT_SOFT }} />
          <p className="text-[11px] font-heading font-semibold uppercase tracking-widest" style={{ color: ACCENT_SOFT }}>
            Transfer History
          </p>
          <span className="text-[10px] text-muted-foreground">{history.length}</span>
        </div>

        {loadingHistory ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin" style={{ color: ACCENT }} />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">No transfers yet</p>
        ) : (
          <div className="overflow-x-auto thin-scroll">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border/40">
                  <th className="py-2 pr-3 font-medium">Task</th>
                  <th className="py-2 pr-3 font-medium">From</th>
                  <th className="py-2 pr-3 font-medium">To</th>
                  <th className="py-2 pr-3 font-medium">Transferred By</th>
                  <th className="py-2 pr-3 font-medium">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.Id} className="border-b border-border/20 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-muted-foreground">{h.TaskNo || `#${h.TaskId}`}</span>
                      <span className="block text-foreground truncate max-w-[220px]">{h.TaskSubject}</span>
                    </td>
                    <td className="py-2 pr-3 text-foreground">{h.FromUserName || "—"}</td>
                    <td className="py-2 pr-3 text-foreground">{h.ToUserName || "—"}</td>
                    <td className="py-2 pr-3 text-foreground">{h.TransferredByName || "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDateTime(h.TransferredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Confirmation dialog ──────────────────────────────────────── */}
      <AlertDialog open={!!confirmDirection} onOpenChange={(open) => !open && setConfirmDirection(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer {confirmTaskIds.size} task{confirmTaskIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reassign {confirmTaskIds.size} task{confirmTaskIds.size === 1 ? "" : "s"} from{" "}
              <strong className="text-foreground">{confirmFromName}</strong> to{" "}
              <strong className="text-foreground">{confirmToName}</strong>. This action is logged in the transfer
              history and takes effect immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isTransferring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isTransferring}
              onClick={(e) => {
                e.preventDefault();
                performTransfer();
              }}
            >
              {isTransferring ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" /> Transferring…
                </span>
              ) : (
                "Confirm Transfer"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FollowupShell>
  );
};

export default TaskTransfer;
