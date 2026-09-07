// RN port of src/api/materialRequestApi.ts + the inline types/cart logic
// at the top of src/pages/material/MaterialRequest.tsx. Smallest of the
// four Material-module pages (~1,923 lines on web vs. Vehicle In/Out's
// ~2,800, GRN's ~3,900, PO's ~5,150) — no line-item rate/tax math, no
// multi-source prefill. Scope trim vs. web: the UOM item-alternates live
// cross-unit conversion display (the most complex bit of the web form) is
// dropped in favor of a plain UOM picker — matters for display polish, not
// correctness, since quantity/UOM are both stored as entered either way.
// CSV import (a stub on web too), print, and DocumentChainPanel also stay
// web-only. The MR→PO prefill endpoints (getApprovedMRList/getMRPOPrefill)
// already have a mobile port in purchaseOrdersApi.ts (consumed by
// PurchaseOrderFormModal.tsx) — not duplicated here.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch { /* keep status message */ }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

const BASE = "/api/material-requests";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MRLineItem {
  ItemId: string;
  ItemName?: string;
  UOMCode: string;
  Quantity: number;
  Remarks?: string;
}

export interface MaterialRequest {
  MRId: number;
  DocNo?: string;
  Status: string;
  Priority: string;
  RequestDate: string;
  RequiredByDate?: string;
  Reason: string;
  Remarks?: string;
  CompanyId?: number;
  ProjectId?: number;
  FinYearId?: number;
  CompanyName?: string;
  ProjectName?: string;
  FinYearName?: string;
  ItemCount?: number;
  TotalQty?: number;
  CreatedAt?: string;
  items?: MRLineItem[];
}

export interface MRListResponse {
  data: MaterialRequest[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateMRPayload {
  CompanyId: number | null;
  ProjectId: number | null;
  FinYearId: number | null;
  RequestDate: string;
  RequiredByDate: string | null;
  Priority: string;
  Reason: string;
  Remarks: string | null;
  DocTypeId: number | null;
  items: MRLineItem[];
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export const getMaterialRequests = (query: { page?: number; limit?: number; search?: string; status?: string } = {}) => {
  const { page = 1, limit = 15, search = "", status = "" } = query;
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) qs.set("search", search);
  if (status) qs.set("status", status);
  return fetchWithAuth(`${BASE}?${qs}`).then((r) => handleResponse<MRListResponse>(r));
};

export const getMaterialRequestById = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`).then((r) => handleResponse<MaterialRequest>(r));

export const createMaterialRequest = (payload: CreateMRPayload) =>
  fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => handleResponse(r));

export const updateMaterialRequest = (id: number | string, payload: CreateMRPayload) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then((r) => handleResponse(r));

export const deleteMaterialRequest = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handleResponse(r));

// ─── Master data ────────────────────────────────────────────────────────────

export const getMRCompanies = () => fetchWithAuth(`${BASE}/companies`).then((r) => handleResponse<{ id: number; name: string }[]>(r));
export const getMRProjects = () => fetchWithAuth(`${BASE}/projects`).then((r) => handleResponse<{ id: number; name: string; company_id?: number | null }[]>(r));
export const getMRFinYears = () => fetchWithAuth(`${BASE}/fin-years`).then((r) => handleResponse<{ id: number; name: string }[]>(r));

export interface MRItemOption {
  M_Id: string;
  M_Name: string;
  M_Group?: string | null;
  AvailableStock?: number;
  DefaultUOM?: string;
}

export const getMRItemOptions = (projectId?: string | number | null) => {
  const qs = projectId ? `?projectId=${projectId}` : "";
  return fetchWithAuth(`${BASE}/item-options${qs}`).then((r) => handleResponse<MRItemOption[]>(r));
};

export interface MRUomOption {
  UOMCode: string;
  UOMName: string;
  IsActive?: boolean | number;
}

export const getMRUomOptions = async (): Promise<MRUomOption[]> => {
  const data = await fetchWithAuth(`${BASE}/uom-options`).then((r) => handleResponse<any[]>(r));
  return (Array.isArray(data) ? data : []).filter((u) => u.IsActive === true || u.IsActive === 1);
};

export const previewNextMRNumber = () => fetchWithAuth(`${BASE}/preview-next-number`).then((r) => handleResponse<{ nextDocNo: string | null }>(r));

// ─── Doc-type numbering (same endpoints as other Material forms' ports) ────
export async function fetchDocTypes(module?: string): Promise<{ TypeOfDocId: number }[]> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  const res = await fetchWithAuth(`/api/document-type${qs}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

// ─── Fulfillment tracking + linked POs ──────────────────────────────────────

export interface MRPendingSummaryTotals {
  MRId: number;
  totalRequested: number;
  totalOrdered: number;
  totalPending: number;
}

export const getBulkMRPendingSummary = () =>
  fetchWithAuth(`${BASE}/pending-summary`).then((r) => handleResponse<MRPendingSummaryTotals[]>(r));

export interface MRLinkedPO {
  purchaseOrderId: number;
  poNumber: string;
  date: string;
  status: string;
  orderedQty: number;
  remainingQtyAfter: number;
}

export const getMRLinkedPOs = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/linked-pos`).then((r) => handleResponse<MRLinkedPO[]>(r));

// ─── UI constants ───────────────────────────────────────────────────────────

export const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"] as const;

export const PRIORITY_COLOR: Record<string, string> = {
  Low: "#64748b",
  Normal: "#059669",
  High: "#d97706",
  Urgent: "#dc2626",
};
