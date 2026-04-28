import { fetchWithAuth } from "@/lib/fetchWithAuth";

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
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
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
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

const BASE_URL = "/api/amendments";

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.error || data?.message || `Request failed with status ${response.status}`,
    );
  }

  return data as T;
}

export function getAmendments(params?: {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  refDocType?: string;
}): Promise<PaginatedAmendments> {
  const query = new URLSearchParams();

  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.refDocType) query.set("refDocType", params.refDocType);

  const suffix = query.toString();

  return requestJson<PaginatedAmendments>(
    suffix ? `${BASE_URL}?${suffix}` : BASE_URL,
  );
}

export function getAmendment(id: number): Promise<Amendment> {
  return requestJson<Amendment>(`${BASE_URL}/${id}`);
}

export function createAmendment(payload: AmendmentPayload): Promise<{
  Id: number;
  AmendmentNo: string;
  Status: string;
}> {
  return requestJson(`${BASE_URL}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAmendment(
  id: number,
  payload: AmendmentPayload,
): Promise<{ success: boolean }> {
  return requestJson(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function submitAmendment(
  id: number,
): Promise<{ success: boolean; status: string }> {
  return requestJson(`${BASE_URL}/${id}/submit`, {
    method: "POST",
  });
}

export function approveAmendment(
  id: number,
): Promise<{ success: boolean; status: string }> {
  return requestJson(`${BASE_URL}/${id}/approve`, {
    method: "POST",
  });
}

export function rejectAmendment(
  id: number,
  note: string,
): Promise<{ success: boolean; status: string }> {
  return requestJson(`${BASE_URL}/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
}

export function deleteAmendment(id: number): Promise<{ success: boolean }> {
  return requestJson(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
}
