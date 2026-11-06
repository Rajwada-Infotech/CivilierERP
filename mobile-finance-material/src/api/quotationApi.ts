// RN port of src/api/quotationApi.ts: the quotation (RFQ) register, one quotation, create / update / delete / send,
// per-supplier payment terms, and what L1ChartScreen needs (the items x suppliers matrix, add / remove suppliers).
// The QT -> PO award prefill (getQTPOPrefill) lives in purchaseOrdersApi.ts, beside MRPOPrefill, since it feeds the
// purchase order form.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch { /* keep status message */ }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

const BASE = "/api/quotations";

export interface QuotationSupplier {
  Id: number;
  SupplierLHeadId: number;
  SupplierName: string;
  Status: "Pending" | "Submitted";
  InvitedAt: string;
  PaymentTermId?: number | null;
  PaymentTermName?: string | null;
  PaymentTermDays?: number | null;
}

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

export interface CreateQuotationPayload {
  CompanyId?: number | null;
  ProjectId?: number | null;
  FinYearId?: number | null;
  SourceMRId?: number | null;
  SourceMRDocNo?: string | null;
  DocDate?: string;
  DueDate?: string | null;
  Remarks?: string | null;
  TermsConditionIds?: (number | string)[];
  items: QuotationLineItem[];
  supplierLHeadIds: (number | string)[];
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
  CompanyName?: string;
  ProjectName?: string;
  FinYearName?: string;
  ItemCount?: number;
  SupplierCount?: number;
  SubmittedCount?: number;
  CreatedBy?: string;
  CreatedAt?: string;
  TermsConditionIds?: string;
  items?: QuotationLineItem[];
  suppliers?: QuotationSupplier[];
}

export const getQuotations = (query: { companyId?: string; projectId?: string; finYearId?: string; status?: string } = {}) => {
  const qs = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return fetchWithAuth(`${BASE}?${qs}`).then((r) => handleResponse<any>(r)).then((r) => (Array.isArray(r) ? r : r?.data ?? []) as Quotation[]);
};

export interface L1ChartItem {
  QuotationItemId: number;
  ItemId: string;
  ItemName: string;
  UOMCode: string;
  UOMName: string;
  Quantity: number;
}

export interface L1ChartPrice {
  QuotationItemId: number;
  SupplierLHeadId: number;
  Rate: number;
  SupplyDate: string | null;
  Quality: string | null;
}

export interface L1ChartData {
  items: L1ChartItem[];
  suppliers: QuotationSupplier[];
  prices: L1ChartPrice[];
}

export const getL1ChartData = (quotationId: number | string) =>
  fetchWithAuth(`${BASE}/${quotationId}/l1-chart`).then((r) => handleResponse<L1ChartData>(r));

export const addQuotationSuppliers = (quotationId: number | string, supplierLHeadIds: (number | string)[]) =>
  fetchWithAuth(`${BASE}/${quotationId}/suppliers`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplierLHeadIds }),
  }).then((r) => handleResponse(r));

export const removeQuotationSupplier = (quotationId: number | string, supplierId: number | string) =>
  fetchWithAuth(`${BASE}/${quotationId}/suppliers/${supplierId}`, { method: "DELETE" }).then((r) => handleResponse(r));

const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const getQuotationById = (id: number | string) => fetchWithAuth(`${BASE}/${id}`).then((r) => handleResponse<Quotation>(r));
export const createQuotation = (payload: CreateQuotationPayload) => fetchWithAuth(BASE, { method: "POST", ...json(payload) }).then((r) => handleResponse<Quotation>(r));
export const updateQuotation = (id: number | string, payload: CreateQuotationPayload) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "PUT", ...json(payload) }).then((r) => handleResponse<Quotation>(r));
export const deleteQuotation = (id: number | string) => fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handleResponse(r));
export const sendQuotation = (id: number | string) => fetchWithAuth(`${BASE}/${id}/send`, { method: "POST" }).then((r) => handleResponse(r));
export const setSupplierPaymentTerm = (id: number | string, supplierId: number | string, PaymentTermId: number | null) =>
  fetchWithAuth(`${BASE}/${id}/suppliers/${supplierId}/payment-term`, { method: "PUT", ...json({ PaymentTermId }) }).then((r) => handleResponse(r));

/** The Payment Terms master (Finance Setup): one is picked per tagged supplier; the PO raised for them starts with it. */
export const getPaymentTermOptions = () =>
  fetchWithAuth("/api/payment-terms/options").then((r) => handleResponse<{ id: number; label: string; days: number }[]>(r)).then((r) => (Array.isArray(r) ? r : []));
