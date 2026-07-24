import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ItemUOMAlternate } from "@/lib/itemUomAlternates";

const BASE_URL = "/api/item-uom-alternates";

interface RawAlternateRow {
  ItemId: string;
  UOMCode: string;
  ConversionFactor: number;
  UOMName?: string;
  Symbol?: string;
}

function toAlternate(row: RawAlternateRow): ItemUOMAlternate {
  return {
    itemId: row.ItemId,
    uomCode: row.UOMCode,
    uomName: row.UOMName,
    symbol: row.Symbol,
    conversionFactor: Number(row.ConversionFactor),
  };
}

/** All alternate UOMs across every item — grouped client-side by itemId. */
export async function getAllItemUomAlternates(): Promise<ItemUOMAlternate[]> {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  const rows: RawAlternateRow[] = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows : []).map(toAlternate);
}

export async function getItemUomAlternates(
  itemId: string,
): Promise<ItemUOMAlternate[]> {
  const res = await fetchWithAuth(`${BASE_URL}/${itemId}`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  const rows: RawAlternateRow[] = await res.json().catch(() => []);
  return (Array.isArray(rows) ? rows : []).map(toAlternate);
}

export async function saveItemUomAlternates(
  itemId: string,
  rows: { UOMCode: string; ConversionFactor: number }[],
): Promise<void> {
  const res = await fetchWithAuth(`${BASE_URL}/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
  }
}
