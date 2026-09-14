import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/sale-orders";

export interface SaleOrderItem {
  itemId: string;
  itemName?: string;
  qty: number;
  uom?: string;
  rate: number;
  amount?: number;
  remarks?: string;
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
  ToCompanyID: number;
  ToCompanyName: string;
  ToProjectID: number;
  ToProjectName: string;
  ToGodownID: number;
  ToGodownName: string;
  SaleItems: SaleOrderItem[];
  TotalAmount: number;
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
  ToCompanyID: number;
  ToProjectID: number;
  ToGodownID: number;
  SaleItems: SaleOrderItem[];
  Remarks?: string;
  OrderDate?: string;
}

export const createSaleOrder = async (
  payload: CreateSaleOrderPayload,
): Promise<{
  SaleOrderID: number;
  DocNo: string;
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
