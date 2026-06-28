import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/activity-items";

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

export interface ActivityItem {
  id: number;
  activityId: number;
  itemId: string;
  itemName: string;
  itemCode: string | null;
  uom: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export const getActivityItems = async (
  activityId: number,
): Promise<ActivityItem[]> => {
  const res = await fetchWithAuth(`${BASE}?activityId=${activityId}`);
  return handleResponse<ActivityItem[]>(res);
};

export const addActivityItem = async (
  activityId: number,
  itemId: string,
): Promise<{ success: boolean; id: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activityId, itemId }),
  });
  return handleResponse(res);
};

export const deleteActivityItem = async (
  id: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
