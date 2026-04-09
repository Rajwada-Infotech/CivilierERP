import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE_URL = "/api/new-payment";

async function parseError(res: Response, fallback: string) {
  try {
    const err = await res.json();
    return err.error || fallback;
  } catch {
    return fallback;
  }
}

export const getPayments = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(await parseError(res, `GET failed: ${res.status}`));
  return res.json();
};

export const addPayment = async (data: Record<string, unknown>) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "POST failed"));
  return res.json();
};

export const updatePayment = async (id: string, data: Record<string, unknown>) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "PUT failed"));
  return res.json();
};

export const deletePayment = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "DELETE failed"));
  return res.json();
};
