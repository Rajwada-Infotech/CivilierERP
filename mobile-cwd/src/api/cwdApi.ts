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
