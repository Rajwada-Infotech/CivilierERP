import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/room-category-master";

export interface RoomCategory {
  id: number;
  categoryName: string;
  alias: string;
  sortOrder: number;
  isActive?: boolean | number;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getRoomCategoryOptions = () =>
  fetchWithAuth(`${BASE}/options`).then((r) => handle<RoomCategory[]>(r));

export const getRoomCategories = () =>
  fetchWithAuth(BASE).then((r) => handle<RoomCategory[]>(r));

export const createRoomCategory = (payload: { categoryName: string; alias: string; sortOrder: number; isActive: boolean }) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const updateRoomCategory = (id: number, payload: { categoryName: string; alias: string; sortOrder: number; isActive: boolean; renameRooms?: boolean }) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle<{ success: boolean; roomsRenamed?: number }>(r));

// How many existing rooms carry this category's current name (would be renamed with it).
export const getRoomCategoryRenameCount = (id: number) =>
  fetchWithAuth(`${BASE}/${id}/rename-count`).then((r) => handle<{ rooms: number }>(r));

// Where a category is used (shown before deactivating): layouts, layout
// overrides and active Flat Master rooms — all of which keep it.
export const getRoomCategoryUsage = (id: number) =>
  fetchWithAuth(`${BASE}/${id}/usage`).then((r) => handle<{ layouts: number; overrides: number; rooms: number }>(r));

export const deleteRoomCategory = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handle(r));
