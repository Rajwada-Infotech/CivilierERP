import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/stock-transfers";

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

export const getStockTransferById = async (
  id: number,
): Promise<StockTransfer> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch transfer: ${res.status}`);
  return res.json().catch(() => ({}));
};

export interface CreateTransferPayload {
  FromGodownID: number;
  ToGodownID: number;
  TransferItems: TransferItem[];
  Remarks?: string;
  TransferDate?: string;
}

export const createStockTransfer = async (
  payload: CreateTransferPayload,
): Promise<{ TransferID: number; DocNo: string; message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Transfer failed: ${res.status}`);
  }
  return res.json().catch(() => ({}));
};

// Transfer History tab: stock transfers and inter-company transfers together, newest first, one page at a time
// (GET /api/stock-transfers/history). `ictTotal` is across all pages.
export type TransferHistoryRow =
  | { kind: "plain"; data: StockTransfer }
  | { kind: "ict"; data: import("./interCompanyTransferApi").InterCompanyTransferSummary };

export const getTransferHistory = async (params: { page: number; limit: number }): Promise<{
  data: TransferHistoryRow[];
  total: number;
  plainTotal: number;
  ictTotal: number;
}> => {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  const res = await fetchWithAuth(`${BASE}/history?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch transfer history: ${res.status}`);
  return res.json();
};
