import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/stock-updates";

export interface StockUpdateSummary {
  StockUpdateId: number;
  DocNo: string | null;
  UpdateDate: string;
  CompanyId: number;
  CompanyName: string | null;
  ProjectId: number;
  ProjectName: string | null;
  GodownId: number;
  GodownName: string | null;
  Remarks: string | null;
  CreatedBy: string | null;
  CreatedByName: string | null;
  CreatedAt: string;
  ItemCount: number;
  TotalQty: number;
}

export interface StockUpdateItem {
  StockUpdateItemId: number;
  ItemId: string;
  ItemName: string | null;
  UOM: string | null;
  Qty: number;
}

export interface StockUpdateDetail extends StockUpdateSummary {
  items: StockUpdateItem[];
}

export interface StockUpdatePayload {
  UpdateDate: string;
  CompanyId: number;
  ProjectId: number;
  GodownId: number;
  Remarks?: string;
  items: { ItemId: string; UOM: string | null; Qty: number }[];
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error || `HTTP ${res.status}`);
  return body as T;
}

export const getStockUpdates = () => fetchWithAuth(BASE).then((r) => handle<StockUpdateSummary[]>(r));

export const getStockUpdate = (id: number) => fetchWithAuth(`${BASE}/${id}`).then((r) => handle<StockUpdateDetail>(r));

export const createStockUpdate = (payload: StockUpdatePayload) =>
  fetchWithAuth(BASE, { method: "POST", body: JSON.stringify(payload) }).then((r) =>
    handle<{ StockUpdateId: number; DocNo: string; message: string }>(r),
  );
