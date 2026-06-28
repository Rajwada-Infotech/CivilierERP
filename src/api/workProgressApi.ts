import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/work-progress";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface WorkProgress {
  id: number;
  allocationId: number;
  projectId: number | null;
  projectName: string | null;
  activityId: number | null;
  activityName: string | null;
  contractorId: number | null;
  contractorName: string | null;
  workDescription: string | null;
  quantityPlanned: number | null;
  quantityCompleted: number | null;
  remainingQuantity: number;
  percentageProgress: number;
  unit: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  currentStatus: string | null;
  remarks: string | null;
  reviewStatus: "Pending" | "Approved" | "Rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface WorkProgressPayload {
  allocationId: number;
  workDescription?: string | null;
  quantityPlanned?: number | null;
  quantityCompleted?: number | null;
  unit?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  currentStatus?: string | null;
  remarks?: string | null;
}

export interface ReviewPayload {
  reviewedBy: string;
  reviewStatus: "Approved" | "Rejected";
  reviewRemarks?: string | null;
}

export const getWorkProgress = async (filters?: {
  projectId?: number;
  allocationId?: number;
}): Promise<WorkProgress[]> => {
  const params = new URLSearchParams();
  if (filters?.projectId) params.set("projectId", String(filters.projectId));
  if (filters?.allocationId) params.set("allocationId", String(filters.allocationId));
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  return handleResponse<WorkProgress[]>(res);
};

export const addWorkProgress = async (
  payload: WorkProgressPayload,
): Promise<{ success: boolean; id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const updateWorkProgress = async (
  id: number,
  payload: WorkProgressPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const reviewWorkProgress = async (
  id: number,
  payload: ReviewPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const deleteWorkProgress = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
