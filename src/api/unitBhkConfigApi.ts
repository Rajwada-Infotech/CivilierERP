import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/unit-bhk-config";

// No longer a fixed union — the 4 BHK types are just the seeded defaults;
// a layout type is really whatever's registered in dbo.RoomLayoutType
// (see LayoutType below), including any custom ones a user adds
// (Duplex, Triplex, Penthouse, ...). Kept as a plain string everywhere a
// type is referenced.
export type BhkType = string;

export interface LayoutType {
  typeKey: string;
  label: string;
  isSystem: boolean;
}

export interface RoomCompositionRow {
  roomCategoryId: number;
  quantity: number;
  alias: string;
  sortOrder: number;
  categoryIsActive: boolean;
}

export interface BhkTemplateDetail {
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

// Every registered layout type — the 4 seeded BHK defaults plus any custom
// ones added via addLayoutType(), for the composition builder's picker.
export const getLayoutTypes = () =>
  fetchWithAuth(`${BASE}/types`).then((r) => handle<LayoutType[]>(r));

// Registers a new custom layout type (e.g. "Duplex"). Idempotent — adding
// the same label twice just returns the existing one.
export const addLayoutType = (label: string) =>
  fetchWithAuth(`${BASE}/types`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  }).then((r) => handle<LayoutType>(r));

// One composition template per layout type — every Unit whose own
// UnitType (dbo.UnitMaster) matches inherits it automatically, so there's
// no per-Unit setup step.
export const getBhkTemplate = (bhkType: BhkType) =>
  fetchWithAuth(`${BASE}/template/${encodeURIComponent(bhkType)}`).then((r) => handle<BhkTemplateDetail>(r));

export const saveBhkTemplate = (
  bhkType: BhkType,
  payload: { composition: { roomCategoryId: number; quantity: number }[] },
) =>
  fetchWithAuth(`${BASE}/template/${encodeURIComponent(bhkType)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

// Work Allocation page's Room dropdown source — generated {alias} {index}
// instances for the given Unit, resolved via its own UnitType against the
// matching layout template.
export const getRoomInstancesForUnit = (unitId: number) =>
  fetchWithAuth(`${BASE}/room-instances/${unitId}`).then((r) => handle<RoomInstance[]>(r));
