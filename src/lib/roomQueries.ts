import type { QueryClient } from "@tanstack/react-query";

// Every React Query key whose data is derived from dbo.RoomMaster. Anything
// that adds, removes, reactivates or renames rooms (Room Master itself, a
// Unit Composition save, a layout override, a Room Category rename, a Unit
// Master edit, CRM Auto Setup) must refresh all of them — otherwise another
// screen keeps serving its cached copy until staleTime runs out. Add new
// room-derived keys here, not at the call sites.
const ROOM_DATA_QUERY_KEYS = [
  ["room-master"],
  ["room-master-units"],
  ["room-master-unit-rooms"],
  ["dep-scope-rooms"],
  ["work-done-rooms-for-unit"],
] as const;

export function invalidateRoomData(qc: QueryClient) {
  return Promise.all(ROOM_DATA_QUERY_KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
}
