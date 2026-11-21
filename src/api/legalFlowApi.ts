import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Legal Flow Chart (backend/routes/legal/landFlow.js): find a land by any number, see its whole flow and history.
const BASE = "/api/legal/flow";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || "Request failed");
  return body as T;
}

export interface FlowHit {
  LandId: number | null; EnquiryId: number | null; Matched: string; ProjectId: number | null;
  LandCode: string | null; LandName: string | null; WorkflowStatus: string | null;
  EnquiryNo: string | null; EnquiryStatus: string | null; EnquiryLocation: string | null; MouzaName: string | null;
}
export interface FlowStage { key: string; label: string; state: "done" | "current" | "pending" | "skipped"; date: string | null; note: string | null }
export interface FlowChange {
  EventId: number; Action: string; EntityType: string; EntityId: number | null; Remarks: string | null; CreatedAt: string; UserName: string | null;
  OldValue: unknown; NewValue: unknown;
  /** The starting record (enquiry as entered / land as registered), not a later change. */
  baseline?: boolean;
}
type Row = Record<string, unknown>;
export interface FlowEnquiry extends Row { rsRecords: Row[]; lrRecords: Row[]; deedSearches: Row[] }
export interface FlowLand {
  land: Row | null; enquiry: FlowEnquiry | null;
  rsRecords: Row[]; lrRecords: Row[]; owners: Row[]; transfers: Row[]; documents: Row[]; clearances: Row[]; mutations: Row[];
  stages: FlowStage[]; history: FlowChange[]; versions: FlowVersion[];
}
export interface FlowSnapshot { land: Row; rsRecords: Row[]; lrRecords: Row[]; owners: Row[]; documents: Row[]; clearances: Row[]; mutations: Row[];
  /** Entry sections saved at approval (Land Flowchart review), field by field. */
  entry?: { key: string; label: string; records: { master: string; title: string; id: number; fields: { n: string; l: string; v: string | null }[] }[] }[] }
/** One full cycle ending in approval (v1: enquiry → register → verification; later: change → re-verification). */
export interface FlowVersion {
  no: number; status: string; startedAt: string | null; approvedAt: string | null; approvedBy: string | null; approval: string | null;
  snapshot: FlowSnapshot | null; approxSnapshot: boolean; events: FlowChange[];
  flow: { label: string; state: FlowStage["state"]; date: string | null }[];
  /** A change approved (or asked for) after the land was registered — no re-registration. */
  afterRegistration?: boolean;
  /** Document files that came in with this version (new documents or new file versions). */
  uploads?: { DocumentCode: string; Title: string | null; DocTypeName: string | null; VersionNo: number; UploadedAt?: string; UploadedBy?: string | null; ReviewStatus?: string | null; FileName?: string | null; FileId?: number | null }[];
  /** The document checklist: saved at approval, or as it is now (checklistNow) for the open version / older records. */
  checklist?: { template: string | null; items: { doc: string; requirement: string; stage: string | null; state: string }[] } | null;
  checklistNow?: boolean;
  amendment?: { no: number; type: string; reason: string; referenceNo: string | null; remarks?: string; requestedBy: string | null;
    changes: { field?: string; op?: string; label: string; from: unknown; to: unknown }[]; pending?: boolean; id?: number } | null;
}

export const searchFlow = async (q: string) => handle<{ results: FlowHit[] }>(await fetchWithAuth(`${BASE}/search?q=${encodeURIComponent(q)}`));
export const getFlowLand = async (id: number) => handle<FlowLand>(await fetchWithAuth(`${BASE}/land/${id}`));
export const getFlowEnquiry = async (id: number) => handle<FlowLand>(await fetchWithAuth(`${BASE}/enquiry/${id}`));

/** One version as a summary PDF, or a ZIP with the PDF and every document file of that version. */
export const getVersionFile = async (landId: number, no: number, kind: "pdf" | "zip") => {
  const res = await fetchWithAuth(`${BASE}/land/${landId}/version/${no}/${kind}`);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Download failed");
  return res.blob();
};

/** Land review (Land Flowchart): the verifier ticks each step, submits; an Approver approves → the next version. */
export interface EntryField { n: string; l: string; v: string | null; req: boolean; file?: number }
export interface EntryRecord { master: string; title: string; id: number; fields: EntryField[] }
export interface ReviewStep {
  key: string; label: string; records: EntryRecord[]; previous: EntryRecord[] | null;
  /** An empty section: the fields it asks for. */
  template?: { title: string; fields: { l: string; req: boolean }[] }[];
  needed: boolean; filled: number; total: number; missingRequired: string[]; files: number;
  checklist?: { doc: string; requirement: string; stage: string | null; state: string }[];
  changed: boolean; checked: boolean; checkedBy: string | null; checkedAt: string | null; staleTick: boolean;
}
export interface LandReview {
  land: { LandId: number; LandCode: string; LandName: string; WorkflowStatus: string | null };
  versionNo: number; first: boolean; steps: ReviewStep[]; toCheck: number; ticked: number;
  status: "Draft" | "Verifying" | "Submitted" | "Up to date";
  registered?: boolean; amendment?: { AmendmentId: number; AmendmentNo: number; AmendType: string; Reason: string; Status: string } | null;
  review: { ReviewId: number; Status: string; SubmittedBy: number | null; SubmittedByName: string | null; SubmittedAt: string | null; Remarks: string | null; EntrySubmittedByName?: string | null; EntrySubmittedAt?: string | null } | null;
  returned: { Remarks: string | null; DecidedAt: string; DecidedByName: string | null } | null;
  canVerify: boolean; canApprove: boolean; userId: number | null;
}
export interface ReviewQueueRow { LandId: number; LandCode: string; LandName: string; ProjectId: number | null; WorkflowStatus: string | null; MouzaName: string | null; VersionNo: number; Since: string | null; ByName: string | null }
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getLandReview = async (id: number) => handle<LandReview>(await fetchWithAuth(`${BASE}/land/${id}/review`));
export const checkReviewStep = async (id: number, step: string, checked: boolean) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/land/${id}/review/check`, json("PUT", { step, checked })));
export const submitReview = async (id: number, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/land/${id}/review/submit`, json("POST", { remarks })));
export const decideReview = async (id: number, action: "Approve" | "Return", remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/land/${id}/review/decide`, json("POST", { action, remarks })));
export const getReviewQueue = async (qs: string) => handle<{ items: ReviewQueueRow[]; total?: number; page?: number; pageSize?: number; canVerify?: boolean; canApprove?: boolean }>(await fetchWithAuth(`${BASE}/reviews?${qs}`));
export const requestReview = async (id: number, remarks?: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/land/${id}/review/request`, json("POST", { remarks })));
export const returnReview = async (id: number, remarks: string) => handle<{ message: string }>(await fetchWithAuth(`${BASE}/land/${id}/review/return`, json("POST", { remarks })));
export interface FlowLandTab { LandId: number; LandCode: string; LandName: string; ProjectId: number | null; WorkflowStatus: string | null; RsKhatianNo: string | null; RsDagNo: string | null; LrKhatianNo: string | null; LrDagNo: string | null }
export const getFlowLands = async () => handle<{ lands: FlowLandTab[] }>(await fetchWithAuth(`${BASE}/lands`));
