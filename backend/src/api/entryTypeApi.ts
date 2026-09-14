const BASE_URL = "/api/entry-type";

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
});

export const getEntryTypes = async () => {
  const res = await fetch(BASE_URL, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addEntryType = async (data: Record<string, unknown>) => {
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

export const updateEntryType = async (
  id: string,
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

export const deleteEntryType = async (id: string) => {
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
export const getProjects = async () => {
  const res = await fetch(`${BASE_URL}/projects`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`GET projects failed: ${res.status}`);
  return res.json().catch(() => ({}));
};
