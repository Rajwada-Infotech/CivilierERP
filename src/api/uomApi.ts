import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/uom-master";

export const getUomList = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addUom = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "POST failed");
  }
  return res.json();
};

export const updateUom = async (id: number, data: Record<string, unknown>) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "PUT failed");
  }
  return res.json();
};

export const deleteUom = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};
