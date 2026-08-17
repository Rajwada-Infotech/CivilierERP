import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/activity-checkpoint";

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

export interface ActivityCheckpoint {
  id: number;
  fieldName: string;
  sortOrder: number;
}

export const getActivityCheckpoints = async (activityId: number): Promise<ActivityCheckpoint[]> => {
  const res = await fetchWithAuth(`${BASE}/${activityId}`);
  return handleResponse<ActivityCheckpoint[]>(res);
};

export const addActivityCheckpoint = async (activityId: number, fieldName: string): Promise<ActivityCheckpoint> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activityId, fieldName }),
  });
  return handleResponse<ActivityCheckpoint>(res);
};

export const renameActivityCheckpoint = async (id: number, fieldName: string): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldName }),
  });
  return handleResponse<{ success: boolean }>(res);
};

export const deleteActivityCheckpoint = async (id: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};
