// New API file — ItemMaster.tsx had no API layer at all (was fully hardcoded).

const BASE_URL = "/api/item-master";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface DbItem {
  M_Id: string;
  M_Name: string;
  M_Description: string | null;
  M_Type: string | null; // item type: "Service" | "Goods"
  M_BelongsTo: string | null; // FK uniqueidentifier (optional)
  M_Group: string | null; // short code / group code
  M_IdentityCode: boolean; // show tax calculated
  M_HSN: string | null;
  M_CGST: number | null;
  M_IGST: number | null;
  M_SGST: number | null;
  M_CreatedBy: string | null;
  M_CreatedDate: string;
  M_ApprovedBy: string | null;
  Parent_Id: string; // FK to item group — required for items
  ParentGroupName: string | null;
}

export const getItems = async (): Promise<DbItem[]> => {
  const res = await fetch(BASE_URL, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addItem = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: getAuthHeaders(),

    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateItem = async (id: string, data: Record<string, unknown>) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),

    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deleteItem = async (id: string) => {
  const res = await fetch(`${BASE_URL}/${id}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};
