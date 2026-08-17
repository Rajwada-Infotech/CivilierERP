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

export interface RungAssignmentDetail {
  rungId: number;
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
  "IN_PROGRESS",
  "HOLD",
  "CANCELLED",
  "APPROVED",
  "REWORK",
  "COMPLETED",
] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

// Shared with Work Reporting's inline "saved flow" view, so a status reads
// the same badge color wherever it's shown — purely presentational, no
// bearing on the order rows can move through.
export const ASSIGNMENT_STATUS_META: Record<AssignmentStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  IN_PROGRESS: { label: "In Progress", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  HOLD: { label: "Hold", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  CANCELLED: { label: "Cancelled", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  APPROVED: { label: "Approved", className: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  REWORK: { label: "Rework", className: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400" },
  COMPLETED: { label: "Completed", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
};

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
  scopePath: string;
  materials: { name: string; quantity: number; uom: string | null }[];
}

export const getReportedAssignments = async (dependencyMasterId?: number): Promise<ReportedAssignment[]> => {
  const url = dependencyMasterId ? `${BASE}?dependencyMasterId=${dependencyMasterId}` : BASE;
  const res = await fetchWithAuth(url);
  return handleResponse<ReportedAssignment[]>(res);
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
