// src/api/quotationApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface QuotationLineItem {
  QuotationItemId?: number;
  MRItemId?: number | null;
  ItemId: string;
  ItemName?: string;
  UOMCode?: string;
  UOMName?: string;
  Quantity: number;
  Remarks?: string;
}

export interface QuotationSupplier {
  Id: number;
  SupplierLHeadId: number;
  SupplierName: string;
  Status: "Pending" | "Submitted";
  InvitedAt: string;
}

export interface Quotation {
  QuotationId: number;
  DocNo?: string;
  Status: string;
  DocDate: string;
  DueDate?: string;
  CompanyId?: number;
  ProjectId?: number;
  FinYearId?: number;
  SourceMRId?: number;
  SourceMRDocNo?: string;
  Remarks?: string;
  TermsConditionIds?: string;
  CompanyName?: string;
  ProjectName?: string;
  FinYearName?: string;
  ItemCount?: number;
  SupplierCount?: number;
  SubmittedCount?: number;
  CreatedBy?: string;
  CreatedAt?: string;
  items?: QuotationLineItem[];
  suppliers?: QuotationSupplier[];
}

export interface CreateQuotationPayload {
  CompanyId?: number | string | null;
  ProjectId?: number | string | null;
  FinYearId?: number | string | null;
  SourceMRId?: number | string | null;
  SourceMRDocNo?: string | null;
  DocDate?: string;
  DueDate?: string | null;
  Remarks?: string | null;
  TermsConditionIds?: (number | string)[];
  items: QuotationLineItem[];
  supplierLHeadIds: (number | string)[];
}

export interface L1ChartData {
  items: {
    QuotationItemId: number;
    ItemId: string;
    ItemName: string;
    UOMCode: string;
    UOMName: string;
    Quantity: number;
  }[];
  suppliers: {
    SupplierLHeadId: number;
    SupplierName: string;
    Status: "Pending" | "Submitted";
  }[];
  prices: {
    QuotationItemId: number;
    SupplierLHeadId: number;
    Rate: number;
    SupplyDate: string | null;
    Quality: string | null;
  }[];
}

export interface QTPOPrefillItem {
  QuotationItemId: number;
  ItemId: string;
  ItemName: string;
  UOMCode: string;
  UOMName: string;
  Quantity: number;
  Remarks?: string;
  M_CGST: number | null;
  M_SGST: number | null;
  M_IGST: number | null;
  Rate: number | null;
  SupplyDate: string | null;
  Quality: string | null;
}

export interface QTPOPrefill {
  QuotationId: number;
  DocNo: string;
  CompanyId: number | null;
  CompanyName: string;
  ProjectId: number | null;
  ProjectName: string;
  FinYearId: number | null;
  Remarks: string;
  SupplierId: number;
  SupplierName: string | null;
  SourceMRId?: number | null;
  SourceMRDocNo?: string | null;
  items: QTPOPrefillItem[];
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

const BASE = "/api/quotations";

// ── API ────────────────────────────────────────────────────────────────────────

export const getQuotations = (
  query: {
    companyId?: string;
    projectId?: string;
    finYearId?: string;
    status?: string;
  } = {},
) => {
  const qs = new URLSearchParams();
  if (query.companyId) qs.set("companyId", query.companyId);
  if (query.projectId) qs.set("projectId", query.projectId);
  if (query.finYearId) qs.set("finYearId", query.finYearId);
  if (query.status) qs.set("status", query.status);
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return fetchWithAuth(`${BASE}${q}`).then((r) => handleResponse<Quotation[]>(r));
};

export const getQuotationById = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`).then((r) => handleResponse<Quotation>(r));

export const createQuotation = (payload: CreateQuotationPayload) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const updateQuotation = (
  id: number | string,
  payload: CreateQuotationPayload,
) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export const deleteQuotation = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handleResponse(r));

export const sendQuotation = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/send`, { method: "POST" }).then((r) => handleResponse(r));

export const addQuotationSuppliers = (
  id: number | string,
  supplierLHeadIds: (number | string)[],
) =>
  fetchWithAuth(`${BASE}/${id}/suppliers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ supplierLHeadIds }),
  }).then((r) => handleResponse(r));

export const removeQuotationSupplier = (id: number | string, supplierId: number | string) =>
  fetchWithAuth(`${BASE}/${id}/suppliers/${supplierId}`, { method: "DELETE" }).then((r) =>
    handleResponse(r),
  );

export const getL1ChartData = (id: number | string) =>
  fetchWithAuth(`${BASE}/${id}/l1-chart`).then((r) => handleResponse<L1ChartData>(r));

export const getQTPOPrefill = (id: number | string, supplierId: number | string) =>
  fetchWithAuth(`${BASE}/${id}/po-prefill?supplierId=${supplierId}`).then((r) =>
    handleResponse<QTPOPrefill>(r),
  );
