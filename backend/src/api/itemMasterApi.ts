const BASE_URL = "/api/item-master";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface DbItem {
  M_Id: string;
  M_Name: string;
  M_Description: string | null;
  M_Type: string | null;
  M_BelongsTo: string | null; // ← stores item group M_Id (UUID)
  M_Group: string | null; // ← stores item group Name (string)
  M_code: string | null; // ← stores short code
  M_IdentityCode: boolean;
  M_HSN: string | null;
  M_CGST: number | null;
  M_IGST: number | null;
  M_SGST: number | null;
  M_UOM: string | null;
  M_CreatedBy: string | null;
  M_CreatedDate: string;
  M_ApprovedBy: string | null;
  Parent_Id: string; // ← stores item group M_Id (UUID)
  ParentGroupName: string | null;
  default_supplier_id: number | null;
  DefaultSupplierName: string | null;
  M_GLHeadId: number | null;
  GLHeadName: string | null;
  M_CostCenterId: number | null;
  CostCenterName: string | null;
}

export const getItems = async (): Promise<DbItem[]> => {
  const res = await fetch(BASE_URL, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addItem = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "POST failed");
  }
  return res.json().catch(() => ({}));
};

export const updateItem = async (id: string, data: Record<string, unknown>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
  }
  return res.json().catch(() => ({}));
};

export const deleteItem = async (id: string) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "DELETE failed");
  }
  return res.json().catch(() => ({}));
};
