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
}

export const getActivityAssignments = (limit = 300): Promise<ActivityAssignment[]> =>
  getJson(`/api/dependency-activity-assignment?limit=${limit}`, "Failed to load activities");

// ── One activity: the allocation, its checkpoints, and the actions on it ──────────────────────────

export interface RungCheckpoint {
  id?: number;
  fieldName: string;
  isChecked: boolean;
  /** Rework attempt: Quality Check rated this Poor last time and it isn't ticked again yet. */
  needsRework?: boolean;
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
