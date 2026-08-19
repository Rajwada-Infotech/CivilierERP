import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/room-master";

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
