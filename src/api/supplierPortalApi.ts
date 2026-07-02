// src/api/supplierPortalApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SupplierProfile {
  LHeadId: number;
  Name: string;
  LHeadCode?: string;
  LHeadEmail?: string;
  LHeadPhone?: string;
  LHeadAddress?: string;
  LHeadContactPerson?: string;
}

export interface SupplierQuotationSummary {
  QuotationId: number;
  DocNo: string;
  QuotationStatus: string;
  DocDate: string;
  DueDate?: string;
  Remarks?: string;
  CompanyName?: string;
  ProjectName?: string;
  MySubmissionStatus: "Pending" | "Submitted";
  InvitedAt: string;
  ItemCount: number;
}

export interface SupplierQuotationItem {
  QuotationItemId: number;
  ItemId: string;
  ItemName: string;
  UOMCode: string;
  UOMName: string;
  Quantity: number;
  Remarks?: string;
  Rate: number | null;
  SupplyDate: string | null;
  Quality: string | null;
}

export interface SupplierQuotationDetail {
  QuotationId: number;
  DocNo: string;
  Status: string;
  DocDate: string;
  DueDate?: string;
  Remarks?: string;
  MySubmissionStatus: "Pending" | "Submitted";
  items: SupplierQuotationItem[];
}

export interface SupplierPricePayloadItem {
  QuotationItemId: number;
  Rate: number;
  SupplyDate?: string | null;
  Quality?: string | null;
}

export interface SupplierCatalogItem {
  ItemId: string;
  ItemName: string;
  UOMCode: string | null;
  UOMName: string | null;
  Rate: number | null;
  SupplyLeadTime: string | null;
  Quality: string | null;
  UpdatedAt: string | null;
}

export interface SupplierCatalogPayloadItem {
  ItemId: string;
  ItemName?: string;
  UOMCode?: string;
  Rate: number;
  SupplyLeadTime?: string;
  Quality?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const BASE = "/api/supplier-portal";

// ── API ────────────────────────────────────────────────────────────────────────

export const getSupplierProfile = () =>
  fetchWithAuth(`${BASE}/me`).then((r) => handleResponse<SupplierProfile>(r));

export const getSupplierQuotations = () =>
  fetchWithAuth(`${BASE}/quotations`).then((r) =>
    handleResponse<SupplierQuotationSummary[]>(r),
  );

export const getSupplierQuotationDetail = (id: number | string) =>
  fetchWithAuth(`${BASE}/quotations/${id}`).then((r) =>
    handleResponse<SupplierQuotationDetail>(r),
  );

export const submitSupplierPrices = (
  id: number | string,
  items: SupplierPricePayloadItem[],
) =>
  fetchWithAuth(`${BASE}/quotations/${id}/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).then((r) => handleResponse(r));

export const getSupplierCatalog = () =>
  fetchWithAuth(`${BASE}/catalog`).then((r) => handleResponse<SupplierCatalogItem[]>(r));

export const updateSupplierCatalog = (items: SupplierCatalogPayloadItem[]) =>
  fetchWithAuth(`${BASE}/catalog`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  }).then((r) => handleResponse(r));
