// UnitMaster.FloorNo (0 = Ground) <-> the floor label Dependency Master and
// Flat Master store ("G", "1", "2", …). Compare scopes by label, never by
// the raw number — "0" and "G" are the same floor.
export const floorLabel = (floorNo: string | number | null | undefined): string =>
  floorNo === null || floorNo === undefined || floorNo === "" ? "" : String(floorNo) === "0" ? "G" : String(floorNo);

// Pseudo floor value the DPR pickers use for villas — a villa sits on a plot,
// not on a tower floor (UnitMaster.FloorNo is NULL), and its chains carry the
// floor label "Plot N".
export const VILLA_FLOOR = "villa";

// Readable name for pickers / chips.
export const floorDisplay = (floorNo: string | number | null | undefined): string => {
  if (floorNo === VILLA_FLOOR) return "Villas";
  const l = floorLabel(floorNo);
  return l === "" ? "" : l === "G" ? "Ground" : `Floor ${l}`;
};

// A chain's stored floor label: "G", "1", … for a tower, "Plot 21" for a villa.
export const chainFloorDisplay = (f: string | null | undefined): string =>
  !f ? "—" : /^plot\b/i.test(f) ? f : f === "G" ? "Ground floor" : `Floor ${f}`;

// RoomMaster.Storey — a villa room's own floor inside the villa ("G", "1", "2").
export const storeyDisplay = (s: string | null | undefined): string =>
  !s ? "" : s.toUpperCase() === "G" ? "Ground floor" : /^\d+$/.test(s) ? `Floor ${s}` : s;

// Room name with its villa floor when it has one: "Floor 1 · Bedroom 3".
export const roomDisplay = (name: string | null | undefined, storey?: string | null): string =>
  storey ? `${storeyDisplay(storey)} · ${name || "Room"}` : name || "Room";
