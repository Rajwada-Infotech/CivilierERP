// src/api/grnApi.ts
import api from "./axios";

const BASE = "/api/grns";

export interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadType?: string;
}

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

export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  DocNo?: string | null;
  RootExBDocNo?: string | null;
  SupplierID?: number;
  SupplierName?: string;
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Rate?: number;
  TotalAmount?: number;
  POItems?: POLineItem[];
  LineItems?: any[];
  DocTypeId?: number;
  Status?: string;
  POType?: "Normal" | "Direct" | "WO_PO";
  SourceWODocNo?: string | null;
  SourceMRDocNo?: string | null;
  SourceWDDocNo?: string | null;
}

export interface Item {
  M_Id: string;
  M_Name: string;
  M_Description?: string;
  ParentGroupName?: string;
}

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
  rate: number;
  quantity: number;
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
  parentDocNo?: string | null;
  rootExBDocNo?: string | null;
  projectId?: number | null;
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

const normalizePaginated = <T>(payload: any): PaginatedResponse<T> => {
  const toArray = (p: any): T[] =>
    Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [];

  if (Array.isArray(payload)) {
    return { data: payload, page: 1, limit: payload.length, total: payload.length, totalPages: 1 };
  }
  return {
    data: toArray(payload),
    page: Number(payload?.page || 1),
    limit: Number(payload?.limit || payload?.data?.length || 0),
    total: Number(payload?.total || payload?.data?.length || 0),
    totalPages: Number(payload?.totalPages || 1),
  };
};

const normalizeArray = <T>(payload: any): T[] =>
  Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];

// ── GRN CRUD ─────────────────────────────────────────────────────────────────

export const getGRNs = async (
  query: PaginationQuery = {},
): Promise<PaginatedResponse<any>> => {
  const res = await api.get(BASE, { params: query });
  return normalizePaginated(res.data);
};

export const addGRN = async (data: GRNFormDataPayload) => {
  const res = await api.post(BASE, data);
  return res.data;
};

export const updateGRN = async (id: string, data: GRNFormDataPayload) => {
  const res = await api.put(`${BASE}/${id}`, data);
  return res.data;
};

export const deleteGRN = async (id: string) => {
  const res = await api.delete(`${BASE}/${id}`);
  return res.data;
};

export const previewNextGRNNumber = async (
  parentDocNo?: string | null,
): Promise<DocNumberPreview> => {
  const res = await api.get(`${BASE}/next-number`, {
    params: parentDocNo ? { parentDocNo } : {},
  });
  return res.data;
};

// ── Dropdown fetches ──────────────────────────────────────────────────────────

export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await api.get("/api/account-head", { params: { type: "S" } });
  return Array.isArray(res.data) ? res.data : [];
};

export const getPurchaseOrders = async (
  fyId?: number | null,
): Promise<PurchaseOrder[]> => {
  const res = await api.get("/api/purchase-orders", {
    params: { limit: 500, ...(fyId ? { fyId } : {}) },
  });
  return normalizeArray<PurchaseOrder>(res.data);
};

export const getPurchaseOrderById = async (
  id: number | string,
): Promise<PurchaseOrder> => {
  const res = await api.get(`/api/purchase-orders/${id}`);
  return res.data;
};

export const getItems = async (): Promise<Item[]> => {
  const res = await api.get("/api/item-master");
  return Array.isArray(res.data) ? res.data : [];
};

export const getUoms = async (): Promise<UOM[]> => {
  const res = await api.get("/api/uom-master");
  return Array.isArray(res.data)
    ? res.data.filter((u: UOM) => u.IsActive !== false)
    : [];
};

export const getProjects = async (): Promise<
  { id: number; name: string; short_name: string | null }[]
> => {
  const res = await api.get("/api/enterprises/options", {
    params: { business_type: "P" },
  });
  return Array.isArray(res.data)
    ? (res.data as { id: number; label: string; short_name?: string | null }[]).map(
        (p) => ({ id: p.id, name: p.label, short_name: p.short_name ?? null }),
      )
    : [];
};