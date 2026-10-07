import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dependency-activity-assignment";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface Engineer {
  id: number;
  name: string;
}

export interface CandidateItem {
  itemId: string;
  itemName: string;
  itemCode: string | null;
  uom: string | null;
}

export interface AssignmentMaterial {
  itemId: string;
  quantity: number;
}

// A rung can be staffed by more than one engineer, and either the labour or
// the material for it can come from the project's own crew/stock rather
// than a contractor's — SourceType captures that as a plain classification
// (no FK to a specific contractor), shown as a badge in the UI.
export const SOURCE_TYPES = ["CONTRACTOR", "DEVELOPER"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SOURCE_META: Record<SourceType, { label: string; className: string }> = {
  CONTRACTOR: { label: "Contractor", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  DEVELOPER: { label: "Developer", className: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

export interface Contractor {
  id: number;
  name: string;
}

// A checkpoint attached to an assignment — pulled in from Work Checkpoint
// Master's template for the rung's activity, then tracked per-assignment,
// milestone-style. checkpointId traces back to the master row (null if that
// row was later deleted); fieldName is snapshotted so a rename/removal
// there never rewrites what this specific rung was actually checked
// against.
export interface AssignmentCheckpoint {
  id?: number;
  checkpointId: number | null;
  fieldName: string;
  sortOrder?: number;
  isChecked: boolean;
  // Snapshotted off the master checkpoint (see migration 354) at the
  // moment it's attached to this rung — null means checkable any time.
  minWaitDays?: number | null;
  /** The master flags it "daily" (Work Checkpoint Master) — shows a calendar + live
   *  camera for one photo update per day. Snapshotted, decided by the server. */
  isDaily?: boolean;
  /** How many days already have an update logged (server-provided). */
  updateCount?: number;
  /** Rework attempt: Quality Check rated this one Poor last time and it isn't ticked again yet. */
  needsRework?: boolean;
}

export interface CheckpointUpdate {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  hasPhoto: boolean;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export const getCheckpointUpdates = async (checkpointId: number): Promise<CheckpointUpdate[]> => {
  const res = await fetchWithAuth(`${BASE}/checkpoint/${checkpointId}/updates`);
  return handleResponse<CheckpointUpdate[]>(res);
};

/** Log (or replace) the update for one date. */
export const saveCheckpointUpdate = async (
  checkpointId: number,
  input: { date: string; photo?: Blob; note?: string },
): Promise<{ success: boolean; id: number; replaced: boolean }> => {
  const form = new FormData();
  form.append("date", input.date);
  if (input.note) form.append("note", input.note);
  if (input.photo) form.append("photo", input.photo, `checkpoint-${input.date}.jpg`);
  const res = await fetchWithAuth(`${BASE}/checkpoint/${checkpointId}/updates`, { method: "POST", body: form });
  return handleResponse(res);
};

export const deleteCheckpointUpdate = async (id: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/checkpoint-update/${id}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};

/** The photo needs the auth header, so it's fetched as a blob and shown via an object URL. */
export const fetchCheckpointUpdatePhoto = async (id: number): Promise<string> => {
  const res = await fetchWithAuth(`${BASE}/checkpoint-update/${id}/photo`);
  if (!res.ok) throw new Error("Photo not available");
  return URL.createObjectURL(await res.blob());
};

// A per-assignment approval level — same shape as Approval Setup's own
// ApprovalLevel (src/pages/admin/ApprovalSetup.tsx), just scoped to this one
// activity assignment instead of a module-wide workflow. "all" levels are
// sequential steps (each must approve in turn); a level with mode "any"
// lets any ONE of its userIds approve to clear that step — the "one by one
// then either" case is a run of "all" levels ending in one "any" level.
export interface ApprovalLevel {
  id: string;
  label: string;
  userIds: number[];
  mode: "all" | "any";
}

export interface RungAssignmentDetail {
  rungId: number;
  activityId: number;
  /** The Activity Master's "Days of Completion" — the default for the allocation's Days. */
  daysOfCompletion?: number | null;
  candidateItems: CandidateItem[];
  assignment: {
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
    /** The company behind each source: the project's developer company, or the named contractor. */
    labourSourceName?: string | null;
    materialSourceName?: string | null;
    /** Latest Quality Check decision on this activity; null while none has been made. */
    qcStatus?: {
      decision: "APPROVED" | "REWORK";
      remarks: string | null;
      qcAt: string | null;
      qcBy: string | null;
      /** How each checkpoint was rated in that decision. */
      checks?: { fieldName: string; passed: boolean; rating: "POOR" | "GOOD" | "EXCELLENT" | null; note: string | null }[];
    } | null;
    description: string | null;
    remarks: string | null;
    materials: AssignmentMaterial[];
    checkpoints: AssignmentCheckpoint[];
  } | null;
}

export interface RungAssignmentPayload {
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
  checkpoints: AssignmentCheckpoint[];
  materials: AssignmentMaterial[];
}

export const getEngineers = async (): Promise<Engineer[]> => {
  const res = await fetchWithAuth(`${BASE}/engineers`);
  return handleResponse<Engineer[]>(res);
};

// Contractors already allocated to the given project (see
// ContractorAllocation), for the Labour/Material "Given By" pickers.
export const getProjectContractors = async (projectId: number): Promise<Contractor[]> => {
  const res = await fetchWithAuth(`${BASE}/contractors?projectId=${projectId}`);
  return handleResponse<Contractor[]>(res);
};

export const getRungAssignment = async (rungId: number): Promise<RungAssignmentDetail> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}`);
  return handleResponse<RungAssignmentDetail>(res);
};

export const saveRungAssignment = async (
  rungId: number,
  payload: RungAssignmentPayload,
): Promise<{ success: boolean; assignmentId: number }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; assignmentId: number }>(res);
};

// ─── Activity Reporting ─────────────────────────────────────────────────────
// Order between these carries no meaning — a row can move to any other
// status at any time. The set itself is fixed by the backend's CHECK
// constraint (see migration 334).
export const ASSIGNMENT_STATUSES = [
  "PENDING",
  "ALLOCATED",
  "IN_PROGRESS",
  "HOLD",
  "CANCELLED",
  "APPROVED",
  "REWORK",
  "COMPLETED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// Shared with Work Allocation's inline "saved flow" view, so a status reads
// the same badge color wherever it's shown — purely presentational, no
// bearing on the order rows can move through.
export const ASSIGNMENT_STATUS_META: Record<AssignmentStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  // Set automatically the moment an engineer is assigned (Work
  // Allocation) — the activity sits here until that engineer reports
  // progress for the first time, which is what actually flips it to
  // IN_PROGRESS (see dependencyActivityAssignment.js's PATCH
  // /:rungId/status autoStatus branch).
  ALLOCATED: { label: "Allocated", className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  IN_PROGRESS: { label: "In Progress", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  HOLD: { label: "Hold", className: "bg-[#ffe2021a] text-amber-600 dark:text-amber-400" },
  CANCELLED: { label: "Cancelled", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  APPROVED: { label: "Approved", className: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  REWORK: { label: "Rework", className: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

// The status dropdown is an In Progress <-> Hold toggle, plus Cancelled —
// which is reachable from any stage, including a terminal one (Completed/
// Approved), per explicit instruction. Completed is set automatically by
// dragging the progress bar to 100% (see ActivityDetailModal's
// ProgressDragBar); a QC decision can only ever land back on Completed
// ("QC Passed") or fork to Rework — Approved is reachable only from an
// explicit approval action afterwards (dependencyActivityAssignment.js's
// handleApproveLevel — a named approver, or a super_admin when no approval
// levels are configured), never automatically from QC passing on its own.
// Rework's one way out is manually re-opening it to In Progress to redo
// the work.
// A single-element result means "read-only badge, no dropdown" — see
// AssignmentStatusSelect (only Cancelled itself is truly terminal). Mirrored
// server-side in dependencyActivityAssignment.js's status route — keep the
// two in sync.
export function allowedNextStatuses(current: AssignmentStatus): AssignmentStatus[] {
  if (current === "CANCELLED") return ["CANCELLED"];
  if (current === "REWORK") return ["REWORK", "IN_PROGRESS", "CANCELLED"];
  if (current === "PENDING" || current === "ALLOCATED" || current === "IN_PROGRESS" || current === "HOLD") {
    return ["IN_PROGRESS", "HOLD", "CANCELLED"];
  }
  return [current, "CANCELLED"];
}

export interface ReportedAssignment {
  assignmentId: number;
  rungId: number;
  engineerNames: string | null;
  qcNames: string | null;
  startDate: string | null;
  days: number | null;
  endDate: string | null;
  // The date the assigned engineer actually reported progress for the
  // first time — set once and never overwritten (see
  // dependencyActivityAssignment.js's isFirstReport). StartDate is only
  // ever a tentative plan; (firstReportedAt - startDate) is the real delay
  // before work began. Null until that first report happens.
  firstReportedAt: string | null;
  /** When it was put back In Progress after a hold (null if it never was, or it is on hold again). */
  resumedAt?: string | null;
  labourSource: SourceType | null;
  materialSource: SourceType | null;
  /** The company behind the source: the project's developer company, or the named contractor. */
  labourSourceName?: string | null;
  materialSourceName?: string | null;
  description: string | null;
  remarks: string | null;
  status: AssignmentStatus;
  // What Status was right before this activity got Cancelled — only ever
  // non-null while status === "CANCELLED". Determines what restoring it
  // (super_admin only) puts it back to: APPROVED if that's genuinely what
  // it was, IN_PROGRESS otherwise.
  preCancelStatus: AssignmentStatus | null;
  progressPercent: number;
  // Latest QC decision, if this activity has ever been inspected — drives
  // the "QC Checked" badge shown everywhere this row appears, and (once
  // APPROVED) means it's no longer the Quality Check page's job, it's
  // awaiting the approval workflow or already finalized.
  qcStatus: "APPROVED" | "REWORK" | null;
  // Rework forks a brand-new attempt rather than mutating the rejected one
  // in place (see migration 488) — attemptNo counts which attempt this is,
  // and reworkFromAssignmentId/reworkReason/reworkSource describe why the
  // attempt before this one exists at all (both null on a first attempt).
  attemptNo: number;
  reworkFromAssignmentId: number | null;
  reworkReason: string | null;
  reworkSource: "QC" | "APPROVAL" | null;
  updatedAt: string;
  sequenceNo: number;
  activityId: number;
  activityName: string;
  dependencyMasterId: number;
  alias: string;
  workType: "INTERNAL" | "EXTERNAL";
  projectId: number;
  projectName: string | null;
  towerId: number;
  towerName: string | null;
  floor: string;
  flatId: number;
  flatName: string | null;
  roomId: number | null;
  roomName: string | null;
  scopePath: string;
  materials: { name: string; quantity: number; uom: string | null }[];
}

// roomId is the one that matters at production scale — scopes to a single
// room's activities (typically a handful) instead of ever fetching every
// IsCurrent activity in the system. See getActivityScopeSummary below for
// how Reporting now builds its location tree without needing this at all
// until a room is actually expanded.
export const getReportedAssignments = async (params?: {
  dependencyMasterId?: number;
  // A ScopeSummaryRoom's roomId is `null` for the "No room" bucket — pass
  // that through as-is (not just omitted) so the request scopes to rungs
  // with no room at all, instead of falling through to "every activity".
  roomId?: number | null;
  status?: AssignmentStatus;
}): Promise<ReportedAssignment[]> => {
  const qs = new URLSearchParams();
  if (params?.dependencyMasterId) qs.set("dependencyMasterId", String(params.dependencyMasterId));
  if (params && "roomId" in params && params.roomId !== undefined) {
    qs.set("roomId", params.roomId === null ? "null" : String(params.roomId));
  }
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();
  const res = await fetchWithAuth(query ? `${BASE}?${query}` : BASE);
  return handleResponse<ReportedAssignment[]>(res);
};

// ── Scope summary ────────────────────────────────────────────────────────
// Builds Reporting's Project > Tower > Floor > Unit > Room tree and its
// status-tile counts from cheap server-side GROUP BYs instead of fetching
// every activity in the system to count client-side — see the backend
// route's own comment for why that stopped being viable at production
// scale (342,000+ rows).
export interface ScopeSummaryRoom {
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
export interface ActivityScopeSummary {
  statusCounts: Partial<Record<AssignmentStatus, number>>;
  total: number;
  rooms: ScopeSummaryRoom[];
}
export const getActivityScopeSummary = async (params?: {
  status?: AssignmentStatus;
  search?: string;
  projectId?: number;
}): Promise<ActivityScopeSummary> => {
  const qs = new URLSearchParams();
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.status) qs.set("status", params.status);
  if (params?.search) qs.set("search", params.search);
  const query = qs.toString();
  const res = await fetchWithAuth(`${BASE}/scope-summary${query ? `?${query}` : ""}`);
  return handleResponse<ActivityScopeSummary>(res);
};

export const getScopeProjects = async (): Promise<{ id: number; name: string | null }[]> => {
  const res = await fetchWithAuth(`${BASE}/scope-summary/projects`);
  return handleResponse<{ id: number; name: string | null }[]>(res);
};

// StartDate is only ever a tentative plan — the real measure of how
// promptly work began is (firstReportedAt - startDate), the gap between
// the plan and the engineer's own first progress report. <= 0 reads as
// On time (started on or before the planned date); positive is that many
// days late. Null until there's actually been a first report. Shared by
// ActivityReporting.tsx's table and ActivityDetailModal's Overview tab.
export function startDelayInfo(
  startDate: string | null,
  firstReportedAt: string | null,
): { label: string; tone: "on-time" | "late" } | null {
  if (!startDate || !firstReportedAt) return null;
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00`);
  const first = new Date(`${firstReportedAt.slice(0, 10)}T00:00:00`);
  const diffDays = Math.round((first.getTime() - start.getTime()) / 86_400_000);
  return diffDays <= 0
    ? { label: "On time", tone: "on-time" }
    : { label: `${diffDays} day${diffDays === 1 ? "" : "s"} late`, tone: "late" };
}

// One assigned engineer confirming their own task — id is
// dbo.DependencyActivityEngineer.Id (from the Approval Inbox row's
// RecordId), not the assignment or rung id. Once every engineer on the
// assignment has confirmed, the backend moves the parent Status
// ALLOCATED -> IN_PROGRESS on its own.
export const confirmEngineerAssignment = async (
  id: number,
): Promise<{ success: boolean; allApproved: boolean; newStatus: AssignmentStatus | null }> => {
  const res = await fetchWithAuth(`${BASE}/engineer-approval/${id}/confirm`, { method: "PUT" });
  return handleResponse<{ success: boolean; allApproved: boolean; newStatus: AssignmentStatus | null }>(res);
};

export const updateAssignmentStatus = async (
  rungId: number,
  status: AssignmentStatus,
): Promise<{ success: boolean; status: AssignmentStatus }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  return handleResponse<{ success: boolean; status: AssignmentStatus }>(res);
};

// Status, Remarks and ProgressPercent share one PATCH endpoint but are
// independent — the Activity Detail modal's status dropdown, its Remarks
// textarea (saved on blur), and its draggable progress bar (saved on
// drag-release) each call this with only the field that actually changed.
export const updateAssignmentDetail = async (
  rungId: number,
  patch: { status?: AssignmentStatus; remarks?: string; progressPercent?: number; append?: boolean },
): Promise<{ success: boolean; status: AssignmentStatus | null; remarks: string | null; progressPercent: number | null }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handleResponse<{ success: boolean; status: AssignmentStatus | null; remarks: string | null; progressPercent: number | null }>(res);
};

// Work Reporting's audit trail — every past progress-bar/Remarks update on
// this rung, newest first, with who made it and when.
export interface ProgressLogEntry {
  id: number;
  fromProgressPercent: number | null;
  toProgressPercent: number | null;
  remarks: string | null;
  statusAfter: AssignmentStatus | null;
  loggedBy: string | null;
  loggedAt: string;
}

export const getProgressLog = async (rungId: number): Promise<ProgressLogEntry[]> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/progress-log`);
  return handleResponse<ProgressLogEntry[]>(res);
};

// The actual logbook — one permanent snapshot per day this activity was
// ever reported on (written by the PATCH /:rungId/status route's own
// MERGE, see its comment). Read-only here; a day's row is only ever
// written by that same day's own save.
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

export const getDailyLog = async (rungId: number): Promise<DailyLogEntry[]> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/daily-log`);
  return handleResponse<DailyLogEntry[]>(res);
};

export const deleteDailyLogEntry = async (rungId: number, logId: number) => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/daily-log/${logId}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};

// ── Blueprint Annotation Workflow ───────────────────────────────────────────
// Scoped per (rung, room, context) — see migration 345/346's own comments
// for why: two activities in the same chain sharing a room's blueprint
// (e.g. Fixture Installation and Electrical Wiring) each carry independent
// markup, AND within one activity, the Work Allocation layer ("allocation")
// and the field engineer's Work Reporting layer ("reporting") are two more
// independent, separately-versioned rows on that same (rung, room) —
// neither context can ever overwrite the other.
export type BlueprintAnnotationContext = "allocation" | "reporting";

export interface BlueprintAnnotation {
  shapesJson: string;
  thumbnailBase64: string | null;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const getBlueprintAnnotation = async (
  rungId: number,
  roomId: number,
  context: BlueprintAnnotationContext = "allocation",
): Promise<BlueprintAnnotation | null> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/blueprint-annotation?roomId=${roomId}&context=${context}`);
  return handleResponse<BlueprintAnnotation | null>(res);
};

export const saveBlueprintAnnotation = async (
  rungId: number,
  payload: {
    roomId: number;
    context: BlueprintAnnotationContext;
    shapesJson: string;
    thumbnail: string | null;
    version: number;
  },
): Promise<{ success: boolean; version: number }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/blueprint-annotation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; version: number }>(res);
};

// Every past revision plus the current one (migration 353), oldest first —
// thumbnail-only, since each is a pre-rendered PNG rather than shapes to
// re-drive a live Konva stage with. Powers the Activity Detail modal's
// Blueprint tab revision scrubber.
export interface BlueprintAnnotationRevision {
  version: number;
  thumbnailBase64: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const getBlueprintAnnotationHistory = async (
  rungId: number,
  roomId: number,
  context: BlueprintAnnotationContext = "allocation",
): Promise<BlueprintAnnotationRevision[]> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/blueprint-annotation/history?roomId=${roomId}&context=${context}`);
  return handleResponse<BlueprintAnnotationRevision[]>(res);
};

// ── Before/After Photo Capture ──────────────────────────────────────────────
// Replaces the reporting-context blueprint markup as how a field engineer
// actually updates a work report — see migration 348.
export type PhotoPhase = "before" | "after";

export interface ActivityPhotoMeta {
  id: number;
  phase: PhotoPhase;
  fileName: string;
  mimeType: string;
  note: string | null;
  capturedBy: string | null;
  capturedAt: string;
  /** The day this photo was taken for — see the Daily Log tab. Null on
   *  photos uploaded before that column existed. */
  logDate: string | null;
}

export interface ActivityPhotos {
  before: ActivityPhotoMeta[];
  after: ActivityPhotoMeta[];
}

export interface ActivityPhotoData {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

// `date` (YYYY-MM-DD) scopes to just that day's photos — used by the Daily
// Log tab to show one day's uploads; omit for the full "every photo ever
// taken for this activity" gallery every other caller already relies on.
export const getActivityPhotos = async (rungId: number, date?: string): Promise<ActivityPhotos> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos${date ? `?date=${date}` : ""}`);
  return handleResponse<ActivityPhotos>(res);
};

/** Day 1's After photos become day 2's Before (server-side, idempotent). Returns how many were added. */
export const carryForwardPhotos = async (rungId: number): Promise<{ carried: number }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos/carry-forward`, { method: "POST" });
  return handleResponse<{ carried: number }>(res);
};

export const getActivityPhoto = async (rungId: number, photoId: number): Promise<ActivityPhotoData> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos/${photoId}`);
  return handleResponse<ActivityPhotoData>(res);
};

export const uploadActivityPhoto = async (
  rungId: number,
  phase: PhotoPhase,
  file: File,
  note?: string,
): Promise<{ id: number }> => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("phase", phase);
  if (note) formData.append("note", note);
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos`, {
    method: "POST",
    body: formData,
  });
  return handleResponse<{ id: number }>(res);
};

export const deleteActivityPhoto = async (rungId: number, photoId: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos/${photoId}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};

// ── Quality Check ────────────────────────────────────────────────────────────
export type QcRating = "POOR" | "GOOD" | "EXCELLENT";

export interface QcCheckInput {
  checkpointId: number;
  rating: QcRating;
  note?: string;
}

export interface QcHistoryEntry {
  id: number;
  decision: "APPROVED" | "REWORK";
  remarks: string | null;
  qcAt: string;
  qcBy: string | null;
  checks: { fieldName: string; passed: boolean; rating: QcRating | null; note: string | null }[];
}

// Quality Check now inspects COMPLETED activities (work dragged to 100%),
// not IN_PROGRESS ones — an activity only reaches QC once it's actually
// done, not while it's still being worked on.
export const getCompletedAssignments = async (): Promise<ReportedAssignment[]> => {
  const res = await fetchWithAuth(`${BASE}?status=COMPLETED`);
  return handleResponse<ReportedAssignment[]>(res);
};

export const getQcHistory = async (rungId: number): Promise<QcHistoryEntry[]> => {
  const res = await fetchWithAuth(`${BASE}/qc/${rungId}/history`);
  return handleResponse<QcHistoryEntry[]>(res);
};

export interface QcDecisionResult {
  success: boolean;
  status: AssignmentStatus;
  awaitingApproval: boolean;
  // Set when decision is REWORK — the id of the brand-new attempt this
  // decision forked (see forkAssignmentForRework's own comment).
  reworkAssignmentId: number | null;
}
export const submitQcDecision = async (
  rungId: number,
  payload: { decision: "APPROVED" | "REWORK"; remarks?: string; checks: QcCheckInput[] },
): Promise<QcDecisionResult> => {
  const res = await fetchWithAuth(`${BASE}/qc/${rungId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return handleResponse<QcDecisionResult>(res);
};

// ── Approval workflow ───────────────────────────────────────────────────────
// Enforces the ApprovalLevel[] set on this same assignment (Work
// Allocation's mini Approval Setup, see saveRungAssignment) once QC has
// passed a Completed activity — kept as its own small state, not the
// module-wide Approval Setup/Approval Inbox (see ApprovalLevel's own
// comment above).
export interface ApprovalWorkflowLevel extends ApprovalLevel {
  satisfied: boolean;
  current: boolean;
}
export interface ApprovalWorkflowEntry {
  levelId: string;
  approverUserId: number;
  approverName: string | null;
  approvedAt: string;
}
export interface ApprovalWorkflowState {
  status: AssignmentStatus;
  levels: ApprovalWorkflowLevel[];
  approvals: ApprovalWorkflowEntry[];
  currentLevelIndex: number | null;
  canApprove: boolean;
}

export const getApprovalWorkflow = async (rungId: number): Promise<ApprovalWorkflowState> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/approval`);
  return handleResponse<ApprovalWorkflowState>(res);
};

export const approveWorkflowLevel = async (
  rungId: number,
): Promise<{ success: boolean; fullyApproved: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/approval/approve`, { method: "POST" });
  return handleResponse<{ success: boolean; fullyApproved: boolean }>(res);
};

// The other way a Completed, QC-passed activity gets sent back — an
// approver at the current level rejects it instead of clearing it.
// Requires a remark, and forks a brand-new attempt exactly like QC's own
// REWORK decision does (see forkAssignmentForRework's own comment).
export const rejectWorkflowLevel = async (
  rungId: number,
  remarks: string,
): Promise<{ success: boolean; reworkAssignmentId: number }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/approval/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remarks }),
  });
  return handleResponse<{ success: boolean; reworkAssignmentId: number }>(res);
};

// ── Rework history ───────────────────────────────────────────────────────
// Every assignment attempt ever made against a rung — the "keep the
// history of the reworked task" view (migration 488's own comment).
export interface AssignmentAttempt {
  assignmentId: number;
  attemptNo: number;
  isCurrent: boolean;
  status: AssignmentStatus;
  startDate: string | null;
  endDate: string | null;
  reworkFromAssignmentId: number | null;
  reworkReason: string | null;
  reworkSource: "QC" | "APPROVAL" | null;
  createdAt: string;
  updatedAt: string | null;
  engineerNames: string | null;
}
export const getAssignmentAttempts = async (rungId: number): Promise<AssignmentAttempt[]> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/attempts`);
  return handleResponse<AssignmentAttempt[]>(res);
};

// How many Completed, QC-passed activities are sitting at a level the
// current viewer can act on right now — powers the sidebar's Reporting
// badge (see AppSidebar.tsx's useCivilWorkDprApprovalCount).
export const getPendingApprovalCount = async (): Promise<number> => {
  const res = await fetchWithAuth(`${BASE}/approvals/pending-count`);
  const data = await handleResponse<{ count: number }>(res);
  return data.count ?? 0;
};

// ── Amendment log ────────────────────────────────────────────────────────
// Every superseded assignment attempt (IsCurrent = 0) — each one exists
// only because it was reworked (see migration 488), so this is already
// exactly "every reworked activity", across every chain, not scoped to
// one rung the way getAssignmentAttempts is.
export interface AmendmentRecord {
  assignmentId: number;
  rungId: number;
  attemptNo: number;
  status: AssignmentStatus;
  reworkReason: string | null;
  reworkSource: "QC" | "APPROVAL" | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: string;
  sequenceNo: number;
  activityName: string;
  dependencyMasterId: number;
  alias: string;
  workType: "INTERNAL" | "EXTERNAL";
  projectId: number;
  projectName: string | null;
  towerId: number;
  towerName: string | null;
  floor: string;
  flatId: number;
  flatName: string | null;
  roomId: number | null;
  roomName: string | null;
  scopePath: string;
  engineerNames: string | null;
  // The attempt that replaced this one — null only if the rung's current
  // attempt was somehow itself deleted (shouldn't normally happen).
  currentStatus: AssignmentStatus | null;
  currentAttemptNo: number | null;
}
export const getAmendments = async (): Promise<AmendmentRecord[]> => {
  const res = await fetchWithAuth(`${BASE}/amendments`);
  return handleResponse<AmendmentRecord[]>(res);
};

// Bringing a Cancelled activity back — super_admin only (enforced
// server-side by role, not a page right), and only after reviewing the
// activity's full detail in ActivityDetailModal, where this is called
// from. Restores to APPROVED if it genuinely was before being cancelled,
// otherwise IN_PROGRESS regardless of exactly where it was — see the
// backend route's own comment.
export const restoreCancelledActivity = async (
  rungId: number,
): Promise<{ success: boolean; status: AssignmentStatus }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/restore`, { method: "POST" });
  return handleResponse<{ success: boolean; status: AssignmentStatus }>(res);
};

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

export const getTransferCandidates = async (engineerId: number, projectId?: number): Promise<TransferCandidate[]> => {
  const qs = new URLSearchParams({ engineerId: String(engineerId) });
  if (projectId) qs.set("projectId", String(projectId));
  const res = await fetchWithAuth(`${BASE}/transfer/candidates?${qs.toString()}`);
  return handleResponse<TransferCandidate[]>(res);
};

export interface TransferCandidatePage {
  rows: TransferCandidate[];
  total: number;
  /** Counts across ALL of the engineer's transferable work (ignores the project/search filter). */
  projects: { id: number; name: string | null; count: number }[];
}

/** One page of an engineer's transferable activities, filtered and ordered on the server. */
export const getTransferCandidatesPage = async (params: {
  engineerId: number;
  page: number;
  limit?: number;
  projectId?: number;
  search?: string;
}): Promise<TransferCandidatePage> => {
  const qs = new URLSearchParams({ engineerId: String(params.engineerId), page: String(params.page), limit: String(params.limit ?? 50) });
  if (params.projectId) qs.set("projectId", String(params.projectId));
  if (params.search) qs.set("search", params.search);
  const res = await fetchWithAuth(`${BASE}/transfer/candidates?${qs.toString()}`);
  return handleResponse<TransferCandidatePage>(res);
};

/** Every id matching the current project/search filter, for "select all" (the page only holds some). */
export const getTransferCandidateIds = async (params: { engineerId: number; projectId?: number; search?: string }): Promise<number[]> => {
  const qs = new URLSearchParams({ engineerId: String(params.engineerId) });
  if (params.projectId) qs.set("projectId", String(params.projectId));
  if (params.search) qs.set("search", params.search);
  const res = await fetchWithAuth(`${BASE}/transfer/candidates/ids?${qs.toString()}`);
  return (await handleResponse<{ ids: number[] }>(res)).ids;
};

export const transferWork = async (payload: {
  fromEngineerId: number;
  toEngineerId: number;
  assignmentIds: number[];
  remarks?: string;
}): Promise<{ success: boolean; transferred: number }> => {
  const res = await fetchWithAuth(`${BASE}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; transferred: number }>(res);
};
