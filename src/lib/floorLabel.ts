// UnitMaster.FloorNo (0 = Ground) <-> the floor label Dependency Master and
// Flat Master store ("G", "1", "2", …). Compare scopes by label, never by
// the raw number — "0" and "G" are the same floor.
export const floorLabel = (floorNo: string | number | null | undefined): string =>
  floorNo === null || floorNo === undefined || floorNo === "" ? "" : String(floorNo) === "0" ? "G" : String(floorNo);

// Readable name for pickers / chips.
export const floorDisplay = (floorNo: string | number | null | undefined): string => {
  const l = floorLabel(floorNo);
  return l === "" ? "" : l === "G" ? "Ground" : `Floor ${l}`;
};
