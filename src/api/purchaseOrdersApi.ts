// ─────────────────────────────────────────────────────────────────────────────
// Purchase Orders API
// ─────────────────────────────────────────────────────────────────────────────

import { fetchWithAuth } from "@/lib/fetchWithAuth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface POLineItem {
  itemId?: string;
  itemName?: string;
  itemDescription: string;
  unit: string;
  quantity: number;
  rate: number;
  tax: number; // percentage, e.g. 18
  amount: number; // computed: qty * rate * (1 + tax/100)
}

// Billing terms / discount configuration
export interface DiscountConfig {
  applicable: boolean;
  type: "percentage" | "fixed";
  value: number;
  appliedOn: "pre-gst" | "post-gst";
  masterTermId: string | null;
  masterTermName: string | null;
}

// GST configuration
export type GSTType = "none" | "cgst_sgst" | "igst";

export interface GSTConfig {
  applicable: boolean;
  type: GSTType; // "none" | "cgst_sgst" | "igst"
  rate: number; // total GST %, e.g. 18 → CGST 9% + SGST 9%, or IGST 18%
}

export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  ExpectedDeliveryDate: string;
  SupplierID: number;
  SupplierName: string;
  CompanyId: number;
  CompanyName: string;
  ProjectId: number;
  ProjectName: string;
  // Legacy single-item fields (kept for backward compat with GRN etc.)
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Rate?: number;
  TotalAmount?: number;
  // Multi-item field (new)
  POItems?: POLineItem[];
  PaymentTerms: string;
  Status: string;
  Remarks: string;
  DocTypeId?: number;
  DocNo?: string;
  DocTypePrefix?: string;
  DocTypeDescription?: string;
  SourceWOId?: number | null;
  SourceWODocNo?: string | null;
  SourceMRId?: number | null;
  SourceMRDocNo?: string | null;
  SourceQTId?: number | null;
  SourceQTDocNo?: string | null;
  SourceWDId?: number | null;
  SourceWDDocNo?: string | null;
  POType?: "Normal" | "Direct" | "WO_PO" | "QPO";
  CreatedBy?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
  ApprovedBy?: string;
  ApprovedAt?: string;
  // Billing terms / discount configuration
  Discount?: DiscountConfig;
  // GST configuration
  GST?: GSTConfig;
}

export interface POListResponse {
  data: PurchaseOrder[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreatePOPayload {
  PurchaseOrderNo?: string;
  PODate?: string;
  ExpectedDeliveryDate?: string;
  SupplierID?: number | string | null;
  CompanyId?: number | string | null;
  ProjectId?: number | string | null;
  // Legacy single-item fields (kept for GRN compatibility)
  ItemDescription?: string | null;
  Quantity?: number | string;
  Unit?: string | null;
  Rate?: number | string;
  TotalAmount?: number | string;
  // Multi-item field (new)
  POItems?: POLineItem[];
  PaymentTerms?: string | null;
  Status?: string;
  Remarks?: string | null;
  DocTypeId?: number | string | null;
  DocNo?: string | null;
  finYear?: string | null;
  // Billing terms / discount configuration
  Discount?: DiscountConfig | null;
  // GST configuration
  GST?: GSTConfig | null;
  // Source tracking
  SourceWOId?: number | string | null;
  SourceWODocNo?: string | null;
  SourceMRId?: number | string | null;
  SourceMRDocNo?: string | null;
  SourceQTId?: number | string | null;
  SourceQTDocNo?: string | null;
  SourceWDId?: number | string | null;
  SourceWDDocNo?: string | null;
  POType?: "Normal" | "Direct" | "WO_PO" | "QPO";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute grand total from line items and keep legacy single-item fields
 * in sync so GRN and other downstream modules that read those columns still work.
 */
function enrichPayload(payload: CreatePOPayload): CreatePOPayload {
  const items = payload.POItems ?? [];
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.rate, 0);
  const totalTax = items.reduce(
    (sum, it) => sum + (it.quantity * it.rate * it.tax) / 100,
    0,
  );
  const discount = payload.Discount;
  const discountAmount = discount?.applicable
    ? discount.type === "percentage"
      ? (subtotal * discount.value) / 100
      : discount.value
    : 0;
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const taxMultiplier = subtotal > 0 ? taxableAmount / subtotal : 0;
  // GST is now captured per line item via the `tax` field (from HSN)
  // The header-level GST object is kept for reference only; line tax drives the total.
  const grandTotal = Math.round(taxableAmount + totalTax * taxMultiplier);

  return {
    ...payload,
    TotalAmount: grandTotal || payload.TotalAmount,
    // Mirror first item into legacy fields when there is exactly one row
    ...(items.length === 1 && {
      ItemDescription: items[0].itemDescription,
      Quantity: items[0].quantity,
      Unit: items[0].unit,
      Rate: items[0].rate,
    }),
  };
}

/**
 * Shared response handler — throws with the server's error message on non-2xx
 * so callers always get a meaningful error string in their catch block.
 */
async function handleResponse<T = any>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error ?? body.message ?? message;
    } catch {
      // ignore JSON parse failure — keep the status code message
    }
    throw new Error(message);
  }
  return res.json().catch(() => ({})) as Promise<T>;
}

// ── API Functions ─────────────────────────────────────────────────────────────

export const getPurchaseOrders = (
  query: {
    page?: number;
    limit?: number;
    poType?: string;
    fyId?: number;
    includeShortClosed?: boolean;
  } = {},
) => {
  const { page = 1, limit = 10, poType, fyId, includeShortClosed } = query;
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (poType) params.set("poType", poType);
  if (fyId) params.set("fyId", String(fyId));
  if (includeShortClosed) params.set("includeShortClosed", "1");
  return fetchWithAuth(`/purchase-orders?${params.toString()}`)
    .then((r) => handleResponse<POListResponse>(r))
    .then((r: any): POListResponse => {
      const data = Array.isArray(r.data) ? r.data : Array.isArray(r) ? r : null;
      if (!data)
        throw new Error(
          r?.error ?? r?.message ?? "Unexpected response from server",
        );
      return {
        data,
        page: Number(r.page ?? 1),
        limit: Number(r.limit ?? limit),
        total: Number(r.total ?? 0),
        totalPages: Number(r.totalPages ?? 1),
      };
    });
};

export const getPurchaseOrderById = (
  id: number | string,
): Promise<PurchaseOrder> =>
  fetchWithAuth(`/purchase-orders/${id}`).then((r) =>
    handleResponse<PurchaseOrder>(r),
  );

export const addPurchaseOrder = (payload: CreatePOPayload) =>
  fetchWithAuth("/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enrichPayload(payload)),
  }).then((r) => handleResponse(r));

export const updatePurchaseOrder = (
  id: number | string,
  payload: CreatePOPayload,
) =>
  fetchWithAuth(`/purchase-orders/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(enrichPayload(payload)),
  }).then((r) => handleResponse(r));

export const deletePurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}`, { method: "DELETE" }).then((r) =>
    handleResponse(r),
  );

export const submitPurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}/submit`, { method: "PUT" }).then((r) =>
    handleResponse(r),
  );

export const approvePurchaseOrder = (id: number | string) =>
  fetchWithAuth(`/purchase-orders/${id}/approve`, { method: "PUT" }).then((r) =>
    handleResponse(r),
  );

export const rejectPurchaseOrder = (id: number | string, note?: string) =>
  fetchWithAuth(`/purchase-orders/${id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  }).then((r) => handleResponse(r));

// ─── Suppliers ────────────────────────────────────────────────────────────────
// Returns [{ LHeadId, LHeadName, ... }]
export const getSuppliers = () =>
  fetchWithAuth("/api/account-head?type=S").then((r) => handleResponse(r));

// ─── Companies ────────────────────────────────────────────────────────────────
// Returns [{ id, label, ... }] from enterprises/options?business_type=C
export const getCompanies = () =>
  fetchWithAuth("/api/enterprises/options?business_type=C").then((r) =>
    handleResponse(r),
  );

// ─── Projects ────────────────────────────────────────────────────────────────
// Returns [{ id, label, ... }] from enterprises/options?business_type=P
export const getProjects = () =>
  fetchWithAuth("/api/enterprises/options?business_type=P").then((r) =>
    handleResponse(r),
  );

// ─── UOM ─────────────────────────────────────────────────────────────────────
// Returns [{ Id, UOMName, UOMCode, Symbol, IsActive, ... }]
export const getUOMs = () =>
  fetchWithAuth("/api/uom-master").then((r) => handleResponse(r));

// ─── Items with HSN GST rates ─────────────────────────────────────────────────
// Returns items with their resolved GST rate from HSN Master
// Used by PO to auto-fill GST rate when an item is selected
export interface POItemOption {
  id: string;
  name: string;
  gstRate: number;
  hsnCode: string | null;
}

export const getItemsWithGST = (): Promise<POItemOption[]> =>
  fetchWithAuth("/api/work-orders/meta/items")
    .then((r) => handleResponse<any[]>(r))
    .then((data) =>
      (Array.isArray(data) ? data : []).map((i) => ({
        id: String(i.id),
        name: String(i.name),
        gstRate: Number(i.gstRate ?? 0),
        hsnCode: i.hsnCode ?? null,
      })),
    );

// ─── Supplier Details (address, contact person, GST) ──────────────────────────
// Fetches full details for a single supplier from AccountHeadMaster
export interface SupplierDetails {
  LHeadId: number;
  LHeadName: string;
  LHeadAddress: string | null;
  LHeadContactPerson: string | null;
  LGST: string | null;
  /** Supplier's GST-registered state (free text, e.g. "Maharashtra") — used
   *  to decide CGST+SGST vs IGST on PO line items relative to the company's
   *  own state. */
  LGSTState: string | null;
  LHeadPhone: string | null;
  LHeadEmail: string | null;
}

export const getSupplierDetails = (
  id: string | number,
): Promise<SupplierDetails | null> =>
  fetchWithAuth(`/api/account-head/${id}`)
    .then((r) => handleResponse<any>(r))
    .then((data) => {
      if (!data) return null;
      return {
        LHeadId: data.LHeadId,
        LHeadName: data.LHeadName ?? "",
        LHeadAddress: data.LHeadAddress ?? null,
        LHeadContactPerson: data.LHeadContactPerson ?? null,
        LGST: data.LGST ?? null,
        LGSTState: data.LGSTState ?? null,
        LHeadPhone: data.LHeadPhone ?? null,
        LHeadEmail: data.LHeadEmail ?? null,
      };
    })
    .catch(() => null);

// ─── Company Details (address, GST) ───────────────────────────────────────────
// Fetches full details for a single company/enterprise by id
export interface CompanyDetails {
  id: number;
  name: string;
  address: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gst_no: string | null;
  email: string | null;
  phone_number: string | null;
  logo: string | null;
}

export const getCompanyDetails = (
  id: string | number,
): Promise<CompanyDetails | null> =>
  fetchWithAuth(`/api/enterprises/by-id/${id}`)
    .then((r) => handleResponse<any>(r))
    .then((data) => {
      if (!data) return null;
      return {
        id: data.id,
        name: data.name ?? "",
        address: data.address ?? null,
        address_line2: data.address_line2 ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        gst_no: data.gst_no ?? null,
        email: data.email ?? null,
        phone_number: data.phone_number ?? null,
        logo: data.logo ?? null,
      };
    })
    .catch(() => null);
