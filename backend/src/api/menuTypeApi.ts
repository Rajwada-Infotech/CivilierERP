const BASE_URL = "/api/menu-type";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export interface MenuType {
  Id: number;
  MenuReceipt: string | null;
  MenuPayment: string | null;
  MenuBOQ: string | null;
  MenuPurchaseOrder: string | null;
  MenuWorkOrder: string | null;
  CreatedBy: string | null;
  UpdatedBy: string | null;
  ApprovedBy: string | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
  ApprovedAt: string | null;
}

export const getMenuTypes = async (): Promise<MenuType[]> => {
  const res = await fetch(BASE_URL, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addMenuType = async (data: Record<string, unknown>) => {
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

export const updateMenuType = async (
  id: number,
  data: Record<string, unknown>,
) => {
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

export const deleteMenuType = async (id: number) => {
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

/**
 * Returns a flat, deduplicated list of all non-null menu label strings
 * across all MenuType rows — used as <Select> options in NamedEntryTypeMaster.
 */
export function flattenMenuOptions(menuTypes: MenuType[]): string[] {
  const keys: (keyof MenuType)[] = [
    "MenuReceipt",
    "MenuPayment",
    "MenuBOQ",
    "MenuPurchaseOrder",
    "MenuWorkOrder",
  ];
  const seen = new Set<string>();
  const options: string[] = [];
  for (const row of menuTypes) {
    for (const key of keys) {
      const val = row[key] as string | null;
      if (val && !seen.has(val)) {
        seen.add(val);
        options.push(val);
      }
    }
  }
  return options;
}
