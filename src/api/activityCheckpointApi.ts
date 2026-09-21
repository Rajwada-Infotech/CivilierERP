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
