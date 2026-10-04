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
  CustomerRate?: number | null;
}

export interface InventoryMasterResponse {
  data: InventoryMasterRow[];
  total: number;
  date: string;
  godownId: number | null;
  godownName: string | null;
}

export const getInventoryMaster = async (
  date: string,
  godownId?: number | null,
  dateFrom?: string,
  dateTo?: string,
): Promise<InventoryMasterResponse> => {
  const qs = new URLSearchParams({ date });
  if (godownId != null) qs.set("godownId", String(godownId));
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch inventory: ${res.status}`);
  return res.json().catch(() => ({}));
};

export interface ItemLedgerRow {
  StockID: number;
  Type: "IN" | "OUT";
  RefType: string;
  RefID: number;
  DocNo: string | null;
  Qty: number;
  UOM: string | null;
  MovementDate: string | null;
}

export interface ItemLedgerResponse {
  itemId: string;
  godownId: number | null;
  data: ItemLedgerRow[];
  total: number;
}

export const getItemStockLedger = async (
  itemId: string,
  godownId: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<ItemLedgerResponse> => {
  const qs = new URLSearchParams({ itemId, godownId: String(godownId) });
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  const res = await fetchWithAuth(`${BASE}/item-ledger?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch item ledger: ${res.status}`);
  return res.json().catch(() => ({}));
};
