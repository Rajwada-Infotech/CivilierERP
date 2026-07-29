// RN port of the L1 Chart-relevant slice of src/api/quotationApi.ts. The
// full RFQ-creation flow (Quotation.tsx — create/send a tender, tag
// suppliers, print) is NOT ported here; that's a separate page (web's
// Quotation.tsx) this mobile app doesn't have yet. This file covers only
// what L1ChartScreen.tsx needs: list already-sent quotations, fetch the
// items×suppliers comparison matrix, and add/remove tagged suppliers. The
// QT→PO award prefill (QTPOPrefill/getQTPOPrefill) lives in
// purchaseOrdersApi.ts instead, mirroring where MRPOPrefill lives — it
// feeds PurchaseOrderFormModal, not this screen.
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
