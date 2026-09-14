// RN port of src/api/supplierPortalApi.ts (web) — same shapes, same
// endpoints, only the fetchWithAuth import path changes (fetchWithAuth
// already sets Content-Type: application/json for non-FormData bodies, so
// the explicit header web sets on every mutating call is redundant here).
import { fetchWithAuth } from "@/services/fetchWithAuth";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SupplierProfile {
  LHeadId: number;
  Name: string;
  LHeadCode?: string;
  LHeadEmail?: string;
  LHeadPhone?: string;
  LHeadAddress?: string;
  LHeadContactPerson?: string;
  LHeadStatus?: string;
  LHeadPaymentTerms?: string;
  LGST?: string;
  LGSTState?: string;
  LCountry?: string;
  LBelongsTo?: string;
  LDescription?: string;
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
  SubmittedAt?: string | null;
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
  CompanyName?: string;
  ProjectName?: string;
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

export interface SupplierOrderSummary {
  PurchaseOrderID: number;
  PurchaseOrderNo: string | null;
  DocNo: string | null;
  PODate: string | null;
  ExpectedDeliveryDate: string | null;
  ItemDescription: string | null;
  Quantity: number | null;
  Unit: string | null;
  TotalAmount: number | null;
  Status: string;
  Remarks: string | null;
  SupplierAcknowledged: boolean;
  SupplierAcknowledgedAt: string | null;
  SuppliedDate: string | null;
  ChallanNumber: string | null;
  POType: string | null;
  SourceMRDocNo: string | null;
  SourceQTDocNo: string | null;
  SourceWDDocNo: string | null;
  SourceLabel: "Direct" | "Material Request" | "Quotation" | "Work Done" | "Work Order";
  CompanyName: string | null;
  ProjectName: string | null;
  CommentCount: number;
}

export interface SupplierOrderDetail extends Omit<SupplierOrderSummary, "CommentCount"> {
  Rate: number | null;
  SubtotalAmount: number | null;
  HsnCode: string | null;
  GstType: string | null;
  GstRate: number | null;
  PaymentTerms: string | null;
  POItems: any[];
}

export interface SupplierGrnItem {
  itemId: number;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string | null;
}

export interface SupplierGrnOrder {
  purchaseOrderId: number;
  purchaseOrderNo: string | null;
  docNo: string | null;
  poDate: string | null;
  status: string;
  companyName: string | null;
  projectName: string | null;
  commentCount: number;
  items: SupplierGrnItem[];
  isFullyReceived: boolean;
  totalRemaining: number;
}

export interface SupplierCreditNote {
  DebitNoteId: number;
  DocNo: string;
  DebitDate: string;
  Status: "Issued" | "Cancelled";
  ItemName: string | null;
  UomName: string | null;
  ReceivedQty: number;
  RejectedQty: number;
  PercentBad: number;
  Rate: number;
  Amount: number;
  Reason: string | null;
  VehicleInOutDocNo: string | null;
  PONumber: string | null;
  VehicleNo: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
}

export interface OrderChatMessage {
  Id: number;
  PurchaseOrderId: number;
  comment: string;
  author_name: string;
  author_id: number | null;
  author_role: string | null;
  created_at: string;
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
    body: JSON.stringify({ items }),
  }).then((r) => handleResponse(r));

export const getSupplierCatalog = () =>
  fetchWithAuth(`${BASE}/catalog`).then((r) => handleResponse<SupplierCatalogItem[]>(r));

export const updateSupplierCatalog = (items: SupplierCatalogPayloadItem[]) =>
  fetchWithAuth(`${BASE}/catalog`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  }).then((r) => handleResponse(r));

export const getSupplierOrders = () =>
  fetchWithAuth(`${BASE}/orders`).then((r) => handleResponse<SupplierOrderSummary[]>(r));

export const getSupplierOrderDetail = (id: number | string) =>
  fetchWithAuth(`${BASE}/orders/${id}`).then((r) => handleResponse<SupplierOrderDetail>(r));

export const acknowledgeSupplierOrder = (
  id: number | string,
  acknowledged: boolean,
  challanNumber?: string,
) =>
  fetchWithAuth(`${BASE}/orders/${id}/acknowledge`, {
    method: "PUT",
    body: JSON.stringify({ acknowledged, challanNumber }),
  }).then((r) => handleResponse<{ ok: boolean; acknowledged: boolean }>(r));

export const getSupplierOrderComments = (id: number | string) =>
  fetchWithAuth(`${BASE}/orders/${id}/comments`).then((r) => handleResponse<OrderChatMessage[]>(r));

export const postSupplierOrderComment = (id: number | string, comment: string) =>
  fetchWithAuth(`${BASE}/orders/${id}/comment`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  }).then((r) => handleResponse<{ comment: OrderChatMessage }>(r));

export const getSupplierGrnSummary = () =>
  fetchWithAuth(`${BASE}/grns`).then((r) => handleResponse<SupplierGrnOrder[]>(r));

export const getSupplierCreditNotes = () =>
  fetchWithAuth(`${BASE}/credit-notes`).then((r) => handleResponse<SupplierCreditNote[]>(r));
