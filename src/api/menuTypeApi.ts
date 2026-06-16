import api from "./axios";

const BASE_URL = "/menu-type";

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
  const res = await api.get<MenuType[]>(BASE_URL);
  return res.data;
};

export const addMenuType = async (data: Record<string, unknown>) => {
  const res = await api.post(BASE_URL, data);
  return res.data;
};

export const updateMenuType = async (
  id: number,
  data: Record<string, unknown>,
) => {
  const res = await api.put(`${BASE_URL}/${id}`, data);
  return res.data;
};

export const deleteMenuType = async (id: number) => {
  const res = await api.delete(`${BASE_URL}/${id}`);
  return res.data;
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