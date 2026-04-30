import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/stock-ledger";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StockLedgerEntry {
  StockID: number;
  ItemID: string;
  ItemName: string | null;
  ItemGroupName: string | null;
  Qty: number;
  Type: "IN" | "OUT";
  // Qty signed: positive for IN, negative for OUT
  SignedQty: number;
  UOM: string | null;
  UOMName: string | null;
  UOMSymbol: string | null;
  RefType: string | null;
  RefID: number | null;
  GRNNo: string | null;
  GRNDate: string | null;
  PurchaseOrderNo: string | null;
  LedgerDate: string | null;
}

export interface StockLedgerSummary {
  stockIn: number;
  stockOut: number;
  balance: number;
  transactionCount: number;
}

export interface StockLedgerByItem {
  ItemID: string;
  ItemName: string | null;
  ItemGroupName: string | null;
  UOM: string | null;
  UOMName: string | null;
  UOMSymbol: string | null;
  stockIn: number;
  stockOut: number;
  balance: number;
}

export interface StockLedgerFilters {
  itemId?: string | number;
  type?: "IN" | "OUT";
  refType?: string;
  refId?: number;
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string;   // YYYY-MM-DD
  search?: string;
}

export interface StockLedgerResponse {
  data: StockLedgerEntry[];
  summary: StockLedgerSummary;
  byItem: StockLedgerByItem[];
  balance: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  filters: StockLedgerFilters;
}

// ─── GET STOCK LEDGER (paginated, filterable) ────────────────────────────────
export const getStockLedger = async (
  params: StockLedgerFilters & { page?: number; limit?: number } = {},
): Promise<StockLedgerResponse> => {
  const qs = new URLSearchParams();

  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.itemId) qs.set("itemId", String(params.itemId));
  if (params.type) qs.set("type", params.type);
  if (params.refType) qs.set("refType", params.refType);
  if (params.refId) qs.set("refId", String(params.refId));
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.search?.trim()) qs.set("search", params.search.trim());

  const res = await fetchWithAuth(`${BASE}?${qs.toString()}`);
  return handleResponse<StockLedgerResponse>(res);
};
