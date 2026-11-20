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
export interface FlowSnapshot { land: Row; rsRecords: Row[]; lrRecords: Row[]; owners: Row[]; documents: Row[]; clearances: Row[]; mutations: Row[] }
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
