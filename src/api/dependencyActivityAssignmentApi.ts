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

export interface RungAssignmentDetail {
  rungId: number;
  activityId: number;
  candidateItems: CandidateItem[];
  assignment: {
    engineerIds: number[];
    startDate: string | null;
    days: number | null;
    endDate: string | null;
    labourSource: SourceType | null;
    materialSource: SourceType | null;
    labourContractorId: number | null;
    materialContractorId: number | null;
    description: string | null;
    remarks: string | null;
    materials: AssignmentMaterial[];
    checkpoints: AssignmentCheckpoint[];
  } | null;
}

export interface RungAssignmentPayload {
  engineerIds: number[];
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
  // Set automatically the moment an engineer is assigned (POST /:rungId) —
  // waiting on that engineer's own confirmation in the Approval Inbox, not
  // something anyone picks from this dropdown by hand. Moves to IN_PROGRESS
  // by itself once every assigned engineer has confirmed.
  ALLOCATED: { label: "Allocated", className: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  IN_PROGRESS: { label: "In Progress", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  HOLD: { label: "Hold", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  CANCELLED: { label: "Cancelled", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  APPROVED: { label: "Approved", className: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  REWORK: { label: "Rework", className: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

// A rung only moves forward: once it has left Pending/Allocated (i.e. it's
// been approved into In Progress, or gone on to any later state) it can
// never go back to either of them, and while In Progress the only manual
// moves are Hold or Cancelled. Mirrored server-side in
// dependencyActivityAssignment.js's status route — keep the two in sync.
export function allowedNextStatuses(current: AssignmentStatus): AssignmentStatus[] {
  if (current === "PENDING" || current === "ALLOCATED") return [...ASSIGNMENT_STATUSES];
  if (current === "IN_PROGRESS") return ["IN_PROGRESS", "HOLD", "CANCELLED"];
  if (current === "HOLD") return ["HOLD", "IN_PROGRESS", "CANCELLED"];
  return ASSIGNMENT_STATUSES.filter((s) => s !== "PENDING" && s !== "ALLOCATED");
}

export interface ReportedAssignment {
  assignmentId: number;
  rungId: number;
  engineerNames: string | null;
  startDate: string | null;
  days: number | null;
  endDate: string | null;
  labourSource: SourceType | null;
  materialSource: SourceType | null;
  description: string | null;
  remarks: string | null;
  status: AssignmentStatus;
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

export const getReportedAssignments = async (dependencyMasterId?: number): Promise<ReportedAssignment[]> => {
  const url = dependencyMasterId ? `${BASE}?dependencyMasterId=${dependencyMasterId}` : BASE;
  const res = await fetchWithAuth(url);
  return handleResponse<ReportedAssignment[]>(res);
};

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

// Status and Remarks share one PATCH endpoint but are independent — the
// Activity Detail modal's status dropdown and its Remarks textarea (saved
// on blur) each call this with only the field that actually changed.
export const updateAssignmentDetail = async (
  rungId: number,
  patch: { status?: AssignmentStatus; remarks?: string },
): Promise<{ success: boolean; status: AssignmentStatus | null; remarks: string | null }> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return handleResponse<{ success: boolean; status: AssignmentStatus | null; remarks: string | null }>(res);
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

export const getActivityPhotos = async (rungId: number): Promise<ActivityPhotos> => {
  const res = await fetchWithAuth(`${BASE}/${rungId}/photos`);
  return handleResponse<ActivityPhotos>(res);
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
export interface QcCheckInput {
  checkpointId: number;
  passed: boolean;
  note?: string;
}

export interface QcHistoryEntry {
  id: number;
  decision: "APPROVED" | "REWORK";
  remarks: string | null;
  qcAt: string;
  qcBy: string | null;
  checks: { fieldName: string; passed: boolean; note: string | null }[];
}

export const getInProgressAssignments = async (): Promise<ReportedAssignment[]> => {
  const res = await fetchWithAuth(`${BASE}?status=IN_PROGRESS`);
  return handleResponse<ReportedAssignment[]>(res);
};

export const getQcHistory = async (rungId: number): Promise<QcHistoryEntry[]> => {
  const res = await fetchWithAuth(`${BASE}/qc/${rungId}/history`);
  return handleResponse<QcHistoryEntry[]>(res);
};

export const submitQcDecision = async (
  rungId: number,
  payload: { decision: "APPROVED" | "REWORK"; remarks?: string; checks: QcCheckInput[] },
): Promise<{ success: boolean; status: AssignmentStatus }> => {
  const res = await fetchWithAuth(`${BASE}/qc/${rungId}/decision`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; status: AssignmentStatus }>(res);
};
