import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/contractor-category";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ContractorCategory {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

// Lightweight shape used in dropdowns (returned by /options)
export interface ContractorCategoryOption {
  id: number;
  code: string;
  name: string;
}

export interface ContractorCategoryPayload {
  code: string;
  name: string;
  isActive?: boolean;
}

// ─── GET OPTIONS (lightweight dropdown list — active only) ────────────────────
export const getContractorCategoryOptions =
  async (): Promise<ContractorCategoryOption[]> => {
    const res = await fetchWithAuth(`${BASE}/options`);
    return handleResponse<ContractorCategoryOption[]>(res);
  };

// ─── GET ALL (full management table — includes inactive) ─────────────────────
export const getContractorCategories = async (): Promise<
  ContractorCategory[]
> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<ContractorCategory[]>(res);
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
// Backend: POST /api/contractor-category/create
export const addContractorCategory = async (
  payload: ContractorCategoryPayload,
): Promise<{ success: boolean; id: number; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: payload.code.trim().toUpperCase(),
      name: payload.name.trim(),
      isActive: payload.isActive !== false,
    }),
  });
  return handleResponse<{ success: boolean; id: number; message: string }>(res);
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
// Backend: PUT /api/contractor-category/update/:id
export const updateContractorCategory = async (
  id: number,
  payload: ContractorCategoryPayload,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/update/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: payload.code.trim().toUpperCase(),
      name: payload.name.trim(),
      isActive: payload.isActive !== false,
    }),
  });
  return handleResponse<{ success: boolean; message: string }>(res);
};

// ─── DELETE (soft — sets isActive = 0) ───────────────────────────────────────
// Backend: DELETE /api/contractor-category/delete/:id
export const deleteContractorCategory = async (
  id: number,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/delete/${id}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean; message: string }>(res);
};