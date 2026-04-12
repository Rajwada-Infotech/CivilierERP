import { fetchWithAuth } from "@/lib/fetchWithAuth";

// IMPORTANT: Match this with your backend route
const BASE = "/api/purchase-orders"; // ← Changed from purchaseOrders to purchase-orders

// ─── CRUD Operations ─────────────────────────────────────────────────────
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

// ─── Dropdown Data ───────────────────────────────────────────────────────
export const getSuppliers = () =>
  fetchWithAuth("/api/suppliers").then((r) => r.json());

export const getCompanies = () =>
  fetchWithAuth("/api/companies").then((r) => r.json());
