import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/sale-invoices";

export type PaymentStatus = "Pending Payment" | "Paid";

export interface SaleInvoice {
  SaleInvoiceID: number;
  DocNo: string;
  InvoiceDate: string;
  SaleOrderID: number;
  SaleOrderDocNo: string;
  FromCompanyID: number;
  FromCompanyName: string;
  ToCompanyID: number;
  ToCompanyName: string;
  ToProjectID: number;
  ToProjectName: string;
  TotalAmount: number;
  AmountReceived: number;
  PaymentStatus: PaymentStatus;
  HasPurchaseOrder?: boolean;
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface SaleInvoicesResponse {
  data: SaleInvoice[];
  total: number;
  page?: number;
  totalPages?: number;
}

export interface SaleInvoicePurchaseOrderRef {
  PurchaseOrderID: number;
  DocNo: string;
  Status: string;
  TotalAmount: number;
}

export interface SaleInvoiceDetail extends SaleInvoice {
  purchaseOrders?: SaleInvoicePurchaseOrderRef[];
}

export const getSaleInvoices = async (params?: {
  paymentStatus?: PaymentStatus;
  saleOrderId?: number;
  customerId?: number;
  page?: number;
  limit?: number;
}): Promise<SaleInvoicesResponse> => {
  const qs = new URLSearchParams();
  if (params?.paymentStatus) qs.set("paymentStatus", params.paymentStatus);
  if (params?.saleOrderId) qs.set("saleOrderId", String(params.saleOrderId));
  if (params?.customerId) qs.set("customerId", String(params.customerId));
  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch sale invoices: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const getSaleInvoiceById = async (
  id: number,
): Promise<SaleInvoiceDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch sale invoice: ${res.status}`);
  return res.json().catch(() => ({}));
};

// Fully-paid invoices with no Purchase Order created against them yet —
// used by the PO form's "Source Sale Invoice" picker.
export const getPaidSaleInvoicesForPO = async (): Promise<SaleInvoice[]> => {
  const res = await fetchWithAuth(`${BASE}/paid-for-po`);
  if (!res.ok)
    throw new Error(`Failed to fetch payable sale invoices: ${res.status}`);
  return res.json().catch(() => ({}));
};

export interface CreateSaleInvoicePayload {
  SaleOrderID: number;
}

export const createSaleInvoice = async (
  payload: CreateSaleInvoicePayload,
): Promise<{
  SaleInvoiceID: number;
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
    throw new Error(err.error || `Sale invoice failed: ${res.status}`);
  }
  return res.json().catch(() => ({}));
};