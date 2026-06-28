import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/activity-dependency";

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

export interface ActivityDependency {
  id: number;
  activityId: number;
  activityName: string | null;
  parentActivityId: number | null;
  parentActivityName: string | null;
  dependentActivityId: number | null;
  dependentActivityName: string | null;
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
  projectId: number | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface ActivityDependencyPayload {
  activityId: number;
  parentActivityId?: number | null;
  dependentActivityId?: number | null;
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
  projectId?: number | null;
}

export const getActivityDependencies = async (
  activityId?: number,
): Promise<ActivityDependency[]> => {
  const qs = activityId ? `?activityId=${activityId}` : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  return handleResponse<ActivityDependency[]>(res);
};

export const addActivityDependency = async (
  payload: ActivityDependencyPayload,
): Promise<{ success: boolean; id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const updateActivityDependency = async (
  id: number,
  payload: ActivityDependencyPayload,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const deleteActivityDependency = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
