import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/inventory-master";

export interface InventoryMasterRow {
  AcquiringDate: string;
  ItemID: string;
  ItemName: string;
  ItemGroupName: string | null;
  UOMID: number | null;
  UOMName: string | null;
  UOMCode: string | null;
  UOMSymbol: string | null;
  OpeningStock: number;
  StockIn: number;
  StockOut: number;
  ClosingStock: number;
}

export interface InventoryMasterResponse {
  date: string;
  data: InventoryMasterRow[];
  total: number;
}

export const getInventoryMaster = async (
  date?: string
): Promise<InventoryMasterResponse> => {
  const params = date ? `?date=${date}` : "";
  const res = await fetchWithAuth(`${BASE_URL}${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `GET failed: ${res.status}`);
  }
  return res.json();
};

export const bustInventoryMasterCache = async () => {
  const res = await fetchWithAuth(`${BASE_URL}/cache-bust`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Cache bust failed");
  }
  return res.json();
};
