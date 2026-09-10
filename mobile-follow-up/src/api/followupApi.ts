// Follow-Up module API — thin wrappers over the web backend's task routes
// (backend/routes/taskMaster.js, taskTransfer.js, taskPerformanceReport.js).
// Mirrors the shapes the web app's src/api/* helpers return; screens layer
// react-query on top.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export interface Task {
  Id: number;
  TaskNo: string;
  Subject: string;
  Details: string | null;
  Department: string | null;
  DueDate: string | null;
  Priority: string | null;
  Status: string;
  CaseNumber: string | null;
  CaseCompanyName: string | null;
  CaseProjectName: string | null;
  AssigneeName: string | null;
  CreatedByName: string | null;
  CreatedAt: string;
  ParentTaskNo: string | null;
  EffectiveProgress?: number | null;
  Progress?: number | null;
  NextFollowUpAt?: string | null;
}

export interface AssignableUser {
  id: number;
  name: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Every task (privileged) — GET /api/task-master */
export const getTasks = () => getJson<Task[]>("/api/task-master");

/** Active/Hold tasks with a due date, scoped to the caller unless privileged. */
export const getFollowUpBoard = () =>
  getJson<Task[]>("/api/task-master/followup-board");

/** Completed tasks — GET /api/task-master/closed-board */
export const getClosedBoard = () =>
  getJson<Task[]>("/api/task-master/closed-board");

/** Cancelled tasks — GET /api/task-master/cancelled-board */
export const getCancelledBoard = () =>
  getJson<Task[]>("/api/task-master/cancelled-board");

/** {id, name} list for assignee pickers — GET /api/task-master/assignable-users */
export const getAssignableUsers = () =>
  getJson<AssignableUser[]>("/api/task-master/assignable-users");

// ── Task Transfer ────────────────────────────────────────────────────────────
export const getTransferUsers = () =>
  getJson<AssignableUser[]>("/api/task-transfer/users");

export const getTransferableTasks = () =>
  getJson<Task[]>("/api/task-transfer/tasks");

export const getTransferHistory = () =>
  getJson<Record<string, unknown>[]>("/api/task-transfer/history");

export async function transferTasks(body: {
  taskIds: number[];
  toUserId: number;
  reason?: string;
}) {
  const res = await fetchWithAuth("/api/task-transfer", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Task Performance Report ──────────────────────────────────────────────────
export const getTaskPerformanceReport = (params?: Record<string, string>) =>
  getJson<Record<string, unknown>>(
    `/api/task-performance-report${
      params && Object.keys(params).length
        ? `?${new URLSearchParams(params).toString()}`
        : ""
    }`,
  );

// ── Setup masters ────────────────────────────────────────────────────────────
export interface MasterRow {
  Id: number;
  Name: string;
  IsActive: boolean | number;
}

/** GET /api/department-master → [{Id, DepartmentName, IsActive, …}] */
export const getDepartments = async (): Promise<MasterRow[]> =>
  (await getJson<Array<{ Id: number; DepartmentName: string; IsActive: boolean | number }>>(
    "/api/department-master",
  )).map((d) => ({ Id: d.Id, Name: d.DepartmentName, IsActive: d.IsActive }));

/** GET /api/tag-master → [{Id, Name, IsActive, …}] */
export const getTags = () => getJson<MasterRow[]>("/api/tag-master");

/** GET /api/cancel-template-master → [{Id, Reason, IsActive, …}] */
export const getCancelTemplates = async (): Promise<MasterRow[]> =>
  (await getJson<Array<{ Id: number; Reason: string; IsActive: boolean | number }>>(
    "/api/cancel-template-master",
  )).map((c) => ({ Id: c.Id, Name: c.Reason, IsActive: c.IsActive }));
