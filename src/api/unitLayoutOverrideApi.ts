import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { LayoutOverrideRow } from "@/lib/layoutResolve";

// Flat Master layout overrides (backend/routes/unitLayoutOverride.js): a
// layout type's room list overridden for one Project, Block, floor range of
// a Block, or Unit. Most specific wins: Unit > Floor > Block > Project > global.

const BASE = "/api/unit-layout-overrides";

export type ScopeLevel = "PROJECT" | "BLOCK" | "FLOOR" | "UNIT";

export interface OverrideScope {
  ScopeLevel: ScopeLevel;
  ProjectId: number;
  BlockId?: number | null;
  FloorFrom?: number | null;
  FloorTo?: number | null;
  UnitId?: number | null;
}

export interface OverridePreview {
  scope: { level: ScopeLevel; label: string; layout: string };
  existingOverrideId: number | null;
  overlap: { id: number; label: string } | null;
  unitsInScope: number;
  unitsChanged: number;
  unitsShadowed: number;
  roomsToAdd: number;
  roomsToRemove: number;
  roomsKeptWithWork: string[];
}

export interface OverrideApplyResult {
  overrideId: number;
  units: number;
  unitsChanged: number;
  roomsAdded: number;
  roomsRemoved: number;
  failed: number;
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `HTTP ${res.status}`);
  return body as T;
}

export const getProjectOverrides = (projectId: number) =>
  fetchWithAuth(`${BASE}/project/${projectId}`).then((r) => handle<LayoutOverrideRow[]>(r));

type Items = { roomCategoryId: number; quantity: number }[];

const post = <T,>(url: string, method: string, body: unknown) =>
  fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => handle<T>(r));

export const previewOverride = (scope: OverrideScope, layoutTypeId: number, items: Items | null) =>
  post<OverridePreview>(`${BASE}/preview`, "POST", { ...scope, LayoutTypeId: layoutTypeId, ...(items ? { items } : { reset: true }) });

export const saveOverride = (scope: OverrideScope, layoutTypeId: number, items: Items) =>
  post<OverrideApplyResult>(`${BASE}`, "PUT", { ...scope, LayoutTypeId: layoutTypeId, items });

export const resetOverride = (scope: OverrideScope, layoutTypeId: number) =>
  post<OverrideApplyResult>(`${BASE}/reset`, "POST", { ...scope, LayoutTypeId: layoutTypeId });
