// src/lib/itemUomAlternates.ts
//
// Per-item alternate UOM conversion math — separate from
// src/lib/uomConversion.ts, which only converts within a UOM's fixed
// physical category (Weight, Volume, ...). Cement in Bags vs Cubic Ft has
// no such category-wide ratio (it's a density fact specific to that one
// item), so each item tags its own alternate UOMs with their own factor.
// Backing table: backend/migrations/221-240/236-item-uom-alternates.sql.
//
// ConversionFactor semantics: 1 unit of the alternate UOM = ConversionFactor
// units of the item's own base UOM. E.g. Cement's base UOM is Bag; tagging
// CFT with ConversionFactor 0.3 means 1 CFT = 0.3 Bag.

export interface ItemUOMAlternate {
  itemId: string;
  uomCode: string;
  uomName?: string;
  symbol?: string;
  conversionFactor: number;
}

/** All alternate UOM codes tagged for one item, base UOM included (factor 1). */
export function itemUomCodes(
  alternates: ItemUOMAlternate[],
  itemId: string,
  baseUomCode?: string | null,
): string[] {
  const codes = new Set<string>();
  if (baseUomCode) codes.add(baseUomCode);
  for (const a of alternates) {
    if (a.itemId === itemId) codes.add(a.uomCode);
  }
  return [...codes];
}

/** This item's own alternates only (excludes its base UOM). */
export function alternatesForItem(
  alternates: ItemUOMAlternate[],
  itemId: string,
): ItemUOMAlternate[] {
  return alternates.filter((a) => a.itemId === itemId);
}

/**
 * Factor for one UOM relative to the item's base UOM (base UOM itself = 1).
 * Returns null when the UOM isn't the base and isn't a tagged alternate —
 * i.e. this item has no known conversion for it.
 */
export function getItemUomFactor(
  alternates: ItemUOMAlternate[],
  itemId: string,
  uomCode: string,
  baseUomCode?: string | null,
): number | null {
  if (baseUomCode && uomCode === baseUomCode) return 1;
  const match = alternates.find(
    (a) => a.itemId === itemId && a.uomCode === uomCode,
  );
  return match ? match.conversionFactor : null;
}

/** Quantity expressed in `fromFactor` units, converted to `toFactor` units. */
export function convertItemQuantity(
  qty: number,
  fromFactor: number,
  toFactor: number,
): number {
  if (!fromFactor || !toFactor) return qty;
  return qty * (fromFactor / toFactor);
}

/** Rate quoted per `fromFactor` unit, converted to a rate per `toFactor` unit. */
export function convertItemRate(
  rate: number,
  fromFactor: number,
  toFactor: number,
): number {
  if (!fromFactor || !toFactor) return rate;
  return rate * (toFactor / fromFactor);
}
