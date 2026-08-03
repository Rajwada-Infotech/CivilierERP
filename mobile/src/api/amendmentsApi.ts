// RN port of src/api/amendmentsApi.ts (backed by src/pages/material/
// AmendmentMenu.tsx — the sidebar-linked page; a second, unlinked/orphaned
// implementation, src/pages/material/Amendments.tsx, hits the same API
// with a flatter layout and isn't ported here). Amendment is a generic,
// loosely-typed change-request LOG, not a mechanism that actually edits
// the source document: RefDocType is free text with no FK/validation
// against real PO/GRN/etc. tables, and approving an amendment never writes
// back to the source document — no supersede, no GL/stock re-posting, it's
// purely an audit-trail record sitting alongside the original. Scoped to
// PO + GRN as the two source doc types (both already fully ported to
// mobile with list APIs to reuse for the picker) — Expense Booking is a
// third tab on web but has no mobile screen/API yet, so it's left out
// until that exists, same reasoning as purchaseOrdersApi.ts's own
// Quotation/WO/WD-prefill scope note.
//
// Dropped: the AmendmentLineChanges field-diff sub-system (GET/POST
// /:id/line-changes) — built server-side but never called by any web page,
// so there's nothing to mirror; the only "diff" anywhere in the app is the
// single OriginalValue→RevisedValue money comparison. Also dropped the
// dead PropagatedAt/PropagatedBy columns (referenced only in a migration
// comment, never read/written by any route).
//
// Approval here is NOT the generic ApprovalStatusChain workflow — it's a
// private Draft→Pending→Approved/Rejected state machine gated by a fixed
// APPROVER_ROLES list (admin/director/manager), checked against the
// current user's role directly. "Amendments" is correctly absent from
// mobile's ApprovalTable union (mobile/src/components/ApprovalStatusChain.tsx)
// and should stay that way — it doesn't participate in that system at all.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/amendments";

export const APPROVER_ROLES = ["admin", "director", "manager"];

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export type AmendmentStatus = "Draft" | "Pending" | "Approved" | "Rejected";

export interface Amendment {
  Id: number;
  AmendmentNo: string;
  RefDocType: string | null;
  RefDocId: number | null;
  RefDocNo: string | null;
  ProjectName: string | null;
  CompanyName: string | null;
  Description: string | null;
  Reason: string | null;
  AmendmentDate: string | null;
  OriginalValue: number | null;
  RevisedValue: number | null;
  ValueDifference: number | null;
  Status: AmendmentStatus;
  ApprovedBy: string | null;
  ApprovedAt: string | null;
  RejectedBy: string | null;
  RejectedAt: string | null;
  RejectionNote: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface AmendmentPayload {
  RefDocType?: string;
  RefDocId?: number;
  RefDocNo?: string;
  ProjectName?: string;
  CompanyName?: string;
  Description?: string;
  Reason?: string;
  AmendmentDate?: string;
  OriginalValue?: number;
  RevisedValue?: number;
}

export interface PaginatedAmendments {
  data: Amendment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export const getAmendments = async (query: { page?: number; pageSize?: number; search?: string; status?: string; refDocType?: string } = {}): Promise<PaginatedAmendments> => {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch amendments"));
  return res.json().catch(() => ({ data: [], pagination: { page: 1, pageSize: 15, total: 0, totalPages: 1 } }));
};

export const getAmendment = async (id: number | string): Promise<Amendment> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch amendment"));
  return res.json().catch(() => ({}));
};

export const createAmendment = async (payload: AmendmentPayload) => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create amendment"));
  return res.json().catch(() => ({}));
};

export const updateAmendment = async (id: number | string, payload: AmendmentPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update amendment"));
  return res.json().catch(() => ({}));
};

export const submitAmendment = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/submit`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to submit amendment"));
  return res.json().catch(() => ({}));
};

export const approveAmendment = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to approve amendment"));
  return res.json().catch(() => ({}));
};

export const rejectAmendment = async (id: number | string, note: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to reject amendment"));
  return res.json().catch(() => ({}));
};

export const deleteAmendment = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete amendment"));
  return res.json().catch(() => ({}));
};

export const AMENDMENT_REASONS = [
  "Data Entry Error",
  "Vendor/Supplier Correction",
  "Quantity Revision",
  "Rate Revision",
  "Date Correction",
  "Tax Rate Correction",
  "Description Update",
  "Status Correction",
  "Management Instruction",
  "Other",
];

export const STATUS_COLOR: Record<string, string> = {
  Draft: "#64748b",
  Pending: "#d97706",
  Approved: "#059669",
  Rejected: "#e11d48",
};

export const DOC_TYPE_LABEL: Record<string, string> = {
  PurchaseOrder: "Purchase Order",
  GRN: "GRN",
};
