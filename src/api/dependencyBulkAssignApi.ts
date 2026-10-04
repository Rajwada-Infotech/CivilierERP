import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ApprovalLevel } from "./dependencyActivityAssignmentApi";

const BASE = "/api/dependency-bulk-assign";

export interface BulkAssignRequest {
  projectId: number;
  /** A block (tower) of the project; omit for every block. */
  towerId?: number | null;
  engineerIds: number[];
  qcUserIds: number[];
  approvalLevels: ApprovalLevel[];
}

interface FieldCounts {
  requested: boolean;
  /** Activities that are empty for this field and will receive it. */
  willFill: number;
  /** Activities that already have it and are left alone. */
  alreadySet: number;
}

export interface BulkAssignSummary {
  totalActivities: number;
  skippedCancelledOrApproved: number;
  eligible: number;
  willChange: number;
  engineers: FieldCounts;
  qc: FieldCounts;
  approval: FieldCounts;
}

export interface BulkAssignResult {
  applied: boolean;
  summary: BulkAssignSummary;
  changed?: { activities: number; engineers: number; qc: number; approval: number; created: number };
}

async function post(path: string, body: BulkAssignRequest): Promise<BulkAssignResult> {
  const res = await fetchWithAuth(`${BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Bulk assignment failed");
  return data as BulkAssignResult;
}

/** Counts only — writes nothing. */
export const previewBulkAssign = (body: BulkAssignRequest) => post("preview", body);
export const applyBulkAssign = (body: BulkAssignRequest) => post("apply", body);
