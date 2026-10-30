import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Land Management pipeline (backend/routes/legal/landPipeline.js): one workflow per Land ID.
const BASE = "/api/legal/land";

export type StepStatus = "Not Started" | "In Progress" | "Pending Verification" | "Completed" | "Correction Required" | "Skipped";

export interface PipelineStep {
  stepNo: number;
  code: string;
  name: string;
  phase: number;
  skippable: boolean;
  status: StepStatus;
  remarks: string | null;
  skipReason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  responsible: string | null;
  /** The step's screen exists in this build (later steps come phase by phase). */
  live: boolean;
  /** An earlier step is still open. */
  locked: boolean;
  /** What the step still needs before it can be Completed. */
  missing: string[];
}

export interface LandPipeline {
  land: {
    LandId: number; LandCode: string; LandName: string; DistrictName: string | null; MouzaId: number | null; MouzaName: string | null;
    JLNo: string | null; Area: number | null; UnitName: string | null; LandStatus: string; WorkflowStatus: string | null;
    IsOnHold: boolean; IsActive: boolean; EnquiryNo: string | null;
  };
  hold: { HoldCategory: string; HoldReason: string; HoldDate: string; ExpectedReviewDate: string | null; HeldByName: string | null } | null;
  steps: PipelineStep[];
  counts: { parties: number; owners: number; rs: number; lr: number; recordsVerified: number; ownershipRecords: number; docsRequired: number; docsDone: number };
  warnings: string[];
  progress: number;
  holdCategories: string[];
}

export interface LandStats {
  totalLands: number; activeEnquiries: number; inProgress: number; onHold: number; pendingVerification: number; completed: number;
  recent: { LandId: number; LandCode: string; LandName: string; WorkflowStatus: string | null; IsOnHold: boolean; MouzaName: string | null; JLNo: string | null }[];
}

export interface AuditEvent {
  EventId: number; Action: string; EntityType: string; EntityId: number | null; OldValue: string | null; NewValue: string | null;
  Remarks: string | null; CreatedAt: string; UserName: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getLandStats = async () => handle<LandStats>(await fetchWithAuth(`${BASE}/stats`));
export const getLandPipeline = async (id: number) => handle<LandPipeline>(await fetchWithAuth(`${BASE}/${id}`));
export const getLandAudit = async (id: number) => handle<AuditEvent[]>(await fetchWithAuth(`${BASE}/${id}/audit`));
export const moveLandStep = async (id: number, code: string, body: { status: StepStatus; remarks?: string; skipReason?: string }) =>
  handle<{ message: string; reverify: string[] }>(await fetchWithAuth(`${BASE}/${id}/steps/${code}`, post(body)));
export const holdLand = async (id: number, body: { category: string; reason: string; expectedReviewDate?: string; remarks?: string }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/hold`, post(body)));
export const resumeLand = async (id: number, remarks: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/resume`, post({ remarks })));
export const convertEnquiry = async (id: number, landName?: string) =>
  handle<{ landId: number; landCode: string; message: string }>(await fetchWithAuth(`${BASE}/enquiries/${id}/convert`, post({ landName })));
