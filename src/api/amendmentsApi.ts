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
  refDocId?: number;
}): Promise<PaginatedAmendments> {
  const query = new URLSearchParams();

  if (params?.page) query.set("page", String(params.page));
  if (params?.pageSize) query.set("pageSize", String(params.pageSize));
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  if (params?.refDocType) query.set("refDocType", params.refDocType);
  if (params?.refDocId != null) query.set("refDocId", String(params.refDocId));

  const suffix = query.toString();

  return requestJson<PaginatedAmendments>(
    suffix ? `${BASE_URL}?${suffix}` : BASE_URL,
  );
}

/** Whether a specific document already has an Approved amendment against
 *  it — drives the "Approved & Amended" badge and the post-approval
 *  Edit→Amend button swap across Finance/Material/Engineering transaction
 *  pages. */
export async function getApprovedAmendmentForDoc(
  refDocType: string,
  refDocId: number,
): Promise<Amendment | null> {
  const res = await getAmendments({ refDocType, refDocId, status: "Approved", pageSize: 1 });
  return res.data[0] ?? null;
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

export interface AmendmentLineChange {
  Id: number;
  AmendmentId: number;
  FieldName: string;
  FieldLabel: string | null;
  OldValue: string | null;
  NewValue: string | null;
  ChangedBy: string | null;
  ChangedAt: string;
}

export interface AmendmentLineChangeInput {
  FieldName: string;
  FieldLabel?: string;
  OldValue?: string;
  NewValue?: string;
}

/** Per-field old→new audit trail for an amendment — lets a single amendment
 *  cover any number of changed fields (item qty, rate, date, etc.), not just
 *  the single headline Original/Revised value. Only postable while the
 *  amendment is still in "Draft" (enforced server-side). */
export function getAmendmentLineChanges(
  amendmentId: number,
): Promise<AmendmentLineChange[]> {
  return requestJson(`${BASE_URL}/${amendmentId}/line-changes`);
}

export function addAmendmentLineChanges(
  amendmentId: number,
  changes: AmendmentLineChangeInput[],
): Promise<{ success: boolean; count: number }> {
  return requestJson(`${BASE_URL}/${amendmentId}/line-changes`, {
    method: "POST",
    body: JSON.stringify({ changes }),
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
