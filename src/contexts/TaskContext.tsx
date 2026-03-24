import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { toast } from "sonner";

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
  reminderSent: boolean;
}

const DEMO_TASKS: Task[] = [
  {
    id: "task-1",
    title: "Complete Contractor Master Data Entry",
    description: "Enter all contractor details including GST and PAN numbers for Q1.",
    priority: "high",
    status: "open",
    assignedTo: "u-user-1",
    assignedToName: "Rajesh Kumar",
    createdBy: "u-admin-1",
    createdByName: "Admin User",
    dueDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    qualityCriteria: [
      { id: "qc-1", label: "All GST numbers verified", met: false },
      { id: "qc-2", label: "PAN numbers entered", met: false },
      { id: "qc-3", label: "Contact details complete", met: false },
    ],
    comments: [],
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    reminderSent: false,
  },
  {
    id: "task-2",
    title: "Verify Bank Account Reconciliation",
    description: "Reconcile all bank accounts for the month of March.",
    priority: "medium",
    status: "in_progress",
    assignedTo: "u-user-2",
    assignedToName: "Meena Patel",
    createdBy: "u-admin-1",
    createdByName: "Admin User",
    dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    qualityCriteria: [
      { id: "qc-4", label: "HDFC account reconciled", met: true },
      { id: "qc-5", label: "SBI account reconciled", met: false },
      { id: "qc-6", label: "ICICI account reconciled", met: false },
    ],
    comments: [
      { id: "c-1", userId: "u-user-2", userName: "Meena Patel", userInitials: "MP", text: "Started HDFC reconciliation.", createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
    ],
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    reminderSent: false,
  },
  {
    id: "task-3",
    title: "Supplier Invoice Review",
    description: "Review all pending supplier invoices and approve payments.",
    priority: "low",
    status: "closed",
    assignedTo: "u-user-1",
    assignedToName: "Rajesh Kumar",
    createdBy: "u-super-1",
    createdByName: "Super Admin",
    reviewedBy: undefined,
    dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    qualityCriteria: [
      { id: "qc-7", label: "All invoices stamped", met: true },
      { id: "qc-8", label: "Amounts verified", met: true },
    ],
    comments: [],
    closedAt: new Date().toISOString(),
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    reminderSent: false,
  },
];

interface TaskContextType {
  tasks: Task[];
  addTask: (task: Omit<Task, "id" | "createdAt" | "comments" | "reminderSent">) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  deleteTask: (taskId: string) => void;
  // FIX: Removed unused userId/userName params from closeTask signature.
  //      The function only sets status/closedAt and never used those params.
  closeTask: (taskId: string) => void;
  reviewTask: (taskId: string, userId: string, userName: string, approved: boolean) => void;
  addComment: (taskId: string, user: { id: string; name: string; initials: string }, text: string) => void;
  toggleQualityCriteria: (taskId: string, criteriaId: string) => void;
  getTasksForUser: (userId: string) => Task[];
  getOverdueTasks: () => Task[];
  getDueSoonTasks: () => Task[];
}

const TaskContext = createContext<TaskContextType | null>(null);

export const useTask = () => {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTask must be inside TaskProvider");
  return ctx;
};

export const TaskProvider = ({ children }: { children: React.ReactNode }) => {
  const [tasks, setTasks] = useState<Task[]>(DEMO_TASKS);

  const addTask = useCallback((task: Omit<Task, "id" | "createdAt" | "comments" | "reminderSent">) => {
    const newTask: Task = {
      ...task,
      id: `task-${Date.now()}`,
      createdAt: new Date().toISOString(),
      comments: [],
      reminderSent: false,
    };
    setTasks(prev => [newTask, ...prev]);
    toast.success(`Task "${task.title}" created.`);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    toast.success("Task deleted.");
  }, []);

  // FIX: Removed unused userId, userName parameters
  const closeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t, status: "closed" as TaskStatus, closedAt: new Date().toISOString(),
    } : t));
    toast.success("Task marked as closed. Pending review.");
  }, []);

  const reviewTask = useCallback((taskId: string, userId: string, userName: string, approved: boolean) => {
    if (approved) {
      setTasks(prev => prev.map(t => t.id === taskId ? {
        ...t, status: "reviewed" as TaskStatus,
        reviewedBy: userId, reviewedByName: userName,
        reviewedAt: new Date().toISOString(),
      } : t));
      toast.success("Task reviewed and approved.");
    } else {
      setTasks(prev => prev.map(t => t.id === taskId ? {
        ...t, status: "in_progress" as TaskStatus,
        reviewedBy: undefined, reviewedByName: undefined,
      } : t));
      toast.warning("Task sent back for rework.");
    }
  }, []);

  const addComment = useCallback((taskId: string, user: { id: string; name: string; initials: string }, text: string) => {
    const comment: TaskComment = {
      id: `c-${Date.now()}`,
      userId: user.id,
      userName: user.name,
      userInitials: user.initials,
      text,
      createdAt: new Date().toISOString(),
    };
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, comments: [...t.comments, comment] } : t));
  }, []);

  const toggleQualityCriteria = useCallback((taskId: string, criteriaId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t,
      qualityCriteria: t.qualityCriteria.map(qc => qc.id === criteriaId ? { ...qc, met: !qc.met } : qc),
    } : t));
  }, []);

  const getTasksForUser = useCallback((userId: string) =>
    tasks.filter(t => t.assignedTo === userId || t.createdBy === userId), [tasks]);

  const getOverdueTasks = useCallback(() => {
    const now = new Date();
    return tasks.filter(t =>
      (t.status === "open" || t.status === "in_progress") && new Date(t.dueDate) < now
    );
  }, [tasks]);

  const getDueSoonTasks = useCallback(() => {
    const now = new Date();
    const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    return tasks.filter(t =>
      (t.status === "open" || t.status === "in_progress") &&
      new Date(t.dueDate) >= now && new Date(t.dueDate) <= soon
    );
  }, [tasks]);

  const value = useMemo(() => ({
    tasks, addTask, updateTask, deleteTask, closeTask, reviewTask,
    addComment, toggleQualityCriteria, getTasksForUser, getOverdueTasks, getDueSoonTasks,
  }), [tasks, addTask, updateTask, deleteTask, closeTask, reviewTask, addComment, toggleQualityCriteria, getTasksForUser, getOverdueTasks, getDueSoonTasks]);

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
};
