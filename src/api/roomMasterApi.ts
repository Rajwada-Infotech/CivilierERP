import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/room-master";

export interface RoomMasterRow {
  Id: number;
  RoomName: string;
  UnitId: number;
  IsActive: boolean;
}

// Real dbo.RoomMaster rows tagged to this unit in Flat Master — activeOnly
// so a soft-deleted room never shows up as pickable elsewhere (e.g. Work
// Allocation's Room dropdown, which used to generate a synthetic room list
// from the unit's Unit Composition template instead of these real rows).
export const getRoomsForUnit = async (unitId: number): Promise<RoomMasterRow[]> => {
  const res = await fetchWithAuth(`${BASE}?unitId=${unitId}&activeOnly=1`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not load rooms");
  }
  return res.json();
};

export interface RoomBlueprint {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

// null when no blueprint has been uploaded for this room — not an error,
// callers should show an "upload a blueprint" prompt rather than a toast.
export const getRoomBlueprint = async (roomId: number): Promise<RoomBlueprint | null> => {
  const res = await fetchWithAuth(`${BASE}/${roomId}/blueprint`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Could not load blueprint");
  }
  return res.json();
};
