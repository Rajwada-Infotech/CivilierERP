import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/unit-bhk-config";

// No longer a fixed union — the 4 BHK types are just the seeded defaults;
// a layout type is really whatever's registered in dbo.RoomLayoutType
// (see LayoutType below), including any custom ones a user adds
// (Duplex, Triplex, Penthouse, ...). Kept as a plain string everywhere a
// type is referenced.
export type BhkType = string;

export interface LayoutType {
  /** dbo.RoomLayoutType.Id — what UnitMaster.LayoutTypeId points at. */
  id: number;
  typeKey: string;
  /** Display label, also the value stored as UnitMaster.UnitType ("2 BHK"). */
  label: string;
  /** Total rooms in its Unit Composition; 0 = no layout defined yet. */
  roomCount: number;
  /** e.g. "2 Bedroom · 1 Hall Room · 1 Kitchen"; empty when roomCount = 0. */
  summary: string;
}

// Query key shared by every page that lists layout types, so saving a
// composition refreshes the CRM / Unit Master pickers too.
export const LAYOUT_TYPES_QUERY_KEY = ["layout-types"] as const;

// Options for a Unit Type picker: only types with a defined layout (a unit's
// rooms are built from it), plus the record's current value if it isn't one
// of those, so an existing unit/template row still shows what it has.
export function unitTypeOptions(types: LayoutType[], current?: string | null): { value: string; label: string; title?: string }[] {
  const opts = types
    .filter((t) => t.roomCount > 0)
    .map((t) => ({ value: t.label, label: t.label, title: t.summary }));
  const cur = (current ?? "").trim();
  if (cur && !opts.some((o) => o.value === cur)) {
    const known = types.find((t) => t.label === cur);
    opts.push({ value: cur, label: known ? `${cur} (no layout yet)` : `${cur} (not in Unit Composition)`, title: undefined });
  }
  return opts;
}

export interface RoomSyncResult {
  unitsChecked: number;
  unitsUpdated: number;
  roomsAdded: number;
  failed: number;
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
  /** Synthetic "categoryId-index" key, e.g. "3-1" — ephemeral, not stored in DB */
  key: string;
  /** Human-readable label, e.g. "Bathroom 1" or "Kitchen" (no index for qty=1) */
  label: string;
  /**
   * Real dbo.RoomMaster.Id for this room, or null if "Generate from Layout"
   * hasn't been run yet for this unit. Use this when you need a stable FK
   * (e.g. linking work entries to blueprints or Dependency Master records).
   */
  roomMasterId: number | null;
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
  }).then((r) => handle<{ success: boolean; configId: number; roomSync?: RoomSyncResult }>(r));

// Work Allocation page's Room dropdown source — generated {alias} {index}
// instances for the given Unit, resolved via its own UnitType against the
// matching layout template.
export const getRoomInstancesForUnit = (unitId: number) =>
  fetchWithAuth(`${BASE}/room-instances/${unitId}`).then((r) => handle<RoomInstance[]>(r));
