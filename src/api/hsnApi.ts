import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/hsn";

export const getHsn = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json().catch(() => ({}));
};

export const addHsn = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "POST failed");
  }
  return res.json().catch(() => ({}));
};

export const updateHsn = async (
  code: string,
  data: Record<string, unknown>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${code}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "PUT failed");
  }
  return res.json().catch(() => ({}));
};

export const deleteHsn = async (code: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${code}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error || "DELETE failed");
  }
  return res.json().catch(() => ({}));
};
