// src/api/grnApi.ts
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/grns";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadType?: string;
}

// PO line item — mirrors POLineItem in purchaseOrdersApi.ts
export interface POLineItem {
  itemId?: string;
  itemName?: string;
  itemDescription: string;
  unit: string;
  quantity: number;
  rate: number;
  tax: number;
  amount: number;
}

// Final combined PurchaseOrder interface (most complete version)
export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  DocNo?: string | null;
  RootExBDocNo?: string | null;
  SupplierID?: number;
  SupplierName?: string; // joined from AccountHeadMaster
  // Single line item fields (PO is flat, not nested items)
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Rate?: number;
  TotalAmount?: number;
  // Multi-item field — JSON blob stored on PO row
  POItems?: POLineItem[];
  // Normalised child table rows (returned by GET /:id only)
  // Fields: ItemId, ItemName, Quantity, UomName, Rate (PascalCase from SQL)
  LineItems?: any[];
  DocTypeId?: number;
  Status?: string;
  POType?: "Normal" | "Direct" | "WO_PO";
  SourceWODocNo?: string | null;
  SourceMRDocNo?: string | null;
  SourceWDDocNo?: string | null;
}

// Matches Item_Master_Group leaf rows
export interface Item {
  M_Id: string; // UUID or string
  M_Name: string;
  M_Description?: string;
  ParentGroupName?: string;
}

// Matches dbo.UOMMaster
export interface UOM {
  UOMCode: string;
  UOMName: string;
  Symbol?: string;
  IsActive?: boolean;
}

/**
 * Represents one line item inside a GRN.
 *
 * Fields added in migration 034:
 *   rate        — unit rate (₹) for this item
 *   quantity    — billing quantity (may differ from receivedQty when partial
 *                 billing is allowed)
 *   totalAmount — derived as rate × quantity; stored for audit / reporting
 *                 so downstream modules (Expense Booking, etc.) don't need
 *                 to recompute it.
 */
export interface GRNItemLine {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string;
  /** Unit rate in ₹.  Defaults to 0. */
  rate: number;
  /** Billing quantity. Separate from receivedQty so partial billing works. */
  quantity: number;
  /** Computed: rate × quantity. Stored for audit trail. */
  totalAmount: number;
}

export interface GRNFormDataPayload {
  grnNo: string;
  grnDate: string;
  supplierId: number;
  poId: number;
  grnItems: GRNItemLine[];
  status: string;
  remarks?: string;
  supplierName?: string;
  poNumber?: string;
  docTypeId?: number | null;
  docNo?: string;
  finYear?: string | null;
  /** DocNo of the parent PO or WO (used to resolve correct GRN prefix). */
  parentDocNo?: string | null;
  /** Root ExB DocNo — present when this GRN is under an Expense Booking. */
  rootExBDocNo?: string | null;
  /** Optional project this GRN is associated with. */
  projectId?: number | null;
  /** Godown where received stock is credited. */
  godownId?: number | null;
}

export interface DocNumberPreview {
  nextDocNo: string;
  prefix?: string;
  nextSeq?: number;
  year?: number | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  [key: string]: unknown;
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

const normalizeArray = <T>(payload: any): T[] =>
  Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : [];

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
    data: normalizeArray<T>(payload),
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || payload?.data?.length || 0),
    total: Number(payload?.total || payload?.data?.length || 0),
    totalPages: Number(payload?.totalPages || 1),
  };
};

// ====================== API Calls ======================

export const getGRNs = async (
  query: PaginationQuery = {},
): Promise<PaginatedResponse<any>> => {
  const res = await fetch(buildUrl(BASE, query), { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch GRNs");
  return normalizePaginated(await res.json());
};

export const addGRN = async (data: GRNFormDataPayload) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, grnItems: data.grnItems }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create GRN");
  }
  return res.json();
};

export const updateGRN = async (id: string, data: GRNFormDataPayload) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, grnItems: data.grnItems }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update GRN");
  }
  return res.json();
};

export const deleteGRN = async (id: string) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete GRN");
  }
  return res.json();
};

export const previewNextGRNNumber = async (
  parentDocNo?: string | null,
): Promise<DocNumberPreview> => {
  const res = await fetch(buildUrl(`${BASE}/next-number`, { parentDocNo }), {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to preview GRN number");
  }
  return res.json();
};

// ── Dropdown fetches ──────────────────────────────────────────────────────────

export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch("/api/account-head?type=S", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch suppliers");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getPurchaseOrders = async (
  fyId?: number | null,
): Promise<PurchaseOrder[]> => {
  const params: Record<string, string> = { limit: "500" };
  if (fyId) params.fyId = String(fyId);
  const res = await fetch(buildUrl("/api/purchase-orders", params), {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch Purchase Orders");
  return normalizeArray<PurchaseOrder>(await res.json());
};

export const getPurchaseOrderById = async (
  id: number | string,
): Promise<PurchaseOrder> => {
  const res = await fetch(`/api/purchase-orders/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch PO details");
  return res.json();
};

export const getItems = async (): Promise<Item[]> => {
  const res = await fetch("/api/item-master", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch Items");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getUoms = async (): Promise<UOM[]> => {
  const res = await fetch("/api/uom-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch UOMs");
  const data = await res.json();
  return Array.isArray(data)
    ? data.filter((u: UOM) => u.IsActive !== false)
    : [];
};

export const getProjects = async (): Promise<
  {
    id: number;
    name: string;
    short_name: string | null;
    company_id?: string | number | null;
    company_ids?: string | null;
    belongs_to?: string | null;
  }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json();
  // /enterprises/options returns { id, label, belongs_to, company_id, company_ids }
  // Preserve company linkage fields so filterProjectsByCompany works correctly.
  return Array.isArray(data)
    ? (
        data as {
          id: number;
          label: string;
          short_name?: string | null;
          company_id?: string | number | null;
          company_ids?: string | null;
          belongs_to?: string | null;
        }[]
      ).map((p) => ({
        id: p.id,
        name: p.label,
        short_name: p.short_name ?? null,
        company_id: p.company_id ?? null,
        company_ids: p.company_ids ?? null,
        belongs_to: p.belongs_to ?? null,
      }))
    : [];
};
