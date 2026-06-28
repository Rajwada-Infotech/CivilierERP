import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/daily-labour";

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

export interface DailyLabourEntry {
  id: number;
  allocationId: number;
  contractorName: string | null;
  activityName: string | null;
  entryDate: string;
  skilledLabourCount: number;
  unskilledLabourCount: number;
  totalLabourPresent: number;
  shift: string | null;
  attendanceStatus: string | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface DailyLabourPayload {
  allocationId: number;
  entryDate: string;
  skilledLabourCount: number;
  unskilledLabourCount: number;
  shift?: string | null;
  attendanceStatus?: string | null;
  remarks?: string | null;
}

export const getDailyLabourEntries = async (filters?: {
  allocationId?: number;
  from?: string;
  to?: string;
}): Promise<DailyLabourEntry[]> => {
  const params = new URLSearchParams();
  if (filters?.allocationId) params.set("allocationId", String(filters.allocationId));
  if (filters?.from) params.set("from", filters.from);
  if (filters?.to) params.set("to", filters.to);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  return handleResponse<DailyLabourEntry[]>(res);
};

export const addDailyLabourEntry = async (
  payload: DailyLabourPayload,
): Promise<{ success: boolean; id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const updateDailyLabourEntry = async (
  id: number,
  payload: DailyLabourPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const deleteDailyLabourEntry = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
