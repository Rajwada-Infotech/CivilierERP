// Client-side mirror of backend/services/unitLayout.js pickOverride /
// getEffectiveComposition — lets the Flat Master tree show every level's
// layout from one request per project instead of one per row. The rules
// MUST stay identical to the server's (see layoutResolve.test.ts):
//
//   UNIT > FLOOR (range of one block) > BLOCK > PROJECT > global

export type Level = "PROJECT" | "BLOCK" | "FLOOR" | "UNIT";

export interface CompositionRow { categoryId: number; alias: string; quantity: number }

export interface LayoutOverrideRow {
  Id: number;
  LayoutTypeId: number;
  ScopeLevel: Level;
  ProjectId: number;
  BlockId: number | null;
  FloorFrom: number | null;
  FloorTo: number | null;
  UnitId: number | null;
  composition: CompositionRow[];
}

export interface Position { projectId: number; blockId?: number | null; floorNo?: number | null; unitId?: number | null }

export const RANK: Record<Level, number> = { PROJECT: 1, BLOCK: 2, FLOOR: 3, UNIT: 4 };

const floorText = (n: number) => (n === 0 ? "G" : String(n));

export function scopeLabel(o: Pick<LayoutOverrideRow, "ScopeLevel" | "FloorFrom" | "FloorTo">): string {
  if (o.ScopeLevel === "FLOOR" && o.FloorFrom != null && o.FloorTo != null) {
    return o.FloorFrom === o.FloorTo ? `Floor ${floorText(o.FloorFrom)}` : `Floors ${floorText(o.FloorFrom)}–${floorText(o.FloorTo)}`;
  }
  return { PROJECT: "Project", BLOCK: "Block", FLOOR: "Floor", UNIT: "Unit" }[o.ScopeLevel];
}

export function applies(o: LayoutOverrideRow, p: Position): boolean {
  switch (o.ScopeLevel) {
    case "PROJECT": return o.ProjectId === p.projectId;
    case "BLOCK": return o.BlockId != null && o.BlockId === p.blockId;
    case "FLOOR": return o.BlockId != null && o.BlockId === p.blockId && p.floorNo != null
      && o.FloorFrom != null && o.FloorTo != null && p.floorNo >= o.FloorFrom && p.floorNo <= o.FloorTo;
    case "UNIT": return o.UnitId != null && o.UnitId === p.unitId;
    default: return false;
  }
}

// The most specific override of one layout type that applies at `p`,
// considering only levels up to `maxLevel` (so a Block row shows what the
// block defines, ignoring floor/unit exceptions below it).
export function pickOverride(overrides: LayoutOverrideRow[], layoutTypeId: number, p: Position, maxLevel: Level = "UNIT"): LayoutOverrideRow | null {
  let best: LayoutOverrideRow | null = null;
  for (const o of overrides) {
    if (o.LayoutTypeId !== layoutTypeId || RANK[o.ScopeLevel] > RANK[maxLevel] || !applies(o, p)) continue;
    if (!best || RANK[o.ScopeLevel] > RANK[best.ScopeLevel]) best = o;
  }
  return best;
}

export interface Resolved {
  composition: CompositionRow[];
  override: LayoutOverrideRow | null; // null = the global Unit Composition layout
}

export function resolveLayout(
  overrides: LayoutOverrideRow[], global: CompositionRow[], layoutTypeId: number, p: Position, maxLevel: Level = "UNIT",
): Resolved {
  const o = pickOverride(overrides, layoutTypeId, p, maxLevel);
  return { composition: o ? o.composition : global, override: o };
}

// The override a tree node EDITS. For a floor row inside an existing floor
// range this is that whole range (editing floor 3 of "Floors 1–10" edits
// the range, rather than creating an overlapping single floor).
export function ownOverride(overrides: LayoutOverrideRow[], layoutTypeId: number, level: Level, p: Position): LayoutOverrideRow | null {
  return overrides.find((o) => o.LayoutTypeId === layoutTypeId && o.ScopeLevel === level && applies(o, p)) ?? null;
}

// What a node would get without its own override: the level just above it.
export function inheritedLayout(
  overrides: LayoutOverrideRow[], global: CompositionRow[], layoutTypeId: number, level: Level, p: Position,
): Resolved {
  const above = (Object.keys(RANK) as Level[]).filter((l) => RANK[l] === RANK[level] - 1)[0];
  if (!above) return { composition: global, override: null };
  return resolveLayout(overrides, global, layoutTypeId, p, above);
}

export const roomTotal = (c: CompositionRow[]) => c.reduce((n, r) => n + r.quantity, 0);

export const compositionText = (c: CompositionRow[]) => c.map((r) => `${r.quantity} ${r.alias}`).join(" · ");
