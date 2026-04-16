import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
} from "react";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "in_progress" | "closed" | "reviewed";
export type TaskPriority = "low" | "medium" | "high";

export interface QualityCriteria {
  id: string;
  label: string;
  met: boolean;
}

export interface TaskComment {
  id: string;
  userId: string;
  userName: string;
  userInitials: string;
  text: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: string;
  assignedToName: string;
  createdBy: string;
  createdByName: string;
  reviewedBy?: string;
  reviewedByName?: string;
  dueDate: string;
  qualityCriteria: QualityCriteria[];
  /** Comments stored inline — no separate TaskComments table or endpoint. */
  comments: TaskComment[];
  closedAt?: string;
  reviewedAt?: string;
  createdAt: string;
}

interface TaskContextType {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  addTask: (task: Omit<Task, "id" | "createdAt" | "comments">) => Promise<void>;
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  closeTask: (taskId: string) => Promise<void>;
  reviewTask: (
    taskId: string,
    userId: string,
    userName: string,
    approved: boolean,
  ) => Promise<void>;
  addComment: (
    taskId: string,
    user: { id: string; name: string; initials: string },
    text: string,
  ) => Promise<void>;
  toggleQualityCriteria: (taskId: string, criteriaId: string) => Promise<void>;
  getTasksForUser: (userId: string) => Task[];
  getOverdueTasks: () => Task[];
  getDueSoonTasks: () => Task[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

const TaskContext = createContext<TaskContextType | null>(null);

export const useTask = () => {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTask must be inside TaskProvider");
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

export const TaskProvider = ({ children }: { children: React.ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch tasks ──────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/tasks");
      if (!res.ok) throw new Error("Failed to load tasks");
      const data: Task[] = await res.json();
      setTasks(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load tasks";
      setError(msg);
      console.error("TaskContext refetch:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      refetch();
    }
  }, [refetch]);

  // ── Add task ─────────────────────────────────────────────────────────────
  const addTask = useCallback(
    async (task: Omit<Task, "id" | "createdAt" | "comments">) => {
      try {
        const res = await fetchWithAuth("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: task.title,
            description: task.description,
            priority: task.priority,
            assignedTo: task.assignedTo,
            dueDate: task.dueDate,
            qualityCriteria: task.qualityCriteria,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to create task");
        }
        const newTask: Task = await res.json();
        setTasks((prev) => [newTask, ...prev]);
        toast.success(`Task "${task.title}" created.`);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to create task";
        toast.error(msg);
        throw err;
      }
    },
    [],
  );

  // ── Update task ──────────────────────────────────────────────────────────
  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      try {
        const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to update task");
        }
        const updated: Task = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to update task";
        toast.error(msg);
        throw err;
      }
    },
    [],
  );

  // ── Delete task ──────────────────────────────────────────────────────────
  const deleteTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to delete task");
      }
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      toast.success("Task deleted.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete task";
      toast.error(msg);
      throw err;
    }
  }, []);

  // ── Close task ───────────────────────────────────────────────────────────
  const closeTask = useCallback(async (taskId: string) => {
    try {
      const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify({ status: "closed" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || "Failed to close task");
      }
      const updated: Task = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      toast.success("Task marked as closed. Pending review.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to close task";
      toast.error(msg);
      throw err;
    }
  }, []);

  // ── Review task ──────────────────────────────────────────────────────────
  const reviewTask = useCallback(
    async (
      taskId: string,
      userId: string,
      _userName: string,
      approved: boolean,
    ) => {
      try {
        const body = approved
          ? { status: "reviewed", reviewedBy: userId }
          : { status: "in_progress" };

        const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to review task");
        }
        const updated: Task = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
        if (approved) toast.success("Task reviewed and approved.");
        else toast.warning("Task sent back for rework.");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Failed to review task";
        toast.error(msg);
        throw err;
      }
    },
    [],
  );

  // ── Add comment (inline, via PUT — no separate POST /comments endpoint) ──
  const addComment = useCallback(
    async (
      taskId: string,
      user: { id: string; name: string; initials: string },
      text: string,
    ) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const newComment: TaskComment = {
        id: `c-${Date.now()}`,
        userId: user.id,
        userName: user.name,
        userInitials: user.initials,
        text,
        createdAt: new Date().toISOString(),
      };

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, comments: [...t.comments, newComment] } : t,
        ),
      );

      try {
        const updatedComments = [...task.comments, newComment];
        const res = await fetchWithAuth(`/api/tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify({ comments: updatedComments }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to add comment");
        }
        // Server may return a cleaned-up version; sync it
        const updated: Task = await res.json();
        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));
      } catch (err) {
        // Revert optimistic update
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, comments: task.comments } : t,
          ),
        );
        const msg =
          err instanceof Error ? err.message : "Failed to add comment";
        toast.error(msg);
        throw err;
      }
    },
    [tasks],
  );

  // ── Toggle quality criteria (optimistic) ─────────────────────────────────
  const toggleQualityCriteria = useCallback(
    async (taskId: string, criteriaId: string) => {
      let updatedQC: QualityCriteria[] = [];
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          updatedQC = t.qualityCriteria.map((qc) =>
            qc.id === criteriaId ? { ...qc, met: !qc.met } : qc,
          );
          return { ...t, qualityCriteria: updatedQC };
        }),
      );

      try {
        await fetchWithAuth(`/api/tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify({ qualityCriteria: updatedQC }),
        });
      } catch {
        await refetch();
        toast.error("Failed to save quality criteria. Please try again.");
      }
    },
    [refetch],
  );

  // ── Derived helpers ───────────────────────────────────────────────────────
  const getTasksForUser = useCallback(
    (userId: string) =>
      tasks.filter((t) => t.assignedTo === userId || t.createdBy === userId),
    [tasks],
  );

  // ── Task filter helpers ──────────────────────────────────────────────────
  const today = useMemo(() => new Date(), []);
  const threeDaysFromNow = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date;
  }, []);

  const getOverdueTasks = useCallback(() => {
    return tasks.filter((task) => {
      const due = new Date(task.dueDate);
      return (
        due < today &&
        task.status !== "closed" &&
        task.status !== "reviewed"
      );
    });
  }, [tasks, today]);

  const getDueSoonTasks = useCallback(() => {
    return tasks.filter((task) => {
      const due = new Date(task.dueDate);
      return (
        due <= threeDaysFromNow &&
        task.status !== "closed" &&
        task.status !== "reviewed"
      );
    });
  }, [tasks, threeDaysFromNow]);

  const value = useMemo(
    () => ({
      tasks,
      loading,
      error,
      refetch,
      addTask,
      updateTask,
      deleteTask,
      closeTask,
      reviewTask,
      addComment,
      toggleQualityCriteria,
      getTasksForUser,
      getOverdueTasks,
      getDueSoonTasks,
    }),
    [
      tasks,
      loading,
      error,
      refetch,
      addTask,
      updateTask,
      deleteTask,
      closeTask,
      reviewTask,
      addComment,
      toggleQualityCriteria,
      getTasksForUser,
      getOverdueTasks,
      getDueSoonTasks,
    ],
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
};
