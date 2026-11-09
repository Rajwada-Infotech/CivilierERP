// Amendments to approved documents (backend/routes/docAmendments.js). An amendment is a proposed new version of an
// approved document with a reason; it waits for approval ("Amendment" in Approval Setup / the Approval Inbox) and,
// once approved, is applied — the document and its chain (a PO's GRNs, their ledger postings) update.
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type AmendableDocType = "purchase-order" | "expense-booking" | "payment" | "received-payment" | "journal-voucher" | "fund-transfer" | "boq" | "work-order" | "work-done";
export type AmendmentStatus = "Draft" | "Pending" | "Approved" | "Rejected";

export interface CascadeEntry {
  docType: "grn" | "vehicle-in-out" | string;
  id: number;
  docNo: string;
  status: string;
  /** null for a document that carries no value of its own (a Vehicle In/Out reads the PO's rates). */
  oldValue: number | null;
  newValue: number | null;
}

export interface AmendmentPreview {
  blockers: string[];
  cascade: CascadeEntry[];
  oldValue: number;
  newValue: number;
  docNo: string;
}

export interface DocAmendment {
  id: number;
  docType: AmendableDocType;
  docId: number;
  docNo: string;
  module: string;
  status: AmendmentStatus;
  reason: string;
  oldValue: number | null;
  newValue: number | null;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  applyError: string | null;
  rejectionNote: string | null;
}

export interface DocAmendmentDetail extends DocAmendment {
  before: Record<string, unknown> | null;
  proposed: Record<string, unknown> | null;
  cascade: CascadeEntry[];
}

const BASE = "/api/doc-amendments";

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
}

export const previewAmendment = (docType: AmendableDocType, docId: string | number, proposed: unknown) =>
  fetchWithAuth(`${BASE}/preview/${docType}/${docId}`, { method: "POST", body: JSON.stringify({ proposed }) }).then((r) => handle<AmendmentPreview>(r));

export const raiseAmendment = (docType: AmendableDocType, docId: string | number, proposed: unknown, reason: string) =>
  fetchWithAuth(`${BASE}/${docType}/${docId}`, { method: "POST", body: JSON.stringify({ proposed, reason }) }).then((r) => handle<{ id: number; message: string }>(r));

export const listAmendments = (q: { module?: string; docType?: AmendableDocType; docId?: string | number } = {}) => {
  const qs = new URLSearchParams();
  if (q.module) qs.set("module", q.module);
  if (q.docType) qs.set("docType", q.docType);
  if (q.docId != null) qs.set("docId", String(q.docId));
  return fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`).then((r) => handle<DocAmendment[]>(r));
};

export const getAmendment = (id: number) => fetchWithAuth(`${BASE}/${id}`).then((r) => handle<DocAmendmentDetail>(r));

export const retryApplyAmendment = (id: number) =>
  fetchWithAuth(`${BASE}/${id}/apply`, { method: "PUT" }).then((r) => handle<{ message: string }>(r));
