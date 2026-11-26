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
  /** Completed = activities Verified by a verifier (V2.1). */
  Total: number; Completed: number; NotApplicable: number; OnHold: number; Discrepancies: number; MissingDocuments: number; Overdue: number;
  Rejected?: number; AwaitingVerification?: number; Returned?: number; AwaitingReports?: number; NaRequests?: number; LandId?: number | null; CreatedBy?: number | null;
}
export interface ActivityDoc { DocId: number; FileId: number; FileName: string | null; Title: string | null; DocNo?: string | null; CopyType?: string; VerifyStatus?: string; VersionNo?: number; UploadedBy: string | null; UploadedAt: string }
export interface Activity {
  ActivityId: number; VerificationId: number; TemplateId: number; ActivityNo: number; ActivityName: string; IsMandatory: boolean;
  Status: string; Finding: string | null; AssignedUserId: number | null; AssignedName: string | null; Department: string | null; Priority: string;
  ExpectedDays: number | null; StartDate: string | null; DueDate: string | null; CompletedDate: string | null;
  Findings: string | null; Remarks: string | null; HoldReason: string | null; NextAction: string | null;
  ReviewedByName: string | null; ReviewedAt: string | null; UpdatedAt: string | null; UpdatedByName: string | null; Stage: string; Description: string | null;
  ActivityCode: string; EntryCount: number;
  // V2.1
  ActivityRef: string; SortOrder: number | null; VerifyStatus: string; VerifierUserId: number | null; VerifierName: string | null; VerifyRemarks: string | null;
  SubmittedBy: number | null; SubmittedByName: string | null; SubmittedAt: string | null;
  NaReason: string | null; NaRequestedBy: number | null; NaRequestedByName: string | null; NaRequestedAt: string | null; NaApprovedByName: string | null; NaApprovedAt: string | null;
  GovSubmissionDate: string | null; AckDate: string | null; QueryDate: string | null; QueryResponseDate: string | null; HearingDate: string | null;
  ReportReceiptDate: string | null; OrderDate: string | null; PeriodFromYear: number | null; PeriodToYear: number | null; PeriodYears: number | null; Mine?: number;
  dependsOn?: { DependsOnId: number; ActivityNo: string; ActivityName: string; Status: string; VerifyStatus: string; IsMandatory: boolean }[];
  blocked?: boolean; overdue?: boolean; documents?: ActivityDoc[];
  VerificationNo?: string; EnquiryNo?: string;
}
export interface Workspace extends VerificationSummary {
  rs: { RsKhatianNo: string; RsDagNo: string }[]; lr: { LrKhatianNo: string; LrDagNo: string }[];
  activities: Activity[]; canOverride: boolean; canEdit?: boolean; searchOnly?: boolean; canVerify?: boolean; canReview?: boolean; me?: number;
}
export interface HistoryRow {
  HistoryId: number; Action: string; OldStatus: string | null; NewStatus: string | null; OldFinding: string | null; NewFinding: string | null;
  OldAssignee: string | null; NewAssignee: string | null; Remarks: string | null; FileId: number | null; FileName: string | null; ChangedBy: string | null; ChangedAt: string;
}

export const getVerificationMeta = async () => handle<{ statuses: string[]; workStatuses: string[]; verifyStatuses: string[]; findings: string[]; priorities: string[] }>(await fetchWithAuth(`${BASE}/meta`));
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
// V2.1 activity actions: submit for verification, the verifier's decision, N/A request / decision, reopen, comments.
export const submitActivity = async (activityId: number, body: { updatedAt?: string | null; overrideReason?: string; exceptionReason?: string; remarks?: string }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/submit`, json("POST", body)));
export const verifyActivity = async (activityId: number, body: { decision: "Verified" | "Returned" | "Rejected"; remarks?: string; updatedAt?: string | null }) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/verify`, json("POST", body)));
export const requestNa = async (activityId: number, reason: string, updatedAt?: string | null) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/na-request`, json("POST", { reason, updatedAt })));
export const decideNa = async (activityId: number, approve: boolean, remarks?: string, updatedAt?: string | null) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/na-decision`, json("POST", { approve, remarks, updatedAt })));
export const reopenActivity = async (activityId: number, reason: string, updatedAt?: string | null) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/reopen`, json("POST", { reason, updatedAt })));
export const getActivityComments = async (activityId: number) =>
  handle<{ CommentId: number; Comment: string; CreatedBy: string | null; CreatedAt: string }[]>(await fetchWithAuth(`${BASE}/activity/${activityId}/comments`));
export const addActivityComment = async (activityId: number, comment: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/comment`, json("POST", { comment })));

// Central documents (V2.1)
export interface VDoc {
  DocId: number; VerificationId: number; FileId: number; FileName: string | null; DocType: string; DocNo: string | null; DocDate: string | null; Authority: string | null;
  OwnerRef: string | null; DagRef: string | null; KhatianRef: string | null; CopyType: string; OriginalAvailable: string | null; OriginalHolder: string | null; Condition: string | null;
  VerifyStatus: string; VerifiedBy: string | null; VerifiedAt: string | null; RejectionReason: string | null; VersionNo: number; PreviousDocId: number | null; Remarks: string | null;
  IsActive: boolean; UploadedBy: string | null; UploadedById: number | null; UploadedAt: string; UpdatedAt: string | null;
  links: { LinkId: number; ActivityId: number | null; EntryId: number | null; ActivityRef: string | null; ActivityName: string | null }[];
}
export const getDocuments = async (verificationId: number, all = false) =>
  handle<{ documents: VDoc[]; docTypes: string[]; copyTypes: string[]; canVerify: boolean }>(await fetchWithAuth(`${BASE}/${verificationId}/documents${all ? "?all=1" : ""}`));
export const addDocument = async (verificationId: number, body: Record<string, unknown>) =>
  handle<{ message: string; docId: number }>(await fetchWithAuth(`${BASE}/${verificationId}/documents`, json("POST", body)));
export const updateDocument = async (docId: number, body: Record<string, unknown>) =>
  handle<{ message: string; docId: number }>(await fetchWithAuth(`${BASE}/documents/${docId}`, json("PUT", body)));
export const verifyDocument = async (docId: number, decision: "Verified" | "Rejected", reason?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/documents/${docId}/verify`, json("POST", { decision, reason })));
/** V2 name kept: attach a file to one activity as a central document. */
export const addActivityDocument = async (activityId: number, body: { fileId: number; title?: string; verificationId: number; docType?: string }) =>
  addDocument(body.verificationId, { fileId: body.fileId, docType: body.docType ?? "Other supporting document", remarks: body.title, activityIds: [activityId] });
export const getActivityHistory = async (activityId: number) => handle<HistoryRow[]>(await fetchWithAuth(`${BASE}/activity/${activityId}/history`));
/** Other Legal work assigned to me (deed drafting, post-registration tasks, mutation / conversion). */
export interface OtherTask { kind: string; key: string; title: string; detail: string; status: string; dueDate: string | null; path: string }
export const getMyTasks = async () => handle<{ activities: Activity[]; other: OtherTask[] }>(await fetchWithAuth(`${BASE}/my-tasks`));
export const saveAssignments = async (verificationId: number, items: { activityId: number; assignedUserId: number | null; verifierUserId: number | null; dueDate: string | null; updatedAt: string | null }[], handoverNote?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${verificationId}/assignments`, json("PUT", { items, handoverNote })));

// ── Detail entries (phase 2) ─────────────────────────────────────────────────────────────────────
export interface EntryField {
  key: string; label: string; type: "text" | "textarea" | "int" | "decimal" | "date" | "select" | "file" | "entry";
  required?: boolean; max?: number; min?: number; options?: string[]; requireWhen?: { field: string; values: string[] }; derived?: boolean;
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

// ── Ownership flowchart (phase 3) ────────────────────────────────────────────────────────────────
export interface FlowVersion { versionNo: number; HistoryId: number; remarks: string | null; savedBy: string | null; savedAt: string; entries: { EntryId: number; data: Record<string, string | number | null> }[] }
export const importDeedChain = async (activityId: number) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/import-deed-chain`, json("POST", {})));
export const getFlowVersions = async (activityId: number) => handle<FlowVersion[]>(await fetchWithAuth(`${BASE}/activity/${activityId}/flow-versions`));
export const saveFlowVersion = async (activityId: number, remarks: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/activity/${activityId}/flow-version`, json("POST", { remarks })));

// ── Legal review (phase 4) ───────────────────────────────────────────────────────────────────────
export type CheckStatus = "ok" | "issue" | "na" | null;
export interface ReviewRow {
  ReviewId: number; VersionNo: number; Decision: string; Remarks: string | null; Risks?: string | null; SnapshotHash: string | null; ReviewedBy: string | null; ReviewedAt: string;
  checklist: Record<string, { status: CheckStatus; note: string | null }>;
}
export const getReviews = async (id: number) =>
  handle<{ reviews: ReviewRow[]; checks: [string, string][]; decisions: string[]; canReview: boolean; unverifiedDocs: number;
    exceptions: { ExceptionId: number; Kind: string; ActivityRef: string | null; ActivityName: string | null; Reason: string; Remarks: string | null; Detail: string | null; CreatedBy: string | null; CreatedAt: string }[] }>(await fetchWithAuth(`${BASE}/${id}/reviews`));
export const submitReview = async (id: number, body: { decision: string; remarks: string; risks?: string; checklist: Record<string, { status: CheckStatus; note: string }> }) =>
  handle<{ message: string; versionNo: number; hash: string }>(await fetchWithAuth(`${BASE}/${id}/review`, json("POST", body)));
export const reopenVerification = async (id: number, reason: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/${id}/reopen`, json("POST", { reason })));
export const getVerificationByLand = async (landId: number) =>
  handle<(VerificationSummary & { lastReview: { VersionNo: number; Decision: string; Remarks: string | null; SnapshotHash: string | null; ReviewedBy: string | null; ReviewedAt: string } | null;
    issues: { ActivityNo: string; ActivityName: string; Status: string; VerifyStatus?: string; Finding: string | null }[] }) | null>(await fetchWithAuth(`${BASE}/by-land/${landId}`));

// ── Dashboard and reports (phase 5) ──────────────────────────────────────────────────────────────
const RBASE = "/api/legal/verification-reports";
export interface VerificationDashboard {
  enquiries: number; verifications: number; pendingVerification: number; inProgress: number; awaitingReports: number; awaitingVerification: number;
  returned: number; overdueActivities: number; onHoldActivities: number; finalReviewPending: number; verified: number; landApprovalPending: number;
  laUlcPending: number; pendingMutation: number; pendingConversion: number; discrepancies: number;
  byActivity: { no: string; name: string; open: number; overdue: number }[]; byEmployee: { name: string; open: number; overdue: number }[];
}
export interface LegalReport { key: string; title: string; subtitle?: string; note?: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[];
  /** Dropdown choices for the filters, from the report's own rows. */
  options?: Partial<Record<"enquiry" | "mouza" | "dag" | "employee" | "status" | "verify", string[]>> }
export const getVerificationDashboard = async (project: string) => handle<VerificationDashboard | null>(await fetchWithAuth(`${RBASE}/dashboard?project=${encodeURIComponent(project)}`));
export const getReportList = async () => handle<{ key: string; title: string; needsVerification: boolean }[]>(await fetchWithAuth(`${RBASE}/list`));
export const getReport = async (key: string, q: { project: string; from?: string; to?: string; verificationId?: number | null; enquiry?: string; mouza?: string; dag?: string; employee?: string; status?: string; verify?: string }) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])).toString();
  return handle<LegalReport>(await fetchWithAuth(`${RBASE}/${key}?${qs}`));
};
