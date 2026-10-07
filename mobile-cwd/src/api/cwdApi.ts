// RN client for the Civil Work DPR module. Same backend routes the web app's
// src/pages/civilworkdpr/** uses — no backend changes:
//   GET /api/civilworkdpr-dashboard             overview counts + 14-day trend
//   GET /api/dependency-activity-assignment     every allocated activity (current attempt)
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

export type AssignmentStatus =
  | "PENDING"
  | "ALLOCATED"
  | "IN_PROGRESS"
  | "HOLD"
  | "CANCELLED"
  | "APPROVED"
  | "REWORK"
  | "COMPLETED";

export interface CwdDashboard {
  activities: { totalCount: number; activeCount: number };
  allocations: { totalCount: number; projectCount: number; workerCount: number; todayCount: number; newCount: number };
  labour: { skilledToday: number; unskilledToday: number; totalToday: number; crewsToday: number };
  assignedWork: {
    totalCount: number;
    todayCount: number;
    pendingCount: number;
    inProgressCount: number;
    completedCount: number;
    holdCount: number;
    cancelledCount: number;
    approvedCount: number;
    reworkCount: number;
  };
  assignmentTimeline: { date: string; assigned: number; completed: number }[];
  asOf: string;
  /** The live picture: only each activity's current attempt. */
  current: { total: number; byStatus: Partial<Record<AssignmentStatus, number>>; active: number; completionRate: number };
  insights: {
    overdue: number;
    dueSoon: number;
    avgProgress: number | null;
    doneThisWeek: number;
    doneLastWeek: number;
    awaitingQc: number;
    awaitingApproval: number;
  };
  projects: { name: string; total: number; done: number; inProgress: number; overdue: number; avgProgress: number }[];
  overdueList: {
    rungId: number;
    activityName: string | null;
    projectName: string | null;
    scopePath: string | null;
    status: AssignmentStatus;
    endDate: string | null;
    daysOverdue: number;
    progressPercent: number;
    engineerNames: string | null;
  }[];
  engineerLoad: { name: string; active: number; overdue: number }[];
}

export const getCwdDashboard = (): Promise<CwdDashboard> =>
  getJson("/api/civilworkdpr-dashboard", "Failed to load the dashboard");

export interface ActivityAssignment {
  assignmentId: number;
  rungId: number;
  sequenceNo: number | null;
  activityName: string | null;
  status: AssignmentStatus;
  /** Set when an activity was put back In Progress after a hold ("Resumed"). */
  resumedAt?: string | null;
  progressPercent: number | null;
  attemptNo: number | null;
  projectName: string | null;
  scopePath: string | null;
  engineerNames: string | null;
  startDate: string | null;
  days: number | null;
  endDate: string | null;
  labourSourceName?: string | null;
  updatedAt: string | null;
  /** The dependency chain this activity sits in. */
  dependencyMasterId?: number;
  alias?: string | null;
  workType?: "INTERNAL" | "EXTERNAL" | string;
  projectId?: number | null;
  roomName?: string | null;
  /** Latest Quality Check decision, if any. */
  qcStatus?: "APPROVED" | "REWORK" | null;
  qcNames?: string | null;
}

export interface ActivityQuery {
  /** A status, or "OVERDUE" / "DUE_SOON" (the dashboard's definitions) or "QC_PENDING" (Completed, not yet
   *  passed by Quality Check) — filtered on the server. */
  filter?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** One page of activities, newest first. Filtering and searching happen on the server, so the phone
 *  only ever downloads the slice it is showing. */
export const getActivityAssignments = ({ filter = "ALL", search = "", page = 1, limit = 25 }: ActivityQuery = {}): Promise<ActivityAssignment[]> => {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filter === "OVERDUE") qs.set("overdue", "1");
  else if (filter === "DUE_SOON") qs.set("dueSoon", "1");
  else if (filter === "QC_PENDING") { qs.set("status", "COMPLETED"); qs.set("qcPending", "1"); }
  else if (filter !== "ALL") qs.set("status", filter);
  if (search.trim()) qs.set("search", search.trim());
  return getJson(`/api/dependency-activity-assignment?${qs}`, "Failed to load activities");
};

/** Exactly one activity's row (current attempt) — for the detail screen, so it never loads the whole list. */
export const getActivityAssignment = async (rungId: number): Promise<ActivityAssignment | null> =>
  (await getJson<ActivityAssignment[]>(`/api/dependency-activity-assignment?rungId=${rungId}&limit=1`, "Failed to load the activity"))[0] ?? null;

// ── One activity: the allocation, its checkpoints, and the actions on it ──────────────────────────

export interface RungCheckpoint {
  id?: number;
  fieldName: string;
  isChecked: boolean;
  /** Rework attempt: Quality Check rated this Poor last time and it isn't ticked again yet. */
  needsRework?: boolean;
  checkpointId?: number | null;
  sortOrder?: number;
  /** Can't be ticked until this many days after the start date. */
  minWaitDays?: number | null;
  /** Flagged "daily" in Work Checkpoint Master: one photo update per day. */
  isDaily?: boolean;
  updateCount?: number;
}

export interface RungDetail {
  rungId: number;
  daysOfCompletion?: number | null;
  candidateItems: { itemId: string; itemName: string; uom: string | null }[];
  assignment: {
    engineerIds: number[];
    qcUserIds: number[];
    startDate: string | null;
    days: number | null;
    endDate: string | null;
    labourSource: string | null;
    materialSource: string | null;
    labourSourceName?: string | null;
    materialSourceName?: string | null;
    labourContractorId?: number | null;
    materialContractorId?: number | null;
    approvalLevels?: unknown[];
    description: string | null;
    remarks: string | null;
    materials: { itemId: string; quantity: number }[];
    checkpoints: RungCheckpoint[];
    qcStatus?: { decision: "APPROVED" | "REWORK"; qcBy: string | null } | null;
  } | null;
}

export const getRungDetail = (rungId: number): Promise<RungDetail> =>
  getJson(`/api/dependency-activity-assignment/${rungId}`, "Failed to load the activity");

export interface ProgressLogEntry {
  id: number;
  fromProgressPercent: number | null;
  toProgressPercent: number | null;
  remarks: string | null;
  loggedBy: string | null;
  loggedAt: string;
}

export const getProgressLog = (rungId: number): Promise<ProgressLogEntry[]> =>
  getJson(`/api/dependency-activity-assignment/${rungId}/progress-log`, "Failed to load the update log");

async function send<T>(method: string, url: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

/** Status, remarks and progress share one endpoint; send only what changed. `append` makes a remark a new entry. */
export const updateAssignment = (
  rungId: number,
  patch: { status?: AssignmentStatus; remarks?: string; append?: boolean; progressPercent?: number },
) => send("PATCH", `/api/dependency-activity-assignment/${rungId}/status`, patch, "Failed to save");

export type QcRating = "POOR" | "GOOD" | "EXCELLENT";

export const submitQcDecision = (
  rungId: number,
  payload: { decision: "APPROVED" | "REWORK"; remarks?: string; checks: { checkpointId: number; rating: QcRating; note?: string }[] },
) => send("POST", `/api/dependency-activity-assignment/qc/${rungId}/decision`, payload, "Failed to submit the Quality Check");

// ── "Complete within N days" — same rule as the web app (calendar days, start date = day 1, holds stay on the clock) ──
const MS_DAY = 86_400_000;
const utc = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
export function timelineMessage(a: Pick<ActivityAssignment, "startDate" | "days" | "endDate" | "status">, now = new Date()): string | null {
  if (a.status !== "IN_PROGRESS" || !a.startDate) return null;
  const total = a.days && a.days > 0 ? a.days : a.endDate ? Math.round((utc(a.endDate) - utc(a.startDate)) / MS_DAY) + 1 : null;
  if (total == null) return null;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const dayNo = Math.round((utc(today) - utc(a.startDate)) / MS_DAY) + 1;
  if (dayNo < 1) return null;
  const left = total - dayNo;
  if (left > 1) return `Complete within ${left} days`;
  if (left === 1) return "Complete within 1 day";
  if (left === 0) return "Due today";
  return `${-left} day${left === -1 ? "" : "s"} overdue`;
}

// ── Work Reporting: the Project > Block > Floor > Unit > Room tree ───────────────────────────────

export interface ScopeRoom {
  projectId: number;
  projectName: string | null;
  towerId: number;
  towerName: string | null;
  floor: string;
  flatId: number;
  flatName: string | null;
  roomId: number | null;
  roomName: string | null;
  activityCount: number;
}
export interface ScopeSummary {
  statusCounts: Partial<Record<AssignmentStatus, number>>;
  total: number;
  rooms: ScopeRoom[];
}

/** Status-tile counts and one row per room (with its activity count) — two cheap GROUP BYs on the server;
 *  the activities themselves load per room, on demand. */
export const getScopeSummary = ({ status, search, projectId }: { status?: string; search?: string; projectId?: number } = {}): Promise<ScopeSummary> => {
  const qs = new URLSearchParams();
  if (projectId) qs.set("projectId", String(projectId));
  if (status && status !== "ALL") qs.set("status", status);
  if (search) qs.set("search", search);
  return getJson(`/api/dependency-activity-assignment/scope-summary?${qs}`, "Failed to load work reporting");
};

export const getScopeProjects = (): Promise<{ id: number; name: string | null }[]> =>
  getJson("/api/dependency-activity-assignment/scope-summary/projects", "Failed to load projects");

/** The activities inside one room (roomId null = the "No room" bucket of that project). */
export const getRoomActivities = ({ roomId, projectId, status }: { roomId: number | null; projectId: number; status?: string }): Promise<ActivityAssignment[]> => {
  const qs = new URLSearchParams({ roomId: roomId === null ? "null" : String(roomId), projectId: String(projectId), limit: "300" });
  if (status && status !== "ALL") qs.set("status", status);
  return getJson(`/api/dependency-activity-assignment?${qs}`, "Failed to load the room's activities");
};

// ── Checkpoints: tick, and the daily photo updates ───────────────────────────────────────────────

/** Ticking is saved through the allocation endpoint, which replaces the whole assignment — so everything
 *  that was loaded is sent back unchanged with only the checkpoints altered. */
export const saveCheckpoints = (rungId: number, a: NonNullable<RungDetail["assignment"]>, checkpoints: RungCheckpoint[]) =>
  send("POST", `/api/dependency-activity-assignment/${rungId}`, {
    engineerIds: a.engineerIds,
    qcUserIds: a.qcUserIds,
    approvalLevels: a.approvalLevels ?? [],
    startDate: a.startDate,
    days: a.days,
    endDate: a.endDate,
    labourSource: a.labourSource,
    materialSource: a.materialSource,
    labourContractorId: a.labourContractorId,
    materialContractorId: a.materialContractorId,
    description: a.description,
    remarks: a.remarks,
    materials: a.materials,
    checkpoints,
  }, "Failed to save the checkpoint");

export interface CheckpointUpdate {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  hasPhoto: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const getCheckpointUpdates = (checkpointId: number): Promise<CheckpointUpdate[]> =>
  getJson(`/api/dependency-activity-assignment/checkpoint/${checkpointId}/updates`, "Failed to load the updates");

async function upload<T>(url: string, form: FormData, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

/** A picked/captured image as a multipart part (React Native's file-by-uri form). */
const filePart = (uri: string, name: string, type = "image/jpeg") => ({ uri, name, type }) as unknown as Blob;

/** Log (or replace) the update for one date. */
export const saveCheckpointUpdate = (checkpointId: number, input: { date: string; photoUri?: string; note?: string }) => {
  const form = new FormData();
  form.append("date", input.date);
  if (input.note) form.append("note", input.note);
  if (input.photoUri) form.append("photo", filePart(input.photoUri, `checkpoint-${input.date}.jpg`));
  return upload<{ success: boolean; id: number; replaced: boolean }>(`/api/dependency-activity-assignment/checkpoint/${checkpointId}/updates`, form, "Failed to save the update");
};

export const deleteCheckpointUpdate = (id: number) =>
  send("DELETE", `/api/dependency-activity-assignment/checkpoint-update/${id}`, undefined, "Failed to remove the update");

// ── Photos (Before / After) ─────────────────────────────────────────────────────────────────────

export type PhotoPhase = "before" | "after";
export interface ActivityPhotoMeta {
  id: number;
  phase: PhotoPhase;
  fileName: string;
  mimeType: string;
  note: string | null;
  capturedBy: string | null;
  capturedAt: string;
  logDate: string | null;
}
export interface ActivityPhotos { before: ActivityPhotoMeta[]; after: ActivityPhotoMeta[] }

export const CARRIED_FORWARD_NOTE = "Carried forward from previous After";

export const getActivityPhotos = (rungId: number, date?: string): Promise<ActivityPhotos> =>
  getJson(`/api/dependency-activity-assignment/${rungId}/photos${date ? `?date=${date}` : ""}`, "Failed to load photos");

/** Day 1's After photos become day 2's Before (server-side, idempotent). */
export const carryForwardPhotos = (rungId: number) =>
  send<{ carried: number }>("POST", `/api/dependency-activity-assignment/${rungId}/photos/carry-forward`, {}, "Failed to carry photos forward");

export const getActivityPhoto = (rungId: number, photoId: number): Promise<{ fileName: string; mimeType: string; dataBase64: string }> =>
  getJson(`/api/dependency-activity-assignment/${rungId}/photos/${photoId}`, "Failed to load the photo");

export const uploadActivityPhoto = (rungId: number, phase: PhotoPhase, uri: string, note?: string) => {
  const form = new FormData();
  form.append("file", filePart(uri, `${phase}-${Date.now()}.jpg`));
  form.append("phase", phase);
  if (note) form.append("note", note);
  return upload<{ id: number }>(`/api/dependency-activity-assignment/${rungId}/photos`, form, "Upload failed");
};

export const deleteActivityPhoto = (rungId: number, photoId: number) =>
  send("DELETE", `/api/dependency-activity-assignment/${rungId}/photos/${photoId}`, undefined, "Failed to delete the photo");

// ── Daily log, history ───────────────────────────────────────────────────────────────────────────

export interface DailyLogEntry {
  id: number;
  logDate: string;
  progressPercent: number | null;
  remarks: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  photoCount: number;
}
export const getDailyLog = (rungId: number): Promise<DailyLogEntry[]> =>
  getJson(`/api/dependency-activity-assignment/${rungId}/daily-log`, "Failed to load the daily log");
export const deleteDailyLogEntry = (rungId: number, logId: number) =>
  send("DELETE", `/api/dependency-activity-assignment/${rungId}/daily-log/${logId}`, undefined, "Failed to delete the entry");

export interface AssignmentAttempt {
  assignmentId: number;
  attemptNo: number;
  isCurrent: boolean;
  status: AssignmentStatus;
  startDate: string | null;
  endDate: string | null;
  reworkReason: string | null;
  reworkSource: "QC" | "APPROVAL" | null;
  engineerNames: string | null;
}
export const getAssignmentAttempts = (rungId: number): Promise<AssignmentAttempt[]> =>
  getJson(`/api/dependency-activity-assignment/${rungId}/attempts`, "Failed to load the history");

// ── Attendance ───────────────────────────────────────────────────────────────────────────────────

export type AttendanceStatus = "P" | "A" | "H";
export interface AttendanceRow {
  workerId: number;
  workerName: string;
  skillType: string;
  contractorName: string | null;
  status: AttendanceStatus | null;
}
export interface WorkerResult { id: number; name: string; skillType: string; contractorName: string | null }

export const getAttendance = (rungId: number, date: string): Promise<AttendanceRow[]> =>
  getJson(`/api/worker-attendance/attendance?rungId=${rungId}&date=${date}`, "Failed to load attendance");
export const saveAttendance = (rungId: number, date: string, entries: { workerId: number; status: AttendanceStatus }[]) =>
  send("POST", "/api/worker-attendance/attendance", { rungId, date, entries }, "Failed to save attendance");
export const removeFromRoster = (rungId: number, workerId: number) =>
  send("DELETE", `/api/worker-attendance/roster/${rungId}/${workerId}`, undefined, "Failed to remove the worker");
export const addToRoster = (rungId: number, workerIds: number[]) =>
  send("POST", `/api/worker-attendance/roster/${rungId}`, { workerIds }, "Failed to add workers");
export const searchWorkers = (search: string): Promise<WorkerResult[]> =>
  getJson(`/api/worker-attendance/workers${search ? `?search=${encodeURIComponent(search)}` : ""}`, "Failed to search workers");

// ── Comments ─────────────────────────────────────────────────────────────────────────────────────

export interface ActivityComment {
  id: number | null;
  clientId: string | null;
  authorUserId: number;
  authorName: string;
  body: string;
  createdAt: string;
}
/** The newest page, or (with afterId) everything newer than that id. Polled — the phone doesn't hold a socket. */
export const getComments = (rungId: number, afterId?: number): Promise<{ messages: ActivityComment[]; hasMore: boolean }> =>
  getJson(`/api/activity-comments/${rungId}${afterId ? `?afterId=${afterId}` : ""}`, "Failed to load comments");
export const postComment = (rungId: number, body: string, clientId: string) =>
  send<{ message: ActivityComment }>("POST", `/api/activity-comments/${rungId}`, { body, clientId }, "Failed to send");

// ── Quality Check history ────────────────────────────────────────────────────────────────────────

export interface QcHistoryEntry {
  id: number;
  decision: "APPROVED" | "REWORK";
  remarks: string | null;
  qcAt: string;
  qcBy: string | null;
  checks: { fieldName: string; passed: boolean; rating: QcRating | null; note: string | null }[];
}
export const getQcHistory = (rungId: number): Promise<QcHistoryEntry[]> =>
  getJson(`/api/dependency-activity-assignment/qc/${rungId}/history`, "Failed to load the Quality Check history");

// ── Work Allocation ──────────────────────────────────────────────────────────────────────────────

export interface Person { id: number; name: string }
export interface Contractor { id: number; name: string }
export interface ApprovalLevel { id: string; label: string; userIds: number[]; mode: "all" | "any" }
export type SourceType = "CONTRACTOR" | "DEVELOPER";

export const getEngineers = (): Promise<Person[]> =>
  getJson("/api/dependency-activity-assignment/engineers", "Failed to load people");
export const getProjectContractors = (projectId: number): Promise<Contractor[]> =>
  getJson(`/api/dependency-activity-assignment/contractors?projectId=${projectId}`, "Failed to load contractors");

export interface AllocationPayload {
  engineerIds: number[];
  qcUserIds: number[];
  approvalLevels: ApprovalLevel[];
  startDate: string | null;
  days: number | null;
  endDate: string | null;
  labourSource: SourceType | null;
  materialSource: SourceType | null;
  labourContractorId: number | null;
  materialContractorId: number | null;
  description: string | null;
  remarks: string | null;
  materials: { itemId: string; quantity: number }[];
  checkpoints: RungCheckpoint[];
}
export const saveAllocation = (rungId: number, payload: AllocationPayload) =>
  send("POST", `/api/dependency-activity-assignment/${rungId}`, payload, "Failed to save the allocation");

// ── Dependency Management: chains, project by project ───────────────────────────────────────────

export interface DependencyChain {
  id: number;
  alias: string;
  workType: "INTERNAL" | "EXTERNAL" | string;
  projectId: number;
  projectName: string | null;
  scopePath: string;
  activityCount: number;
}

/** One project's chains, paged; the activities of a chain load separately when it is opened. */
export const getDependencyChains = ({ projectId, search, page = 1, limit = 30 }: { projectId: number; search?: string; page?: number; limit?: number }): Promise<DependencyChain[]> => {
  const qs = new URLSearchParams({ projectId: String(projectId), page: String(page), limit: String(limit), withActivities: "0" });
  if (search) qs.set("search", search);
  return getJson(`/api/dependency-master?${qs}`, "Failed to load dependency chains");
};

/** Every activity of one chain, with its current status. */
export const getChainActivities = (dependencyMasterId: number): Promise<ActivityAssignment[]> =>
  getJson(`/api/dependency-activity-assignment?dependencyMasterId=${dependencyMasterId}&limit=300`, "Failed to load the chain's activities");

// ── Work Transfer ────────────────────────────────────────────────────────────────────────────────

export interface TransferCandidate {
  assignmentId: number;
  rungId: number;
  status: AssignmentStatus;
  progressPercent: number;
  startDate: string | null;
  endDate: string | null;
  activityName: string;
  projectId: number;
  projectName: string | null;
  scopePath: string;
  engineerNames: string | null;
}

export interface TransferPage {
  rows: TransferCandidate[];
  total: number;
  /** Counts across ALL of the engineer's transferable work (ignores the project/search filter). */
  projects: { id: number; name: string | null; count: number }[];
}

/** One page of the activities an engineer still holds (Allocated / In Progress / Hold / Rework) — finished work can't move. */
export const getTransferCandidates = ({ engineerId, page, limit = 40, projectId, search }: { engineerId: number; page: number; limit?: number; projectId?: number | null; search?: string }): Promise<TransferPage> => {
  const qs = new URLSearchParams({ engineerId: String(engineerId), page: String(page), limit: String(limit) });
  if (projectId) qs.set("projectId", String(projectId));
  if (search) qs.set("search", search);
  return getJson(`/api/dependency-activity-assignment/transfer/candidates?${qs}`, "Failed to load the engineer's activities");
};

/** Every id matching the current filter, for "Select all" (the list only holds the pages loaded so far). */
export const getTransferCandidateIds = async ({ engineerId, projectId, search }: { engineerId: number; projectId?: number | null; search?: string }): Promise<number[]> => {
  const qs = new URLSearchParams({ engineerId: String(engineerId) });
  if (projectId) qs.set("projectId", String(projectId));
  if (search) qs.set("search", search);
  return (await getJson<{ ids: number[] }>(`/api/dependency-activity-assignment/transfer/candidates/ids?${qs}`, "Failed to select all")).ids;
};

export const transferWork = (payload: { fromEngineerId: number; toEngineerId: number; assignmentIds: number[]; remarks?: string }) =>
  send<{ success: boolean; transferred: number }>("POST", "/api/dependency-activity-assignment/transfer", payload, "Transfer failed");

// ── Profile ──────────────────────────────────────────────────────────────────────────────────────

export interface MyProfile { id: number; name: string; email: string; roleName: string | null; created_datetime: string | null }
export const getMyProfile = (userId: string | number): Promise<MyProfile> =>
  getJson(`/api/user-profile/${userId}/profile`, "Failed to load your profile");
export const changeMyPassword = (userId: string | number, current_password: string, new_password: string) =>
  send("POST", `/api/user-profile/${userId}/change-password`, { current_password, new_password }, "Failed to change the password");
