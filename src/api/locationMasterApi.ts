import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Thin client over the Follow-up module's Block/Unit/Room masters — used
// here only for cascading location dropdowns (Project -> Block -> Unit ->
// Room), not full CRUD (that lives in src/pages/followup/*).

async function handle<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON
  }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data as T;
}

export interface LocationOption {
  Id: number;
  Name: string;
}

export interface UnitOption {
  Id: number;
  Name: string;
  ProjectId: number;
  BlockId: number | null;
  BlockName: string | null;
}

export interface RoomRecord {
  Id: number;
  ProjectId: number | null;
  ProjectName: string | null;
  BlockId: number | null;
  BlockName: string | null;
  UnitId: number | null;
  UnitName: string | null;
  RoomName: string;
  IsActive: boolean;
}

export const getLocationProjects = async (): Promise<LocationOption[]> => {
  const res = await fetchWithAuth("/api/unit-master/projects");
  return handle<LocationOption[]>(res);
};

export const getLocationBlocks = async (projectId: number): Promise<LocationOption[]> => {
  const res = await fetchWithAuth(`/api/unit-master/blocks?projectId=${projectId}`);
  return handle<LocationOption[]>(res);
};

export const getLocationUnits = async (projectId: number): Promise<UnitOption[]> => {
  const res = await fetchWithAuth(`/api/room-master/units?projectId=${projectId}`);
  return handle<UnitOption[]>(res);
};

// No "rooms by unit" endpoint exists yet — fetch the full room list and
// filter client-side by UnitId, same as the Room Master page does internally.
export const getLocationRooms = async (): Promise<RoomRecord[]> => {
  const res = await fetchWithAuth("/api/room-master");
  return handle<RoomRecord[]>(res);
};
