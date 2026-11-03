import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Land documents (backend/routes/legal/landDocuments.js): per-land documents with versions and reviews.
const BASE = "/api/legal/land-docs";

export type ReviewStatus = "Pending" | "Verified" | "Rejected" | "Reattachment Required";

export interface LandDocument {
  DocumentId: number; DocumentCode: string; DocTypeId: number; DocTypeName: string; RelatedSection: string; Title: string;
  DocumentNo: string | null; DocumentDate: string | null; IssuingAuthority: string | null; CurrentVersionNo: number; Remarks: string | null;
  VersionId: number; FileId: number; FileName: string; UploadedAt: string; UploadedByName: string | null;
  ReviewStatus: ReviewStatus; ReviewedAt: string | null; ReviewedByName: string | null; ReviewRemarks: string | null; Versions: number;
}
export interface RequiredDocument {
  docTypeId: number; docTypeName: string; requirement: "Required" | "Conditional" | "Optional"; stage: string; allowNA: boolean;
  instructions: string | null; naReason: string | null;
  state: "Missing" | "Not Applicable" | ReviewStatus;
}
export interface LandDocuments {
  documents: LandDocument[];
  required: { templateId: number | null; templateName: string | null; items: RequiredDocument[] };
  sections: string[];
}
export interface DocumentVersion {
  VersionId: number; VersionNo: number; FileId: number; FileName: string; UploadRemarks: string | null; UploadedAt: string;
  UploadedByName: string | null; ReviewStatus: ReviewStatus; ReviewedAt: string | null; ReviewedByName: string | null; ReviewRemarks: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getLandDocuments = async (landId: number) => handle<LandDocuments>(await fetchWithAuth(`${BASE}/${landId}`));
export const getDocumentVersions = async (docId: number) => handle<DocumentVersion[]>(await fetchWithAuth(`${BASE}/doc/${docId}/versions`));
export const addLandDocument = async (landId: number, body: { docTypeId: number; relatedSection: string; title: string; documentNo?: string; documentDate?: string; issuingAuthority?: string; remarks?: string; fileId: number }) =>
  handle<{ id: number; message: string }>(await fetchWithAuth(`${BASE}/${landId}`, send("POST", body)));
export const addDocumentVersion = async (docId: number, fileId: number, remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/doc/${docId}/versions`, send("POST", { fileId, remarks })));
export const reviewDocumentVersion = async (versionId: number, status: ReviewStatus, remarks?: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/version/${versionId}/review`, send("POST", { status, remarks })));
export const markDocumentNA = async (landId: number, docTypeId: number, reason: string) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/na`, send("POST", { docTypeId, reason })));
export const undoDocumentNA = async (landId: number, docTypeId: number) =>
  handle<{ message: string }>(await fetchWithAuth(`${BASE}/${landId}/na/${docTypeId}`, { method: "DELETE" }));
