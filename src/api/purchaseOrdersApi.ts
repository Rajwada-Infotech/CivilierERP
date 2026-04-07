const BASE = "/api/purchase-orders";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export const getPurchaseOrders = async () => {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addPurchaseOrder = async (data: Record<string, unknown>) => {
  const res = await fetch(BASE, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updatePurchaseOrder = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deletePurchaseOrder = async (id: string) => {
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

// ====================== Helper Functions for Dropdowns ======================

export const getSuppliers = async () => {
  const res = await fetch("/api/account-head");
  if (!res.ok) throw new Error("Suppliers fetch failed");
  const data = await res.json();
  return data.filter((item: any) => item.LHeadType === "Supplier");
};

export const getItems = async () => {
  const res = await fetch("/api/item-groups");
  if (!res.ok) throw new Error("Items fetch failed");
  return res.json();
};
