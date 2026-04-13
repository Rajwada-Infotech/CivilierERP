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

// Matches actual dbo.PurchaseOrders schema exactly
export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  SupplierID: number;
  SupplierName?: string;     // joined from AccountHeadMaster in backend
  ItemDescription?: string;  // single item per PO
  Quantity?: number;
  Unit?: string;
  Status?: string;
}

// Matches Item_Master_Group leaf rows
export interface Item {
  M_Id: string;
  M_Name: string;
  M_Description?: string;
  ParentGroupName?: string;
}

// Matches dbo.UOMMaster
export interface UOM {
  Id: number;
  UOMName: string;
  UOMCode: string;
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
}

// ── GRN CRUD ─────────────────────────────────────────────────────────────────

export const getGRNs = async (): Promise<any[]> => {
  const res = await fetch(BASE, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addGRN = async (data: GRNFormDataPayload) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, grnItems: JSON.stringify(data.grnItems) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateGRN = async (id: string, data: GRNFormDataPayload) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...data, grnItems: JSON.stringify(data.grnItems) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
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
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};

// ── Dropdown fetches ──────────────────────────────────────────────────────────

// Suppliers: LHeadType = 'S' (confirmed from AccountHeadMaster screenshot)
export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch("/api/account-head?type=S", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Suppliers fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

// Purchase Orders with supplier name joined
export const getPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  const res = await fetch("/api/purchase-orders", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("POs fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

// Items from Item_Master_Group (leaves: Parent_Id IS NOT NULL)
export const getItems = async (): Promise<Item[]> => {
  const res = await fetch("/api/item-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Items fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

// Units from dbo.UOMMaster
export const getUoms = async (): Promise<UOM[]> => {
  const res = await fetch("/api/uom-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("UOMs fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data.filter((u: UOM) => u.IsActive !== false) : [];
};