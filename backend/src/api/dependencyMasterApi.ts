import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dependency-master";

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

// ─── Types ────────────────────────────────────────────────────────────────────
export type WorkType = "INTERNAL" | "EXTERNAL";

export interface ScopeOption {
  id: number | string;
  label: string;
}

export interface DependencyScope {
  projectId: number;
  towerId: number;
  floor: string; // free text (dbo.RoomMaster.Floor), not a master FK
  flatId: number;
  roomId: number;
}

export interface LadderActivity {
  /** dbo.DependencyMasterActivity's own row id — only present once a chain
   * has been saved and re-fetched (GET /:id); a chain still being edited in
   * the form builder has no rung id yet. Needed to hang anything else off a
   * specific rung, e.g. Work Allocation's per-rung engineer/material
   * assignment. */
  rungId?: number;
  activityId: number;
  activityName: string; // denormalized for display
  sequenceNo: number; // 1-indexed, drives ladder order
  /** Frozen at the moment this rung was added — independent of the record's
   * own WorkType toggle, so switching the toggle later never repaints
   * already-added rungs. */
  workType: WorkType;
}

export interface DependencyMasterPayload {
  scope: DependencyScope;
  alias: string;
  workType: WorkType;
  activities: LadderActivity[]; // ordered array = the chain
}

export interface DependencyMasterListRow {
  id: number;
  alias: string;
  workType: WorkType;
  isActive: boolean;
  projectId: number;
  projectName: string | null;
  towerId: number;
  towerName: string | null;
  floor: string;
  flatId: number;
  flatName: string | null;
  roomId: number;
  roomName: string | null;
  createdAt: string;
  activityCount: number;
  /** Server-built "Tower > Floor N > Flat > Room" trail — ready to render. */
  scopePath: string;
}

export interface DependencyMasterDetail extends DependencyMasterListRow {
  updatedAt: string | null;
  activities: LadderActivity[];
}

// ─── Scope cascade ────────────────────────────────────────────────────────────
export const getTowerOptions = async (projectId: number): Promise<ScopeOption[]> => {
  const res = await fetchWithAuth(`${BASE}/scope-options?level=tower&projectId=${projectId}`);
  return handleResponse<ScopeOption[]>(res);
};

export const getFloorOptions = async (towerId: number): Promise<ScopeOption[]> => {
  const res = await fetchWithAuth(`${BASE}/scope-options?level=floor&towerId=${towerId}`);
  return handleResponse<ScopeOption[]>(res);
};

export const getFlatOptions = async (towerId: number, floor: string): Promise<ScopeOption[]> => {
  const res = await fetchWithAuth(
    `${BASE}/scope-options?level=flat&towerId=${towerId}&floor=${encodeURIComponent(floor)}`,
  );
  return handleResponse<ScopeOption[]>(res);
};

export const getRoomOptions = async (flatId: number, floor: string): Promise<ScopeOption[]> => {
  const res = await fetchWithAuth(
    `${BASE}/scope-options?level=room&flatId=${flatId}&floor=${encodeURIComponent(floor)}`,
  );
  return handleResponse<ScopeOption[]>(res);
};

// Projects reuse the same source room-master.js already exposes (business_type='P').
export const getProjectOptions = async (): Promise<ScopeOption[]> => {
  const res = await fetchWithAuth(`/api/room-master/projects`);
  const rows = await handleResponse<{ Id: number; Name: string }[]>(res);
  return rows.map((r) => ({ id: r.Id, label: r.Name }));
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export const getDependencyMasters = async (): Promise<DependencyMasterListRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<DependencyMasterListRow[]>(res);
};

export const getDependencyMaster = async (id: number): Promise<DependencyMasterDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse<DependencyMasterDetail>(res);
};

export const addDependencyMaster = async (
  payload: DependencyMasterPayload,
): Promise<{ success: boolean; id: number; message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; id: number; message: string }>(res);
};

export const updateDependencyMaster = async (
  id: number,
  payload: DependencyMasterPayload,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<{ success: boolean; message: string }>(res);
};

export const deleteDependencyMaster = async (
  id: number,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse<{ success: boolean; message: string }>(res);
};
