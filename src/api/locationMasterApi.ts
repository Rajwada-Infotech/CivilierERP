import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Thin client over the Civil Work DPR Room Master — used here for cascading
// location dropdowns (Project -> Block -> Unit -> Room). Room Master was
// moved from the Follow-up/CRM module to Civil Work DPR in migration 382.

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
  Floor: string | null;
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

// Fetch rooms scoped to a specific unit — uses the ?unitId= query param
// added to GET /api/room-master so only that unit's rooms are loaded.
// Previously fetched the entire room list and filtered client-side, which
// scaled badly for large projects (500 units × 6 rooms = 3,000 rows).
export const getLocationRooms = async (unitId: number): Promise<RoomRecord[]> => {
  const res = await fetchWithAuth(`/api/room-master?unitId=${unitId}&activeOnly=1`);
  return handle<RoomRecord[]>(res);
};

