// RN port of src/api/stockLedgerApi.ts — a real, working, paginated
// transaction-history endpoint (backend/routes/stockLedger.js) that the web
// app built but never wired into any page. mobile exposes it as a drill-
// down from StockScreen (per item and/or godown), since it's genuinely
// useful and the backend already supports it — this is net-new UI, not a
// straight port, so keep it scoped to what the backend actually returns
// rather than inventing fields (e.g. there's no per-row running balance,
// only a per-line signed qty and an overall summary balance).
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error ?? body?.message ?? message;
    } catch { /* keep status message */ }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

const BASE = "/api/stock-ledger";

export interface StockLedgerEntry {
  StockID: number;
  ItemID: string;
  ItemName: string | null;
  ItemGroupName: string | null;
  Qty: number;
  Type: "IN" | "OUT";
  SignedQty: number;
  UOM: string | null;
  UOMName: string | null;
  UOMSymbol: string | null;
  GodownID: number | null;
  GodownName: string | null;
  RefType: string | null;
  RefID: number | null;
  DocNo: string | null;
  GRNNo: string | null;
  GRNDate: string | null;
  PurchaseOrderNo: string | null;
  IssueNo: string | null;
  LedgerDate: string | null;
}

export interface StockLedgerSummary {
  stockIn: number;
  stockOut: number;
  balance: number;
  transactionCount: number;
}

export interface StockLedgerGodownOption {
  GodownID: number;
  GodownName: string;
  GodownCode: string | null;
  IsMain: boolean;
}

export interface StockLedgerFilters {
  itemId?: string | number;
  type?: "IN" | "OUT";
  refType?: string;
  refId?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  godownId?: number | string;
}

export interface StockLedgerResponse {
  data: StockLedgerEntry[];
  summary: StockLedgerSummary;
  godowns: StockLedgerGodownOption[];
  balance: number;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const getStockLedger = (params: StockLedgerFilters & { page?: number; limit?: number } = {}) => {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.itemId != null) qs.set("itemId", String(params.itemId));
  if (params.type) qs.set("type", params.type);
  if (params.refType) qs.set("refType", params.refType);
  if (params.refId != null) qs.set("refId", String(params.refId));
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.search?.trim()) qs.set("search", params.search.trim());
  if (params.godownId != null) qs.set("godownId", String(params.godownId));
  return fetchWithAuth(`${BASE}?${qs.toString()}`).then((r) => handleResponse<StockLedgerResponse>(r));
};

export const REF_TYPE_LABEL: Record<string, string> = {
  GRN: "GRN",
  ISS: "Material Issue",
  IRN: "Issue Return",
  PO: "Purchase Order",
};
