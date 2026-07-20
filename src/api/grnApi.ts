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

// PO line item â€" mirrors POLineItem in purchaseOrdersApi.ts
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
  // Multi-item field â€" JSON blob stored on PO row
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
 *   rate        â€" unit rate (â‚¹) for this item
 *   quantity    â€" billing quantity (may differ from receivedQty when partial
 *                 billing is allowed)
 *   totalAmount â€" derived as rate Ã— quantity; stored for audit / reporting
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
  /** Unit rate in â‚¹.  Defaults to 0. */
  rate: number;
  /** Billing quantity. Separate from receivedQty so partial billing works. */
  quantity: number;
  /** Computed: rate Ã— quantity. Stored for audit trail. */
  totalAmount: number;
}

export interface GRNFormDataPayload {
  grnNo: string;
  grnDate: string;
  supplierId: number;
  poId: number;
  vehicleInOutId?: number | null;
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
  /** Root ExB DocNo â€" present when this GRN is under an Expense Booking. */
  rootExBDocNo?: string | null;
  /** Optional project this GRN is associated with. */
  projectId?: number | null;
  /** Godown where received stock is credited. */
  godownId?: number | null;
  /** IDs of attachments uploaded via /api/grns/upload, to link on save. */
  attachmentIds?: number[];
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
  return normalizePaginated(await res.json().catch(() => ({})));
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
  return res.json().catch(() => ({}));
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
  return res.json().catch(() => ({}));
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
  return res.json().catch(() => ({}));
};

// ── Attachments ────────────────────────────────────────────────────────────

export interface GRNAttachment {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

/**
 * Upload one or more files for a GRN. Can be called before the GRN itself
 * is saved (GRNID is NULL on the server until linked) -- same flow as
 * Vehicle In/Out attachments. Returns the uploaded attachment records;
 * pass their `id`s back as `attachmentIds` on create/update.
 */
export const uploadGRNAttachments = async (
  files: File[],
): Promise<GRNAttachment[]> => {
  const form = new FormData();
  files.forEach((f) => form.append("file", f));
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
      // NOTE: do NOT set Content-Type -- the browser sets the multipart boundary
    },
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to upload attachment(s)");
  }
  const data = await res.json().catch(() => ({}));
  return data.attachments as GRNAttachment[];
};

export const deleteGRNAttachment = async (attachmentId: number) => {
  const res = await fetch(`${BASE}/attachment/${attachmentId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete attachment");
  }
  return res.json().catch(() => ({}));
};

export const getGRNAttachments = async (
  grnId: number | string,
): Promise<GRNAttachment[]> => {
  const res = await fetch(`${BASE}/${grnId}/attachments`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch attachments");
  }
  return res.json().catch(() => ({}));
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
  return res.json().catch(() => ({}));
};

// â"€â"€ Dropdown fetches â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch("/api/account-head?type=S", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch suppliers");
  const data = await res.json().catch(() => ({}));
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
  return normalizeArray<PurchaseOrder>(await res.json().catch(() => ({})));
};

export const getPurchaseOrderById = async (
  id: number | string,
): Promise<PurchaseOrder> => {
  const res = await fetch(`/api/purchase-orders/${id}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch PO details");
  return res.json().catch(() => ({}));
};

export const getItems = async (): Promise<Item[]> => {
  const res = await fetch("/api/item-master", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch Items");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data) ? data : [];
};

export const getUoms = async (): Promise<UOM[]> => {
  const res = await fetch("/api/uom-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Failed to fetch UOMs");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data)
    ? data.filter((u: UOM) => u.IsActive !== false)
    : [];
};

export const getProjects = async (companyId?: string | number | null): Promise<
  { id: number; name: string; short_name: string | null; enterprise_id: number | null }[]
> => {
  const params = new URLSearchParams({ business_type: "P" });
  if (companyId) params.set("enterprise_id", String(companyId));
  const res = await fetchWithAuth(`/api/enterprises/options?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data)
    ? (data as { id: number; label: string; short_name?: string | null; enterprise_id?: number | null }[]).map(
        (p) => ({ id: p.id, name: p.label, short_name: p.short_name ?? null, enterprise_id: p.enterprise_id ?? null }),
      )
    : [];
};

export const getCompanies = async (): Promise<
  { id: number; name: string }[]
> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) throw new Error("Failed to fetch companies");
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data)
    ? (data as { id: number; label: string }[]).map((c) => ({ id: c.id, name: c.label }))
    : [];
};

// â"€â"€ GRN from Stock Transfer â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export interface GRNFromTransferPayload {
  remarks?: string;
  supplierId?: number | null;
}

export interface GRNFromTransferResult {
  message: string;
  grnId: number;
  grnNo: string;
  docNo: string;
  sourceTransferDocNo: string;
  toGodownName: string;
}

/**
 * Create a GRN directly from a Stock Transfer document.
 * The backend maps TransferItems â†' GRNItems and targets ToGodownID.
 */
export const createGRNFromTransfer = async (
  transferId: number,
  payload: GRNFromTransferPayload = {},
): Promise<GRNFromTransferResult> => {
  const res = await fetchWithAuth(`/api/grns/from-transfer/${transferId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      err.error || `Failed to create GRN from transfer: ${res.status}`,
    );
  }
  return res.json().catch(() => ({}));
};

export interface TransferGRNSummary {
  GRNID: number;
  GRNNo: string;
  DocNo: string;
  GRNDate: string;
  Status: string;
  TotalAmount: number;
  SourceTransferDocNo: string;
}

/** Fetch all GRNs linked to a specific Stock Transfer (for badge/status display). */
export const getGRNsByTransfer = async (
  transferId: number,
): Promise<TransferGRNSummary[]> => {
  const res = await fetchWithAuth(`/api/grns/by-transfer/${transferId}`);
  if (!res.ok)
    throw new Error(`Failed to fetch GRNs for transfer: ${res.status}`);
  return res.json().catch(() => ({}));
};
