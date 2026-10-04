import { describe, it, expect } from "vitest";
import {
  pickOverride, resolveLayout, ownOverride, inheritedLayout, scopeLabel, roomTotal,
  type LayoutOverrideRow, type CompositionRow,
} from "./layoutResolve";

// Mirrors the server rules tested in backend/scripts/verifyUnitLayoutSync.js [9b].
const comp = (n: number): CompositionRow[] => [{ categoryId: 1, alias: "Bedroom", quantity: n }];
const GLOBAL = comp(2);
const T = 7; // layout type id
const ov = (id: number, o: Partial<LayoutOverrideRow>): LayoutOverrideRow => ({
  Id: id, LayoutTypeId: T, ScopeLevel: "PROJECT", ProjectId: 1, BlockId: null, FloorFrom: null, FloorTo: null, UnitId: null,
  composition: comp(id), ...o,
});
const P = ov(10, { ScopeLevel: "PROJECT" });
const B = ov(20, { ScopeLevel: "BLOCK", BlockId: 5 });
const F = ov(30, { ScopeLevel: "FLOOR", BlockId: 5, FloorFrom: 1, FloorTo: 10 });
const U = ov(40, { ScopeLevel: "UNIT", BlockId: 5, UnitId: 99 });
const ALL = [P, B, F, U];

describe("layoutResolve (mirror of server precedence)", () => {
  it("falls back to the global layout with no overrides", () => {
    const r = resolveLayout([], GLOBAL, T, { projectId: 1, blockId: 5, floorNo: 3, unitId: 99 });
    expect(r.override).toBeNull();
    expect(r.composition).toBe(GLOBAL);
  });

  it("most specific wins: unit > floor range > block > project", () => {
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 3, unitId: 99 })?.Id).toBe(40);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 3, unitId: 1 })?.Id).toBe(30);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 11, unitId: 1 })?.Id).toBe(20);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 6, floorNo: 3, unitId: 1 })?.Id).toBe(10);
  });

  it("floor range boundaries are inclusive; ground floor is 0", () => {
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 1 })?.Id).toBe(30);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 10 })?.Id).toBe(30);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 0 })?.Id).toBe(20);
  });

  it("maxLevel limits resolution to the node's own level (block row ignores floor/unit exceptions)", () => {
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5, floorNo: 3, unitId: 99 }, "BLOCK")?.Id).toBe(20);
    expect(pickOverride(ALL, T, { projectId: 1, blockId: 5 }, "PROJECT")?.Id).toBe(10);
  });

  it("ignores other layout types", () => {
    expect(pickOverride([{ ...U, LayoutTypeId: 8 }], T, { projectId: 1, blockId: 5, unitId: 99 })).toBeNull();
  });

  it("a floor inside an existing range edits that range", () => {
    expect(ownOverride(ALL, T, "FLOOR", { projectId: 1, blockId: 5, floorNo: 7 })?.Id).toBe(30);
    expect(ownOverride(ALL, T, "FLOOR", { projectId: 1, blockId: 5, floorNo: 12 })).toBeNull();
  });

  it("inherited = the level just above", () => {
    const p = { projectId: 1, blockId: 5, floorNo: 3, unitId: 99 };
    expect(inheritedLayout(ALL, GLOBAL, T, "UNIT", p).override?.Id).toBe(30);
    expect(inheritedLayout(ALL, GLOBAL, T, "FLOOR", p).override?.Id).toBe(20);
    expect(inheritedLayout(ALL, GLOBAL, T, "BLOCK", p).override?.Id).toBe(10);
    expect(inheritedLayout(ALL, GLOBAL, T, "PROJECT", p).override).toBeNull();
    expect(inheritedLayout([U], GLOBAL, T, "UNIT", p).override).toBeNull();
  });

  it("never crashes on a missing room list (e.g. layout types cached from an older API response)", () => {
    const missing = undefined as unknown as CompositionRow[];
    const r = resolveLayout([], missing, T, { projectId: 1 });
    expect(r.composition).toEqual([]);
    expect(inheritedLayout([], missing, T, "PROJECT", { projectId: 1 }).composition).toEqual([]);
    expect(roomTotal(undefined)).toBe(0);
    expect(roomTotal(null)).toBe(0);
  });

  it("labels and totals", () => {
    expect(scopeLabel(F)).toBe("Floors 1–10");
    expect(scopeLabel({ ScopeLevel: "FLOOR", FloorFrom: 0, FloorTo: 0 })).toBe("Floor G");
    expect(scopeLabel(B)).toBe("Block");
    expect(roomTotal([{ categoryId: 1, alias: "a", quantity: 2 }, { categoryId: 2, alias: "b", quantity: 3 }])).toBe(5);
  });
});
