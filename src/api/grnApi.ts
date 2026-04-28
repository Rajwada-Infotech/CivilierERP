// src/api/grnApi.ts
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

// Final combined PurchaseOrder interface (most complete version)
export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  SupplierID?: number;
  SupplierName?: string; // joined from AccountHeadMaster
  // Single line item fields (PO is flat, not nested items)
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Rate?: number;
  TotalAmount?: number;
  Status?: string;
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

export interface GRNItemLine {
  itemId: string;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom: string;
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
  Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];

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
    body: JSON.stringify({ 
      ...data, 
      grnItems: JSON.stringify(data.grnItems) 
    }),
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
    body: JSON.stringify({ 
      ...data, 
      grnItems: JSON.stringify(data.grnItems) 
    }),
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

// ── Dropdown fetches ──────────────────────────────────────────────────────────

export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch("/api/account-head?type=S", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch suppliers");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  const res = await fetch(buildUrl("/api/purchase-orders", { limit: 100 }), {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch Purchase Orders");
  return normalizeArray<PurchaseOrder>(await res.json());
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
