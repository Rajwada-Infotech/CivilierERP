import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/purchase-orders";

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PurchaseOrderQuery {
  page?: number;
  limit?: number;
}

const buildUrl = (base: string, params: Record<string, unknown> = {}) => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      qs.set(key, String(value));
    }
  });
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
};

const normalizePaginated = <T>(payload: any): PaginatedResponse<T> => {
  if (Array.isArray(payload)) {
    return {
      data: payload,
      page: 1,
      limit: payload.length,
      total: payload.length,
      totalPages: 1,
    };
  }
  return {
    data: Array.isArray(payload?.data) ? payload.data : [],
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || payload?.data?.length || 0),
    total: Number(payload?.total || payload?.data?.length || 0),
    totalPages: Number(payload?.totalPages || 1),
  };
};

// ─── Purchase Order CRUD ──────────────────────────────────────────────────────
export const getPurchaseOrders = (query: PurchaseOrderQuery = {}) =>
  fetchWithAuth(buildUrl(BASE, query))
    .then((r) => r.json())
    .then(normalizePaginated);

export const addPurchaseOrder = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());

export const updatePurchaseOrder = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());

export const deletePurchaseOrder = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => r.json());

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Returns [{ LHeadId, LHeadName, ... }]
export const getSuppliers = () =>
  fetchWithAuth("/api/account-head?type=S").then((r) => r.json());

// ─── All enterprises (unfiltered) ────────────────────────────────────────────
// The enterprise route GET "/" returns every row.
// Filtering by business_type is done in the component so we don't touch enterprise.js.
// Returns [{ id, name, business_type, belongs_to, ... }]
export const getAllEnterprises = () =>
  fetchWithAuth("/api/enterprises").then((r) => r.json());

// ─── UOM ─────────────────────────────────────────────────────────────────────
// uomMaster.js GET "/" → SELECT Id, UOMName, ... FROM dbo.UOMMaster
// Returns [{ Id, UOMName, UOMCode, Symbol, IsActive, ... }]
export const getUOMs = () =>
  fetchWithAuth("/api/uom-master").then((r) => r.json());