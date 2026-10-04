// Follow-Up module API — thin wrappers over the web backend's task routes
// (backend/routes/taskMaster.js, taskTransfer.js, taskPerformanceReport.js,
// entryTypeDocFollowUpReport.js). Screens layer react-query on top.
import { fetchWithAuth } from "@/services/fetchWithAuth";

export const PRIORITIES = ["Very Important", "Important", "Normal"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type TaskStatus = "Active" | "Hold" | "Cancel" | "Closed";

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

export interface TaskDetail extends Task {
  AssignedTo: number | null;
  HasChildren?: boolean;
  CancelReasonLabel?: string | null;
  ReminderAt?: string | null;
}

export interface AssignableUser {
  id: number;
  name: string;
}

export interface FollowUp {
  Id: number;
  TaskId: number;
  Note: string;
  NextReminderAt: string | null;
  CreatedAt: string;
  CreatedByName: string | null;
  IsDone: boolean | number;
  DoneAt: string | null;
  DoneByName: string | null;
}

export interface ChatMessage {
  Id: number;
  Message: string;
  CreatedAt: string;
  SenderId: number | null;
  SenderName: string | null;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error || `HTTP ${res.status}`);
  return data as T;
}

async function send<T = { message?: string }>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string; message?: string }).error || (data as { message?: string }).message || `HTTP ${res.status}`);
  }
  return data as T;
}

// ── Task boards ──────────────────────────────────────────────────────────────
/** Every task (privileged) — GET /api/task-master */
export const getTasks = () => getJson<Task[]>("/api/task-master");

/** Active/Hold tasks with a due date, scoped to the caller unless privileged. */
export const getFollowUpBoard = () => getJson<Task[]>("/api/task-master/followup-board");

/** Completed tasks — GET /api/task-master/closed-board */
export const getClosedBoard = () => getJson<Task[]>("/api/task-master/closed-board");

/** Cancelled tasks — GET /api/task-master/cancelled-board */
export const getCancelledBoard = () => getJson<Task[]>("/api/task-master/cancelled-board");

/** {id, name} list for assignee pickers — GET /api/task-master/assignable-users */
export const getAssignableUsers = () => getJson<AssignableUser[]>("/api/task-master/assignable-users");

// ── Single task ──────────────────────────────────────────────────────────────
export const getTask = (id: number) => getJson<TaskDetail>(`/api/task-master/${id}`);

export interface NewTask {
  Subject: string;
  Details?: string;
  Department?: string;
  DueDate?: string;
  Priority: Priority;
  AssignedTo?: number;
}

export const createTask = (body: NewTask) => send<{ Id?: number; message?: string }>("POST", "/api/task-master", body);

export const setTaskProgress = (id: number, Progress: number) =>
  send<{ message: string; Progress: number; Status: string }>("PATCH", `/api/task-master/${id}/progress`, { Progress });

export const setTaskStatus = (id: number, Status: TaskStatus, CancelReasonId?: number) =>
  send("PATCH", `/api/task-master/${id}/status`, { Status, CancelReasonId });

export const setTaskPriority = (id: number, Priority: Priority) =>
  send("PATCH", `/api/task-master/${id}/priority`, { Priority });

// ── Follow-ups & chat ────────────────────────────────────────────────────────
export const getFollowUps = (taskId: number) => getJson<FollowUp[]>(`/api/task-master/${taskId}/followups`);

export const addFollowUp = (taskId: number, Note: string, NextReminderAt?: string) =>
  send("POST", `/api/task-master/${taskId}/followups`, { Note, NextReminderAt: NextReminderAt || undefined });

export const markFollowUpDone = (taskId: number, followUpId: number) =>
  send("PATCH", `/api/task-master/${taskId}/followups/${followUpId}/done`);

export const getChat = (taskId: number) => getJson<ChatMessage[]>(`/api/task-master/${taskId}/chat`);

export const sendChat = (taskId: number, Message: string) =>
  send("POST", `/api/task-master/${taskId}/chat`, { Message });

// ── Task Transfer ────────────────────────────────────────────────────────────
export const getTransferUsers = () => getJson<AssignableUser[]>("/api/task-transfer/users");

/** Open (Active/Hold) tasks currently assigned to `userId`. */
export const getTransferableTasks = (userId: number) => getJson<Task[]>(`/api/task-transfer/tasks?userId=${userId}`);

export interface TransferHistoryRow {
  Id: number;
  TaskNo: string;
  TaskSubject: string;
  FromUserName: string | null;
  ToUserName: string | null;
  TransferredByName: string | null;
  TransferredAt: string;
  Notes: string | null;
}

export const getTransferHistory = () => getJson<TransferHistoryRow[]>("/api/task-transfer/history");

export const transferTasks = (body: { TaskIds: number[]; FromUserId: number; ToUserId: number; Notes?: string }) =>
  send("POST", "/api/task-transfer", body);

// ── Reports ──────────────────────────────────────────────────────────────────
export interface PerformanceRow {
  Id: number;
  TaskNo: string;
  Subject: string;
  FollowerName: string | null;
  CreatedByName: string | null;
  ProjectName: string | null;
  Status: string;
  Priority: string | null;
  TaskDueDate: string | null;
  CompletionDayCount: number | null;
  DelayDays: number | null;
  FollowUpAttendCount: number;
  Progress: number | null;
  EffectiveProgress?: number | null;
  Tags: { Id: number; Name: string }[];
}

/** Also feeds the Tag Performance report (grouped by tag on the client). */
export const getTaskPerformanceReport = () => getJson<PerformanceRow[]>("/api/task-performance-report");

export interface EntryTypeDocRow {
  FollowUpId: number;
  FollowUpDate: string;
  FollowUpUserName: string | null;
  TaskId: number;
  DocumentId: string;
  Subject: string;
  TaskStatus: string;
  EntryTypeLabel: string | null;
  DocumentLabel: string | null;
  ProjectName: string | null;
  FollowUpAttendCount: number;
}

export const getEntryTypeDocReport = () => getJson<EntryTypeDocRow[]>("/api/entry-type-doc-followup-report");

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
