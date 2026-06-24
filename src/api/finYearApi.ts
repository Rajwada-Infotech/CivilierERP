import { fetchWithAuth } from "../lib/fetchWithAuth.ts";

const BASE_URL = "/api/fin-year";

export interface FinYearPayload {
  fy_label: string;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  is_locked?: boolean;
}

// Regular fetch — only unlocked + active years (for all transaction dropdowns)
export const getFinYears = async () => {
  const res = await fetchWithAuth(BASE_URL);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

// Admin fetch — all years including locked/inactive (for the FinYear management page)
export const getAllFinYears = async () => {
  const res = await fetchWithAuth(`${BASE_URL}?all=true`);
  if (!res.ok) throw new Error(`GET failed: ${res.status}`);
  return res.json();
};

export const addFinYear = async (data: FinYearPayload) => {
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

export const updateFinYear = async (
  id: string | number,
  data: Partial<FinYearPayload>,
) => {
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

export const deleteFinYear = async (id: string | number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "DELETE failed");
  }
  return res.json();
};
