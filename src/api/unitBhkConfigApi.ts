import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/unit-bhk-config";

export type BhkType = "1BHK" | "2BHK" | "3BHK" | "4BHK";

export interface RoomCompositionRow {
  roomCategoryId: number;
  quantity: number;
  alias: string;
  sortOrder: number;
  categoryIsActive: boolean;
}

export interface UnitBhkConfigDetail {
  config: { id: number; bhkType: BhkType; isActive: boolean } | null;
  composition: RoomCompositionRow[];
}

export interface RoomInstance {
  key: string;
  label: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getUnitBhkConfig = (unitId: number) =>
  fetchWithAuth(`${BASE}/for-unit/${unitId}`).then((r) => handle<UnitBhkConfigDetail>(r));

export const saveUnitBhkConfig = (
  unitId: number,
  payload: { bhkType: BhkType; composition: { roomCategoryId: number; quantity: number }[] },
) =>
  fetchWithAuth(`${BASE}/for-unit/${unitId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

// Work Done page's Room dropdown source — generated {alias} {index}
// instances for the selected Unit, using whatever the categories are
// currently named.
export const getRoomInstancesForUnit = (unitId: number) =>
  fetchWithAuth(`${BASE}/room-instances/${unitId}`).then((r) => handle<RoomInstance[]>(r));
