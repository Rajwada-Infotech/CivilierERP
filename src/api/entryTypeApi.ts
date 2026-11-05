import { fetchWithAuth } from "@/lib/fetchWithAuth";
const BASE_URL = "/api/entry-type";

export const getEntryTypes = async () => {
  const res = await fetchWithAuth(BASE_URL, {
  });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addEntryType = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "POST failed");
  }
  return res.json().catch(() => ({}));
};

export const updateEntryType = async (
  id: string,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "PUT failed");
  }
  return res.json().catch(() => ({}));
};

export const deleteEntryType = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "DELETE failed");
  }
  return res.json().catch(() => ({}));
};
export const getProjects = async () => {
  const res = await fetchWithAuth(`${BASE_URL}/projects`, {
  });
  if (!res.ok) throw new Error(`GET projects failed: ${res.status}`);
  return res.json().catch(() => ({}));
};
