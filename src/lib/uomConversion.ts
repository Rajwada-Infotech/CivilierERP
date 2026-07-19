// src/lib/uomConversion.ts
//
// UOM relevance + conversion — mirrors backend/migrations/221-240/229-uom-category-conversion.sql.
// UOMMaster.BaseFactor is a unit's size relative to its category's base unit
// (base unit = 1). Units with UOMCategory = null (Bags, Box, Set, Lump Sum...)
// have no fixed physical relationship to anything else, so they're never
// filtered against or converted — only same-category units are.

export interface UOMOption {
  id: number;
  name: string;
  code: string;
  category: string | null;
  baseFactor: number;
}

/** Given the full UOM list and the currently-selected unit, return only the
 * units relevant to it — same category, plus the unit itself. If the current
 * unit has no category (or isn't found), every unit is returned unfiltered,
 * same as before this feature existed. */
export function relevantUOMs<T extends { category?: string | null }>(
  allUoms: T[],
  currentCategory: string | null | undefined,
): T[] {
  if (!currentCategory) return allUoms;
  return allUoms.filter((u) => u.category === currentCategory);
}

/** Rate quoted per `fromFactor` unit, converted to a rate per `toFactor` unit.
 * E.g. ₹100/tonne (factor 1000) → ₹/kg (factor 1): 100 * (1/1000) = 0.1 */
export function convertRate(rate: number, fromFactor: number, toFactor: number): number {
  if (!fromFactor || !toFactor) return rate;
  return rate * (toFactor / fromFactor);
}

/** Quantity expressed in `fromFactor` units, converted to `toFactor` units.
 * E.g. 5 tonnes (factor 1000) → kg (factor 1): 5 * (1000/1) = 5000 */
export function convertQuantity(qty: number, fromFactor: number, toFactor: number): number {
  if (!fromFactor || !toFactor) return qty;
  return qty * (fromFactor / toFactor);
}
