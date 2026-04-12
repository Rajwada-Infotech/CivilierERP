import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/purchase-orders";

// ─── CRUD Operations ─────────────────────────────────────────────────────────
export const getPurchaseOrders = () =>
  fetchWithAuth(BASE).then((r) => r.json());

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
