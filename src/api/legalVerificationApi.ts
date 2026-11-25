import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Legal Verification workspace (Legal V2): one workspace per land enquiry with its verification activities.
const BASE = "/api/legal/verification";

/** An API error that keeps the server's extra fields (e.g. needsOverride / blockedBy on a dependency refusal). */
export class VerificationError extends Error {
  data: Record<string, unknown>;
  constructor(message: string, data: Record<string, unknown>) { super(message); this.data = data; }
}
async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new VerificationError(data?.error || `HTTP ${res.status}`, data ?? {});
  return data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface VerificationSummary {
  VerificationId: number; VerificationNo: string; EnquiryId: number; ProjectId: number | null; ProjectName: string | null; Status: string;
  StartDate: string; TargetDate: string | null; LeadUserId: number | null; LeadName: string | null; Remarks: string | null; UpdatedAt: string | null;
  EnquiryNo: string; LandLocation: string | null; JLNo: string | null; ApproxArea: number | null; UnitName: string | null;
  ContactPerson: string | null; ContactNumber: string | null; MouzaName: string | null; DistrictName: string | null;
  Total: number; Completed: number; NotApplicable: number; OnHold: number; Discrepancies: number; MissingDocuments: number; Overdue: number;
}
export interface ActivityDoc { DocId: number; FileId: number; FileName: string | null; Title: string | null; UploadedBy: string | null; UploadedAt: string }
export interface Activity {
  ActivityId: number; VerificationId: number; TemplateId: number; ActivityNo: number; ActivityName: string; IsMandatory: boolean;
  Status: string; Finding: string | null; AssignedUserId: number | null; AssignedName: string | null; Department: string | null; Priority: string;
  ExpectedDays: number | null; StartDate: string | null; DueDate: string | null; CompletedDate: string | null;
  Findings: string | null; Remarks: string | null; HoldReason: string | null; NextAction: string | null;
  ReviewedByName: string | null; ReviewedAt: string | null; UpdatedAt: string | null; UpdatedByName: string | null; Stage: string; Description: string | null;
  ActivityCode: string; EntryCount: number;
  dependsOn?: { DependsOnId: number; ActivityNo: number; ActivityName: string; Status: string; IsMandatory: boolean }[];
  blocked?: boolean; overdue?: boolean; documents?: ActivityDoc[];
  VerificationNo?: string; EnquiryNo?: string;
}
export interface Workspace extends VerificationSummary {
  rs: { RsKhatianNo: string; RsDagNo: string }[]; lr: { LrKhatianNo: string; LrDagNo: string }[];
  activities: Activity[]; canOverride: boolean;
}
export interface HistoryRow {
  HistoryId: number; Action: string; OldStatus: string | null; NewStatus: string | null; OldFinding: string | null; NewFinding: string | null;
  OldAssignee: string | null; NewAssignee: string | null; Remarks: string | null; FileId: number | null; FileName: string | null; ChangedBy: string | null; ChangedAt: string;
}

export const getVerificationMeta = async () => handle<{ statuses: string[]; findings: string[]; priorities: string[] }>(await fetchWithAuth(`${BASE}/meta`));
export const getVerifications = async (qs = "") => handle<{ items: VerificationSummary[]; total?: number; page?: number; pageSize?: number }>(await fetchWithAuth(`${BASE}/list${qs ? `?${qs}` : ""}`));
export const getStartableEnquiries = async () =>
  handle<{ EnquiryId: number; EnquiryNo: string; LandLocation: string | null; EnquiryStatus: string; ProjectName: string | null; MouzaName: string | null }[]>(await fetchWithAuth(`${BASE}/startable`));
export const startVerification = async (body: { enquiryId: number; targetDate?: string; leadUserId?: number | null }) =>
  handle<{ message: string; verificationId: number }>(await fetchWithAuth(`${BASE}/start`, json("POST", body)));
export const getWorkspace = async (id: number) => handle<Workspace>(await fetchWithAuth(`${BASE}/${id}`));
export const updateWorkspace = async (id: number, body: { targetDate?: string | null; leadUserId?: number | null; remarks?: string | null }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}`, json("PUT", body)));
export const updateActivity = async (activityId: number, body: Record<string, unknown>) =>
  handle<{ message: string; workspaceStatus: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}`, json("PUT", body)));
export const addActivityDocument = async (activityId: number, body: { fileId: number; title?: string }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/document`, json("POST", body)));
export const getActivityHistory = async (activityId: number) => handle<HistoryRow[]>(await fetchWithAuth(`${BASE}/activity/${activityId}/history`));
export const getMyTasks = async () => handle<Activity[]>(await fetchWithAuth(`${BASE}/my-tasks`));

// ── Detail entries (phase 2) ─────────────────────────────────────────────────────────────────────
export interface EntryField {
  key: string; label: string; type: "text" | "textarea" | "int" | "decimal" | "date" | "select" | "file" | "entry";
  required?: boolean; max?: number; min?: number; options?: string[]; requireWhen?: { field: string; values: string[] };
}
export interface EntryConfig { entry: string; plural: string; note: string | null; fields: EntryField[]; columns: string[] }
export interface ActivityEntry {
  EntryId: number; ActivityId: number; data: Record<string, string | number | null>; files: Record<string, string | null>;
  CreatedAt: string; CreatedByName: string | null; UpdatedAt: string | null; UpdatedByName: string | null;
}
export const getEntryConfig = async () => handle<Record<string, EntryConfig>>(await fetchWithAuth(`${BASE}/entry-config`));
export const getActivityEntries = async (activityId: number) => handle<ActivityEntry[]>(await fetchWithAuth(`${BASE}/activity/${activityId}/entries`));
export const addActivityEntry = async (activityId: number, data: Record<string, unknown>) =>
  handle<{ message: string; entryId: number }>(await fetchWithAuth(`${BASE}/activity/${activityId}/entries`, json("POST", { data })));
export const updateActivityEntry = async (entryId: number, data: Record<string, unknown>, updatedAt: string | null) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/entry/${entryId}`, json("PUT", { data, updatedAt })));
export const removeActivityEntry = async (entryId: number, reason: string, updatedAt: string | null) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/entry/${entryId}`, json("DELETE", { reason, updatedAt })));
