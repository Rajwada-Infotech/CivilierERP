import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/menu-master";

export interface MenuMaster {
  Id: number;
  Name: string;
  Description: string | null;
  CreatedBy: number | null;
  UpdatedBy: number | null;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

export const getMenuMasters = async (): Promise<MenuMaster[]> => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addMenuMaster = async (data: {
  Name: string;
  Description?: string;
}) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateMenuMaster = async (
  id: number,
  data: { Name: string; Description?: string },
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deleteMenuMaster = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};
