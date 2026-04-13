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

export interface PurchaseOrder {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  SupplierID?: number;
  SupplierName?: string;
  ItemDescription?: string;
  Quantity?: number;
  Unit?: string;
  Items?: string;
}

export interface Item {
  M_Id: string;
  M_Name: string;
  M_Description?: string;
  M_Type?: string;
  M_Group?: string;
  Parent_Id?: string;
  ParentGroupName?: string;
}

export interface UOM {
  Id: number;
  UOMId?: number;
  UOMName: string;
  UOMCode: string;
  Symbol?: string;
  UOMSymbol?: string;
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

export const getGRNs = async (): Promise<any[]> => {
  const res = await fetch(BASE, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addGRN = async (data: GRNFormDataPayload) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      ...data,
      grnItems: JSON.stringify(data.grnItems),
    }),
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
    body: JSON.stringify({
      ...data,
      grnItems: JSON.stringify(data.grnItems),
    }),
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

export const getSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch("/api/account-head?type=Supplier", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("Suppliers fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getPurchaseOrders = async (): Promise<PurchaseOrder[]> => {
  const res = await fetch("/api/purchase-orders", {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error("POs fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getItems = async (): Promise<Item[]> => {
  const res = await fetch("/api/item-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("Items fetch failed");
  const data = await res.json();
  return Array.isArray(data) ? data : [];
};

export const getUoms = async (): Promise<UOM[]> => {
  const res = await fetch("/api/uom-master", { headers: getAuthHeaders() });
  if (!res.ok) throw new Error("UOMs fetch failed");
  const data = await res.json();
  return Array.isArray(data)
    ? data.filter((u: UOM) => u.IsActive !== false)
    : [];
};
