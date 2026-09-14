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
 * units relevant to it — same category. Units with no category (Bags, Box,
 * Set...) are matched against each other too, so a packaging-unit item still
 * only offers other packaging units instead of the entire UOM list. */
export function relevantUOMs<T extends { category?: string | null }>(
  allUoms: T[],
  currentCategory: string | null | undefined,
): T[] {
  return allUoms.filter((u) => (u.category ?? null) === (currentCategory ?? null));
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
