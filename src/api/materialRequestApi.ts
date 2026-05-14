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
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const BASE = "/api/material-requests";

// ── API ────────────────────────────────────────────────────────────────────────

export const getMaterialRequests = (
  query: { page?: number; limit?: number; search?: string } = {}
) => {
  const { page = 1, limit = 10, search = "" } = query;
  const qs = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    ...(search ? { search } : {}),
  });
  return fetchWithAuth(`${BASE}?${qs}`).then((r) =>
    handleResponse<MRListResponse>(r)
  );
};

export const getMaterialRequestById = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`).then((r) =>
    handleResponse<MaterialRequest>(r)
  );

export const createMaterialRequest = (payload: CreateMRPayload) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const updateMaterialRequest = (
  id: number | string,
  payload: CreateMRPayload & { Status?: string }
) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const deleteMaterialRequest = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) =>
    handleResponse(r)
  );

export const submitMaterialRequest = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/submit`, { method: "PUT" }).then((r) =>
    handleResponse(r)
  );

// ── Master data ────────────────────────────────────────────────────────────────

export const getMRCompanies = () =>
  fetchWithAuth(`${BASE}/companies`).then((r) => handleResponse<any[]>(r));

export const getMRProjects = () =>
  fetchWithAuth(`${BASE}/projects`).then((r) => handleResponse<any[]>(r));

export const getMRFinYears = () =>
  fetchWithAuth(`${BASE}/fin-years`).then((r) => handleResponse<any[]>(r));

export const getMRItemOptions = () =>
  fetchWithAuth(`${BASE}/item-options`).then((r) => handleResponse<any[]>(r));

export const getMRUomOptions = () =>
  fetchWithAuth(`${BASE}/uom-options`).then((r) => handleResponse<any[]>(r));

export const previewNextMRNumber = () =>
  fetchWithAuth(`${BASE}/preview-next-number`).then((r) =>
    handleResponse<{ nextDocNo: string | null }>(r)
  );
