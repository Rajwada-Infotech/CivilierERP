// RN port of src/api/stockTransferApi.ts. Deliberately create-only — the
// backend has no PUT/DELETE/submit/approve/reject route for StockTransfers
// at all (confirmed via backend/routes/stockTransfers.js): a transfer posts
// StockLedger OUT (source) + IN (destination) atomically at creation and
// is inserted as Status='Completed' immediately, no Draft/Pending state
// ever exists. So unlike Material Issues/Issue Return there is no edit or
// delete UI to build here — this is intentionally simpler, not trimmed.
// Company/project/godown master data and the item-by-godown stock lookup
// are NOT duplicated here — web itself reuses the generic /api/godowns and
// /api/inventory-master endpoints for this page (filtered client-side to
// ClosingStock > 0), and mobile already has both in stockApi.ts.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/stock-transfers";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

export interface TransferItem {
  itemId: string;
  itemName?: string;
  qty: number;
  uom?: string;
  remarks?: string;
}

export interface StockTransfer {
  TransferID: number;
  DocNo: string;
  TransferDate: string;
  FromGodownID: number;
  FromGodownName: string;
  ToGodownID: number;
  ToGodownName: string;
  TransferItems: TransferItem[];
  Remarks: string | null;
  Status: string;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface StockTransfersResponse {
  data: StockTransfer[];
  total: number;
}

export const getStockTransfers = async (params: { fromGodown?: number; toGodown?: number; page?: number; limit?: number } = {}): Promise<StockTransfersResponse> => {
  const qs = new URLSearchParams();
  if (params.fromGodown) qs.set("fromGodown", String(params.fromGodown));
  if (params.toGodown) qs.set("toGodown", String(params.toGodown));
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch stock transfers"));
  return res.json().catch(() => ({ data: [], total: 0 }));
};

export const getStockTransferById = async (id: number | string): Promise<StockTransfer> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch stock transfer"));
  return res.json().catch(() => ({}));
};

export interface CreateTransferPayload {
  FromGodownID: number;
  ToGodownID: number;
  TransferItems: TransferItem[];
  Remarks?: string;
  TransferDate?: string;
}

export const createStockTransfer = async (payload: CreateTransferPayload): Promise<{ TransferID: number; DocNo: string; message: string }> => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Transfer failed"));
  return res.json().catch(() => ({}));
};
