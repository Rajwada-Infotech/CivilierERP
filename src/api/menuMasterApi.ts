const BASE_URL = "/api/menu-master";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

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
  const res = await fetch(BASE_URL, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addMenuMaster = async (data: { Name: string; Description?: string }) => {
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

export const updateMenuMaster = async (
  id: number,
  data: { Name: string; Description?: string }
) => {
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

export const deleteMenuMaster = async (id: number) => {
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
