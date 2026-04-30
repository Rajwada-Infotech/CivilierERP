// ─────────────────────────────────────────────────────────────────────────────
// Purchase Orders API
// ─────────────────────────────────────────────────────────────────────────────

import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface POLineItem {
  itemDescription: string;
  unit: string;
  quantity: number;
  rate: number;
  tax: number;    // percentage, e.g. 18
  amount: number; // computed: qty * rate * (1 + tax/100)
}

export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  ExpectedDeliveryDate: string;
  SupplierID: number;
  SupplierName: string;
  CompanyId: number;
  CompanyName: string;
  ProjectId: number;
  ProjectName: string;
  // Legacy single-item fields (kept for backward compat with GRN etc.)
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Rate?: number;
  TotalAmount?: number;
  // Multi-item field (new)
  POItems?: POLineItem[];
  PaymentTerms: string;
  Status: string;
  Remarks: string;
  DocTypeId?: number;
  DocNo?: string;
  DocTypePrefix?: string;
  DocTypeDescription?: string;
  CreatedBy?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  ApprovedBy?: string;
  ApprovedAt?: string;
}

export interface POListResponse {
  data: PurchaseOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreatePOPayload {
  PurchaseOrderNo?: string;
  PODate?: string;
  ExpectedDeliveryDate?: string;
  SupplierID?: number | string | null;
  CompanyId?: number | string | null;
  ProjectId?: number | string | null;
  // Legacy single-item fields (kept for GRN compatibility)
  ItemDescription?: string | null;
  Quantity?: number | string;
  Unit?: string | null;
  Rate?: number | string;
  TotalAmount?: number | string;
  // Multi-item field (new)
  POItems?: POLineItem[];
  PaymentTerms?: string | null;
  Status?: string;
  Remarks?: string | null;
  DocTypeId?: number | string | null;
  DocNo?: string | null;
  finYear?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute grand total from line items and keep legacy single-item fields
 * in sync so GRN and other downstream modules that read those columns still work.
 */
function enrichPayload(payload: CreatePOPayload): CreatePOPayload {
  const items = payload.POItems ?? [];
  const grandTotal = items.reduce((sum, it) => sum + it.amount, 0);

  return {
    ...payload,
    TotalAmount: grandTotal || payload.TotalAmount,
    // Mirror first item into legacy fields when there is exactly one row
    ...(items.length === 1 && {
      ItemDescription: items[0].itemDescription,
      Quantity: items[0].quantity,
      Unit: items[0].unit,
      Rate: items[0].rate,
    }),
  };
}

// ── API Functions ─────────────────────────────────────────────────────────────

export const getPurchaseOrders = (query: { page?: number; limit?: number } = {}) => {
  const { page = 1, limit = 10 } = query;
  return fetchWithAuth(`/purchase-orders?page=${page}&limit=${limit}`)
    .then((r) => r.json())
    .then((r: any): POListResponse => ({
      data: Array.isArray(r.data) ? r.data : Array.isArray(r) ? r : [],
      page: Number(r.page ?? 1),
      limit: Number(r.limit ?? limit),
      total: Number(r.total ?? 0),
      totalPages: Number(r.totalPages ?? 1),
    }));
};

export const getPurchaseOrderById = (id: number | string): Promise<PurchaseOrder> =>
  fetchWithAuth(`/purchase-orders/${id}`).then((r) => r.json());

export const addPurchaseOrder = (payload: CreatePOPayload) =>
  fetchWithAuth("/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enrichPayload(payload)),
  }).then((r) => r.json());

export const updatePurchaseOrder = (id: number | string, payload: CreatePOPayload) =>
  fetchWithAuth(`/purchase-orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enrichPayload(payload)),
  }).then((r) => r.json());

export const deletePurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}`, { method: "DELETE" }).then((r) => r.json());

export const submitPurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}/submit`, { method: "PUT" }).then((r) => r.json());

export const approvePurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}/approve`, { method: "PUT" }).then((r) => r.json());

export const rejectPurchaseOrder = (id: number | string, note?: string) =>
  fetchWithAuth(`/purchase-orders/${id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  }).then((r) => r.json());

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Returns [{ LHeadId, LHeadName, ... }]
export const getSuppliers = () =>
  fetchWithAuth("/api/account-head?type=S").then((r) => r.json());

// ─── All enterprises (unfiltered) ────────────────────────────────────────────
// Returns [{ id, name, business_type, belongs_to, ... }]
export const getAllEnterprises = () =>
  fetchWithAuth("/api/enterprises").then((r) => r.json());

// ─── UOM ─────────────────────────────────────────────────────────────────────
// Returns [{ Id, UOMName, UOMCode, Symbol, IsActive, ... }]
export const getUOMs = () =>
  fetchWithAuth("/api/uom-master").then((r) => r.json());

