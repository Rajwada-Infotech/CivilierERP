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
  if (!ctx) throw new Error("useTask must be used inside TaskProvider");
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────
export const TaskProvider = ({ children }: { children: React.ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch tasks ──────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      setLoading(false);
      return;
    }

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

  // ── Add comment ──────────────────────────────────────────────────────────
  // FIX: Was incorrectly calling PUT /api/tasks/:id with a `comments` body field
  // that the backend ignores. Now correctly calls POST /api/tasks/:id/comments.
  const addComment = useCallback(
    async (
      taskId: string,
      user: { id: string; name: string; initials: string },
      text: string,
    ) => {
      // Optimistic update
      const optimisticComment: TaskComment = {
        id: `c-optimistic-${Date.now()}`,
        userId: user.id,
        userName: user.name,
        userInitials: user.initials,
        text,
        createdAt: new Date().toISOString(),
      };

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, comments: [...t.comments, optimisticComment] }
            : t,
        ),
      );

      try {
        const res = await fetchWithAuth(`/api/tasks/${taskId}/comments`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || "Failed to add comment");
        }

        const savedComment: TaskComment = await res.json();

        // Replace optimistic entry with the real one from the server
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              comments: t.comments.map((c) =>
                c.id === optimisticComment.id ? savedComment : c,
              ),
            };
          }),
        );
      } catch (err) {
        // Revert optimistic update
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            return {
              ...t,
              comments: t.comments.filter((c) => c.id !== optimisticComment.id),
            };
          }),
        );
        const msg =
          err instanceof Error ? err.message : "Failed to add comment";
        toast.error(msg);
        throw err;
      }
    },
    [],
  );

  // ── Toggle quality criteria ─────────────────────────────────────────────
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
        toast.error("Failed to save quality criteria. Please try again.");
        refetch(); // fallback
      }
    },
    [refetch],
  );

  // ── Derived helpers ─────────────────────────────────────────────────────
  const getTasksForUser = useCallback(
    (userId: string) =>
      tasks.filter((t) => t.assignedTo === userId || t.createdBy === userId),
    [tasks],
  );

  // FIX: Was using useMemo(()=>new Date(),[]) which froze the date at mount time.
  // Now computed fresh inside each callback so midnight-crossings work correctly.
  const getOverdueTasks = useCallback(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return tasks.filter((task) => {
      const due = new Date(task.dueDate);
      due.setHours(0, 0, 0, 0);
      return (
        due < now && task.status !== "closed" && task.status !== "reviewed"
      );
    });
  }, [tasks]);

  const getDueSoonTasks = useCallback(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    return tasks.filter((task) => {
      const due = new Date(task.dueDate);
      due.setHours(0, 0, 0, 0);
      return (
        due >= now &&
        due <= threeDaysFromNow &&
        task.status !== "closed" &&
        task.status !== "reviewed"
      );
    });
  }, [tasks]);

  // ── Context Value ───────────────────────────────────────────────────────
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
