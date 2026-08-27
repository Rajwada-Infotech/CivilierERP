// RN port of src/api/purchaseOrdersApi.ts + the master-data fetchers,
// GST-split resolver, and UOM-conversion engine inlined in
// src/pages/material/PurchaseOrderMaster.tsx (5,095 lines — the largest
// page in the whole Material module). Scope for mobile (agreed with user):
// Direct + From-MR + From-Quotation (L1 Chart award) creation; Work Order/
// Work Design prefills still need those source pages on mobile first — not
// there yet. The GST/UOM engine IS replicated faithfully since it's core to
// correctness, not polish. Header-level Discount/GST config on
// CreatePOPayload is vestigial on web itself (never set by the page's own
// toPayload()) — not ported.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch {
      /* keep the status code message */
    }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

function ensureArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
  }
  return [];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface POLineItemPayload {
  itemId: string | null;
  itemDescription: string;
  description: string | null;
  unit: string;
  uomId: number | null;
  quantity: number;
  rate: number;
  tax: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  gstType: "igst" | "cgst_sgst";
  amount: number;
  mrItemId: number | null;
}

export interface CreatePOPayload {
  PurchaseOrderNo?: string | null;
  PODate?: string | null;
  ExpectedDeliveryDate?: string | null;
  SupplierID?: number | null;
  CompanyId?: number | null;
  ProjectId?: number | null;
  ItemDescription?: string | null;
  Quantity?: number;
  Unit?: string | null;
  Rate?: number;
  TotalAmount?: number;
  POItems?: POLineItemPayload[];
  PaymentTerms?: string | null;
  Status?: string;
  Remarks?: string | null;
  CostCenterId?: number | null;
  DocTypeId?: number | null;
  DocNo?: string | null;
  finYear?: string | null;
  SourceMRId?: number | null;
  SourceMRDocNo?: string | null;
  SourceQTId?: number | null;
  SourceQTDocNo?: string | null;
  POType?: "Normal" | "Direct" | "WO_PO" | "QPO";
}

export interface PODbLineItem {
  POItemId?: number;
  ItemId?: string | null;
  ItemName?: string | null;
  Description?: string | null;
  UomName?: string | null;
  Quantity?: number;
  Rate?: number;
  TaxPct?: number;
  LineAmount?: number;
  ReceivedQty?: number | null;
}

export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  ExpectedDeliveryDate: string | null;
  SupplierID: number | null;
  SupplierName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CostCenterId?: number | null;
  CostCenterName?: string | null;
  TotalAmount: number | null;
  POItems?: PODbLineItem[];
  PaymentTerms: string | null;
  Status: string;
  Remarks: string | null;
  DocNo?: string | null;
  SourceMRId?: number | null;
  SourceMRDocNo?: string | null;
  SourceWODocNo?: string | null;
  SourceWDDocNo?: string | null;
  SourceQTId?: number | null;
  SourceQTDocNo?: string | null;
  POType?: "Normal" | "Direct" | "WO_PO" | "QPO";
}

export interface POListResponse {
  data: PurchaseOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── PO CRUD ────────────────────────────────────────────────────────────────

export const getPurchaseOrders = (query: {
  page?: number;
  limit?: number;
  poType?: string;
} = {}) => {
  const { page = 1, limit = 15, poType } = query;
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (poType) params.set("poType", poType);
  return fetchWithAuth(`/api/purchase-orders?${params}`)
    .then((r) => handleResponse<any>(r))
    .then((r: any): POListResponse => {
      const data = Array.isArray(r.data) ? r.data : Array.isArray(r) ? r : null;
      if (!data) throw new Error(r?.error ?? r?.message ?? "Unexpected response from server");
      return {
        data, page: Number(r.page ?? 1), limit: Number(r.limit ?? limit),
        total: Number(r.total ?? 0), totalPages: Number(r.totalPages ?? 1),
      };
    });
};

export const getPurchaseOrderById = (id: number | string): Promise<PurchaseOrder> =>
  fetchWithAuth(`/api/purchase-orders/${id}`).then((r) => handleResponse<PurchaseOrder>(r));

export const addPurchaseOrder = (payload: CreatePOPayload) =>
  fetchWithAuth("/api/purchase-orders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).then((r) => handleResponse<{ PurchaseOrderID: number; PurchaseOrderNo: string }>(r));

export const updatePurchaseOrder = (id: number | string, payload: CreatePOPayload) =>
  fetchWithAuth(`/api/purchase-orders/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }).then((r) => handleResponse(r));

export interface CanDeleteResult {
  canDelete: boolean;
  reason?: string;
  grns?: { grnId: number; grnNo: string; status: string }[];
  expenseBookings?: { id: number; docNo: string; status: string }[];
}

export const canDeletePurchaseOrder = (id: number | string): Promise<CanDeleteResult> =>
  fetchWithAuth(`/api/purchase-orders/${id}/can-delete`).then((r) => handleResponse<CanDeleteResult>(r));

export const deletePurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/api/purchase-orders/${id}`, { method: "DELETE" }).then((r) => handleResponse(r));

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string }

export const getSuppliers = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/account-head?type=S").then((r) => handleResponse<any>(r));
  return ensureArray<any>(raw).map((s) => ({ id: String(s.LHeadId), name: s.LHeadName ?? "" }));
};

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => handleResponse<any>(r));
  return ensureArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export interface ProjectOption extends NameOption { companyId: string | null }

export const getProjects = async (): Promise<ProjectOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => handleResponse<any>(r));
  return ensureArray<any>(raw).map((p) => ({
    id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null,
  }));
};

export interface UOMOption {
  id: number; name: string; code: string; category: string | null; baseFactor: number;
}

export const getUOMs = async (): Promise<UOMOption[]> => {
  const raw = await fetchWithAuth("/api/uom-master").then((r) => handleResponse<any>(r));
  return ensureArray<any>(raw)
    .filter((u) => u.IsActive !== false && u.IsActive !== 0)
    .map((u) => ({
      id: Number(u.Id), name: u.UOMName ?? "", code: String(u.UOMCode ?? "").trim(),
      category: (u.UOMCategory ?? null) as string | null, baseFactor: Number(u.BaseFactor) || 1,
    }))
    .filter((u) => u.name !== "");
};

export interface POItemOption { id: string; name: string; gstRate: number; hsnCode: string | null }

export const getItemsWithGST = async (): Promise<POItemOption[]> => {
  const raw = await fetchWithAuth("/api/work-orders/meta/items").then((r) => handleResponse<any[]>(r));
  return (Array.isArray(raw) ? raw : []).map((i) => ({
    id: String(i.id), name: String(i.name), gstRate: Number(i.gstRate ?? 0), hsnCode: i.hsnCode ?? null,
  }));
};

export interface ItemMasterRow {
  id: string; name: string; description: string; uom: string; itemType: string;
  cgst: number; sgst: number; igst: number; resolvedGstRate: number | null;
}

export const getItemMaster = async (): Promise<Omit<ItemMasterRow, "resolvedGstRate">[]> => {
  const raw = await fetchWithAuth("/api/item-master").then((r) => handleResponse<any>(r));
  return ensureArray<any>(raw).map((i) => ({
    id: i.M_Id, name: i.M_Name, description: i.M_Description ?? "", uom: i.M_UOM ?? "", itemType: i.M_Type ?? "",
    cgst: Number(i.M_CGST ?? 0), sgst: Number(i.M_SGST ?? 0), igst: Number(i.M_IGST ?? 0),
  }));
};

export interface ItemUOMAlternate {
  itemId: string; uomCode: string; uomName?: string; symbol?: string; conversionFactor: number;
}

export const getAllItemUomAlternates = async (): Promise<ItemUOMAlternate[]> => {
  const rows: any[] = await fetchWithAuth("/api/item-uom-alternates").then((r) => handleResponse<any[]>(r));
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    itemId: row.ItemId, uomCode: row.UOMCode, uomName: row.UOMName, symbol: row.Symbol,
    conversionFactor: Number(row.ConversionFactor),
  }));
};

export interface SupplierDetails {
  LHeadId: number; LHeadName: string; LHeadAddress: string | null; LHeadContactPerson: string | null;
  LGST: string | null; LGSTState: string | null; LHeadPhone: string | null; LHeadEmail: string | null;
}

export const getSupplierDetails = (id: string | number): Promise<SupplierDetails | null> =>
  fetchWithAuth(`/api/account-head/${id}`).then((r) => handleResponse<any>(r)).then((data) => {
    if (!data) return null;
    return {
      LHeadId: data.LHeadId, LHeadName: data.LHeadName ?? "", LHeadAddress: data.LHeadAddress ?? null,
      LHeadContactPerson: data.LHeadContactPerson ?? null, LGST: data.LGST ?? null, LGSTState: data.LGSTState ?? null,
      LHeadPhone: data.LHeadPhone ?? null, LHeadEmail: data.LHeadEmail ?? null,
    };
  }).catch(() => null);

export interface CompanyDetails {
  id: number; name: string; address: string | null; city: string | null; state: string | null;
  gst_no: string | null; email: string | null; phone_number: string | null;
}

export const getCompanyDetails = (id: string | number): Promise<CompanyDetails | null> =>
  fetchWithAuth(`/api/enterprises/by-id/${id}`).then((r) => handleResponse<any>(r)).then((data) => {
    if (!data) return null;
    return {
      id: data.id, name: data.name ?? "", address: data.address ?? null, city: data.city ?? null,
      state: data.state ?? null, gst_no: data.gst_no ?? null, email: data.email ?? null, phone_number: data.phone_number ?? null,
    };
  }).catch(() => null);

export const getCostCenterOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/cost-center/options");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => (r.FStatus === 1 || r.FStatus === true) && !r.FLocked)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

// Doc-type numbering — same endpoints as ReceivedPayment/Contract's ports.
export async function fetchDocTypes(module?: string): Promise<{ TypeOfDocId: number; DocNoPrefix?: string; FullPrefix?: string; Prefix?: string }[]> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  const res = await fetchWithAuth(`/api/document-type${qs}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

export async function fetchNextDocNumber(docTypeId: number, finYear?: string): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`/api/document-type/${docTypeId}/next-number${qs}`);
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.nextDocNo ?? "";
}

// ─── Material Request → PO prefill ──────────────────────────────────────────

export interface MRPOPrefillItem {
  MRItemId: number; ItemId: string; ItemName: string; UOMCode: string; UOMName: string;
  Quantity: number; OrderedQty: number; PendingQty: number;
  M_CGST: number | null; M_SGST: number | null; M_IGST: number | null;
}

export interface MRPOPrefill {
  MRId: number; DocNo: string; CompanyId: number | null; ProjectId: number | null;
  FinYearId: number | null; Remarks: string; items: MRPOPrefillItem[];
}

export interface ApprovedMRSummary {
  MRId: number; DocNo: string; ProjectName: string | null;
}

export const getApprovedMRList = (params?: { companyId?: string; projectId?: string }) => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", params.companyId);
  if (params?.projectId) qs.set("projectId", params.projectId);
  const query = qs.toString() ? `?${qs}` : "";
  return fetchWithAuth(`/api/material-requests/approved-list${query}`).then((r) => handleResponse<ApprovedMRSummary[]>(r));
};

export const getMRPOPrefill = (id: number | string) =>
  fetchWithAuth(`/api/material-requests/${id}/create-po-prefill`).then((r) => handleResponse<MRPOPrefill>(r));

// ─── Quotation (L1 Chart award) → PO prefill ────────────────────────────────
// Unlike MR prefill, this carries a chosen supplier's quoted Rate per line
// (and the GST fields needed to resolve cgst/sgst/igst the same way any
// other line item does) — the winning bid from L1Chart.tsx's comparison.

export interface QTPOPrefillItem {
  QuotationItemId: number; ItemId: string; ItemName: string; UOMCode: string; UOMName: string;
  Quantity: number; Remarks?: string;
  M_CGST: number | null; M_SGST: number | null; M_IGST: number | null;
  Rate: number | null; SupplyDate: string | null; Quality: string | null;
}

export interface QTPOPrefill {
  QuotationId: number; DocNo: string;
  CompanyId: number | null; CompanyName: string;
  ProjectId: number | null; ProjectName: string;
  FinYearId: number | null; Remarks: string;
  SupplierId: number; SupplierName: string | null;
  SourceMRId?: number | null; SourceMRDocNo?: string | null;
  items: QTPOPrefillItem[];
}

export const getQTPOPrefill = (quotationId: number | string, supplierId: number | string) =>
  fetchWithAuth(`/api/quotations/${quotationId}/po-prefill?supplierId=${supplierId}`).then((r) => handleResponse<QTPOPrefill>(r));

// ─── GST split resolver ─────────────────────────────────────────────────────
// Items carry CGST, SGST, and IGST rates all at once in Item Master — which
// one actually applies depends on whether the supplier and ordering company
// share a GST state. See PurchaseOrderMaster.tsx's identical comment.
export function resolveLineGstSplit(
  cgst: number, sgst: number, igst: number, resolvedTotal: number, isIntraState: boolean,
): { cgstRate: number; sgstRate: number; igstRate: number; gstRate: number } {
  let cgstRate = 0, sgstRate = 0, igstRate = 0;
  if (isIntraState) {
    if (cgst > 0 || sgst > 0) { cgstRate = cgst; sgstRate = sgst; }
    else if (igst > 0) { cgstRate = igst / 2; sgstRate = igst / 2; }
    else if (resolvedTotal > 0) { cgstRate = resolvedTotal / 2; sgstRate = resolvedTotal / 2; }
  } else {
    if (igst > 0) { igstRate = igst; }
    else if (cgst > 0 || sgst > 0) { igstRate = cgst + sgst; }
    else if (resolvedTotal > 0) { igstRate = resolvedTotal; }
  }
  return { cgstRate, sgstRate, igstRate, gstRate: cgstRate + sgstRate + igstRate };
}

// ─── UOM conversion engine ──────────────────────────────────────────────────
// relevantUOMs/convertRate mirror src/lib/uomConversion.ts (category-wide
// physical conversion); alternatesForItem/getItemUomFactor/convertItem*
// mirror src/lib/itemUomAlternates.ts (per-item tagged alternates, e.g.
// Cement Bag <-> CFT, which has no fixed physical category ratio).

export function relevantUOMs<T extends { category?: string | null }>(
  allUoms: T[], currentCategory: string | null | undefined,
): T[] {
  return allUoms.filter((u) => (u.category ?? null) === (currentCategory ?? null));
}

export function convertRate(rate: number, fromFactor: number, toFactor: number): number {
  if (!fromFactor || !toFactor) return rate;
  return rate * (toFactor / fromFactor);
}

export function alternatesForItem(alternates: ItemUOMAlternate[], itemId: string): ItemUOMAlternate[] {
  return alternates.filter((a) => a.itemId === itemId);
}

export function getItemUomFactor(
  alternates: ItemUOMAlternate[], itemId: string, uomCode: string, baseUomCode?: string | null,
): number | null {
  if (baseUomCode && uomCode === baseUomCode) return 1;
  const match = alternates.find((a) => a.itemId === itemId && a.uomCode === uomCode);
  return match ? match.conversionFactor : null;
}

export function convertItemQuantity(qty: number, fromFactor: number, toFactor: number): number {
  if (!fromFactor || !toFactor) return qty;
  return qty * (fromFactor / toFactor);
}

export function convertItemRate(rate: number, fromFactor: number, toFactor: number): number {
  if (!fromFactor || !toFactor) return rate;
  return rate * (toFactor / fromFactor);
}

export const getStatusColor = (status: string): string => {
  const s = (status || "Draft").toLowerCase();
  if (s === "approved" || s === "received") return "#059669";
  if (s === "pending" || s === "issued") return "#d97706";
  if (s === "rejected" || s === "closed") return "#dc2626";
  if (s === "partially received") return "#059669";
  if (s === "short closed") return "#64748b";
  return "#64748b";
};
