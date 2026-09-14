// src/api/materialRequestApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ──────────────────────────────────────────────────────────────────────

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
  CreatedBy?: string;
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
  CompanyId?: number | string | null;
  ProjectId?: number | string | null;
  FinYearId?: number | string | null;
  RequestDate?: string;
  RequiredByDate?: string | null;
  Priority?: string;
  Reason: string;
  Remarks?: string | null;
  items: MRLineItem[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

const BASE = "/api/material-requests";

// ── API ────────────────────────────────────────────────────────────────────────

export const getMaterialRequests = (
  query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  } = {},
) => {
  const { page = 1, limit = 10, search = "", status = "" } = query;
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });
  return fetchWithAuth(`${BASE}?${qs}`).then((r) =>
    handleResponse<MRListResponse>(r),
  );
};

export const getMaterialRequestById = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`).then((r) =>
    handleResponse<MaterialRequest>(r),
  );

export const createMaterialRequest = (payload: CreateMRPayload) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const updateMaterialRequest = (
  id: number | string,
  payload: CreateMRPayload & { Status?: string },
) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const deleteMaterialRequest = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) =>
    handleResponse(r),
  );

export const submitMaterialRequest = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/submit`, { method: "PUT" }).then((r) =>
    handleResponse(r),
  );

// ── Master data ────────────────────────────────────────────────────────────────

export const getMRCompanies = () =>
  fetchWithAuth(`${BASE}/companies`).then((r) => handleResponse<any[]>(r));

export const getMRProjects = () =>
  fetchWithAuth(`${BASE}/projects`).then((r) => handleResponse<any[]>(r));

export const getMRFinYears = () =>
  fetchWithAuth(`${BASE}/fin-years`).then((r) => handleResponse<any[]>(r));

export const getMRItemOptions = (projectId?: string | number | null) => {
  const qs = projectId ? `?projectId=${projectId}` : "";
  return fetchWithAuth(`${BASE}/item-options${qs}`).then((r) =>
    handleResponse<any[]>(r),
  );
};

export const getMRUomOptions = () =>
  fetchWithAuth(`${BASE}/uom-options`).then((r) => handleResponse<any[]>(r));

export const previewNextMRNumber = () =>
  fetchWithAuth(`${BASE}/preview-next-number`).then((r) =>
    handleResponse<{ nextDocNo: string | null }>(r),
  );

// ── PO creation from MR ────────────────────────────────────────────────────────

export interface MRPOPrefillItem {
  MRItemId: number;
  ItemId: string;
  ItemName: string;
  UOMCode: string;
  UOMName: string;
  Quantity: number;
  /** Already ordered against this MR item across earlier POs. */
  OrderedQty: number;
  /** What's left to order — the cap for this PO's quantity input. */
  PendingQty: number;
  Remarks: string;
  M_CGST: number | null;
  M_SGST: number | null;
  M_IGST: number | null;
}

export interface MRItemFulfillment {
  MRItemId: number;
  ItemId: string;
  ItemName: string;
  UOMCode: string;
  RequestedQty: number;
  OrderedQty: number;
  PendingQty: number;
}

export interface MRPendingSummary {
  MRId: number;
  items: MRItemFulfillment[];
  totalRequested: number;
  totalOrdered: number;
  totalPending: number;
}

export interface MRPendingSummaryTotals {
  MRId: number;
  totalRequested: number;
  totalOrdered: number;
  totalPending: number;
}

export interface MRLinkedPO {
  purchaseOrderId: number;
  poNumber: string;
  date: string;
  status: string;
  orderedQty: number;
  remainingQtyAfter: number;
}

export interface MRPOPrefill {
  MRId: number;
  DocNo: string;
  CompanyId: number | null;
  CompanyName: string;
  ProjectId: number | null;
  ProjectName: string;
  FinYearId: number | null;
  FinYearName: string;
  Remarks: string;
  items: MRPOPrefillItem[];
}

export interface ApprovedMRSummary {
  MRId: number;
  DocNo: string;
  FinYearId: number | null;
  FinYearName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
}

export const getApprovedMRList = (params?: {
  companyId?: string;
  projectId?: string;
  finYearId?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", params.companyId);
  if (params?.projectId) qs.set("projectId", params.projectId);
  if (params?.finYearId) qs.set("finYearId", params.finYearId);
  const query = qs.toString() ? `?${qs.toString()}` : "";
  return fetchWithAuth(`${BASE}/approved-list${query}`).then((r) =>
    handleResponse<ApprovedMRSummary[]>(r),
  );
};

export const getMRPOPrefillByDocNo = (docNo: string) =>
  fetchWithAuth(
    `${BASE}/by-docno/${encodeURIComponent(docNo.trim().toUpperCase())}`,
  ).then((r) => handleResponse<MRPOPrefill>(r));

export const getMRPOPrefill = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/create-po-prefill`).then((r) =>
    handleResponse<MRPOPrefill>(r),
  );

export const markMROrdered = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/mark-ordered`, { method: "PUT" }).then((r) =>
    handleResponse(r),
  );

// ── Partial-fulfillment tracking ────────────────────────────────────────────────

export const getMRPendingSummary = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/pending-summary`).then((r) =>
    handleResponse<MRPendingSummary>(r),
  );

export const getBulkMRPendingSummary = () =>
  fetchWithAuth(`${BASE}/pending-summary`).then((r) =>
    handleResponse<MRPendingSummaryTotals[]>(r),
  );

export const getMRLinkedPOs = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/linked-pos`).then((r) =>
    handleResponse<MRLinkedPO[]>(r),
  );
