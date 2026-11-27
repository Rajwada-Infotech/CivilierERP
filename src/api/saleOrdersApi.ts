import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/sale-orders";

export interface SaleOrderItem {
  itemId: string;
  itemName?: string;
  qty: number;
  uom?: string;
  rate: number;
  /** GST % on the line (sale to a buyer). */
  gstRate?: number;
  /** qty × rate */
  amount?: number;
  taxAmount?: number;
  /** amount + tax */
  total?: number;
  remarks?: string;
  /** Older orders only. */
  glHeadId?: number | null;
}

export interface SaleOrder {
  SaleOrderID: number;
  DocNo: string;
  OrderDate: string;
  FromCompanyID: number;
  FromCompanyName: string;
  FromProjectID: number;
  FromProjectName: string;
  FromGodownID: number;
  FromGodownName: string;
  /** Older transfer orders only — a sale to a buyer has no To side. */
  ToCompanyID: number | null;
  ToCompanyName: string | null;
  ToProjectID: number | null;
  ToProjectName: string | null;
  ToGodownID: number | null;
  ToGodownName: string | null;
  /** The buyer: any ledger head (the Journal Voucher's list). */
  BuyerLHeadId: number | null;
  BuyerName: string | null;
  SaleItems: SaleOrderItem[];
  BasicAmount: number | null;
  TaxAmount: number | null;
  /** Grand total incl. GST. */
  TotalAmount: number;
  /** Posted to the ledger on approval (Dr buyer / Cr Sales / Cr GST Output). */
  GLPosted?: boolean;
  Remarks: string | null;
  Status: string;
  PostedToStock?: boolean;
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface SaleOrdersResponse {
  data: SaleOrder[];
  total: number;
}

export const getSaleOrders = async (params?: {
  fromCompany?: number;
  toCompany?: number;
  fromProject?: number;
  toProject?: number;
  page?: number;
  limit?: number;
}): Promise<SaleOrdersResponse> => {
  const qs = new URLSearchParams();
  if (params?.fromCompany) qs.set("fromCompany", String(params.fromCompany));
  if (params?.toCompany) qs.set("toCompany", String(params.toCompany));
  if (params?.fromProject) qs.set("fromProject", String(params.fromProject));
  if (params?.toProject) qs.set("toProject", String(params.toProject));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch sale orders: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const getSaleOrderById = async (id: number): Promise<SaleOrder> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch sale order: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const deleteSaleOrder = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to delete sale order: ${res.status}`);
  }
  return res.json().catch(() => ({}));
};

export interface CreateSaleOrderPayload {
  FromCompanyID: number;
  FromProjectID: number;
  FromGodownID: number;
  BuyerLHeadId: number;
  SaleItems: SaleOrderItem[];
  Remarks?: string;
  OrderDate?: string;
}

export const createSaleOrder = async (
  payload: CreateSaleOrderPayload,
): Promise<{
  SaleOrderID: number;
  DocNo: string;
  BasicAmount: number;
  TaxAmount: number;
  TotalAmount: number;
  message: string;
}> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Sale order failed: ${res.status}`);
  }
  return res.json().catch(() => ({}));
};

/** The ledger entry for a sale: the legs posted on approval, or a preview of what approval will post. */
export interface SaleOrderPosting {
  state: "posted" | "preview" | "rejected" | "none";
  reason?: string;
  voucherNo?: string;
  voucherDate?: string | null;
  rows: { label: string; side: "debit" | "credit"; amount: number; narration?: string | null }[];
}

export const getSaleOrderPosting = async (id: number): Promise<SaleOrderPosting> => {
  const res = await fetchWithAuth(`${BASE}/${id}/posting`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load the posting: ${res.status}`);
  }
  return res.json();
};
