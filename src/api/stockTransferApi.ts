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

export interface StockTransfersResponse {
  data: StockTransfer[];
  total: number;
}

export const getStockTransfers = async (params?: {
  fromGodown?: number;
  toGodown?: number;
  page?: number;
  limit?: number;
}): Promise<StockTransfersResponse> => {
  const qs = new URLSearchParams();
  if (params?.fromGodown) qs.set("fromGodown", String(params.fromGodown));
  if (params?.toGodown) qs.set("toGodown", String(params.toGodown));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch transfers: ${res.status}`);
  return res.json();
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
  return res.json();
};
