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
  // Optional minimum number of days after the assignment's own start date
  // before this checkpoint can be checked off — null means checkable any
  // time (today's default behavior).
  minWaitDays: number | null;
  /** "Calendar mark": Work Allocation shows a calendar + live camera for daily updates. */
  isDaily: boolean;
}

/** The general checkpoint list — one shared pool, not a list per activity. */
export const getCheckpoints = async (): Promise<ActivityCheckpoint[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<ActivityCheckpoint[]>(res);
};

export const addCheckpoint = async (
  fieldName: string,
  minWaitDays?: number | null,
  isDaily = false,
): Promise<ActivityCheckpoint> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldName, minWaitDays: minWaitDays ?? null, isDaily }),
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

export const setActivityCheckpointMinWaitDays = async (
  id: number,
  minWaitDays: number | null,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minWaitDays }),
  });
  return handleResponse<{ success: boolean }>(res);
};

export const deleteActivityCheckpoint = async (id: number): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};

export const setCheckpointDaily = async (id: number, isDaily: boolean): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isDaily }),
  });
  return handleResponse<{ success: boolean }>(res);
};

// ── Per-Activity checkpoint template ────────────────────────────────────────
// Which of the general catalog above applies to one Activity (dbo.ActivityMaster)
// — configured in Activity Master. A rung's own assignment auto-seeds its
// checklist from this the first time it's viewed (Work Allocation/Work
// Reporting no longer pick checkpoints by hand).
export interface ActivityCheckpointTemplateItem extends ActivityCheckpoint {
  /** dbo.ActivityCheckpointTemplate row id — pass to detachCheckpointFromActivity, not `id` (the catalog checkpoint's own id). */
  linkId: number;
}

export const getActivityCheckpointTemplate = async (
  activityId: number,
): Promise<ActivityCheckpointTemplateItem[]> => {
  const res = await fetchWithAuth(`${BASE}/template/${activityId}`);
  return handleResponse<ActivityCheckpointTemplateItem[]>(res);
};

export const attachCheckpointToActivity = async (
  activityId: number,
  checkpointId: number,
): Promise<{ linkId: number }> => {
  const res = await fetchWithAuth(`${BASE}/template/${activityId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkpointId }),
  });
  return handleResponse<{ linkId: number }>(res);
};

export const detachCheckpointFromActivity = async (
  activityId: number,
  linkId: number,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/template/${activityId}/${linkId}`, { method: "DELETE" });
  return handleResponse<{ success: boolean }>(res);
};
