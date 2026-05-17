import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/inventory-master";

export interface InventoryMasterRow {
  ItemID: string;
  ItemName: string | null;
  ItemGroupName: string | null;
  UOMName: string | null;
  UOMCode: string | null;
  UOMSymbol: string | null;
  OpeningStock: number;
  StockIn: number;
  StockOut: number;
  ClosingStock: number;
}

export interface InventoryMasterResponse {
  data: InventoryMasterRow[];
  total: number;
  date: string;
  godownId: number | null;
}

export const getInventoryMaster = async (
  date: string,
  godownId?: number | null,
): Promise<InventoryMasterResponse> => {
  const qs = new URLSearchParams({ date });
  if (godownId != null) qs.set("godownId", String(godownId));
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch inventory: ${res.status}`);
  return res.json();
};
