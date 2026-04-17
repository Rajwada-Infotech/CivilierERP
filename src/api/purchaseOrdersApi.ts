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

// ─── CRUD Operations ─────────────────────────────────────────────────────────
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

// ─── Dropdown Data ────────────────────────────────────────────────────────────
// Suppliers: AccountHeadMaster entries with LHeadType = 'Supplier'
// Returns { LHeadId, LHeadName }
export const getSuppliers = () =>
  fetchWithAuth("/api/account-head?type=Supplier").then((r) => r.json());

// Projects: enterprise table
// Returns { id, name }
export const getProjects = () =>
  fetchWithAuth("/api/enterprises").then((r) => r.json());

// Keep getCompanies as alias so existing imports don't break
export const getCompanies = getProjects;
