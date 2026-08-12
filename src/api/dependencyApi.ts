import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/dependency";

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
export interface DependencyType {
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
export interface DependencyOption {
  id: number;
  code: string;
  name: string;
}

export interface DependencyPayload {
  code: string;
  name: string;
  isActive?: boolean;
}

// ─── GET OPTIONS (lightweight dropdown list — active only) ────────────────────
export const getDependencyOptions = async (): Promise<DependencyOption[]> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handleResponse<DependencyOption[]>(res);
};

// ─── GET ALL (full management table — includes inactive) ─────────────────────
export const getDependencies = async (): Promise<DependencyType[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<DependencyType[]>(res);
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
// Backend: POST /api/dependency/create
export const addDependency = async (
  payload: DependencyPayload,
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
// Backend: PUT /api/dependency/update/:id
export const updateDependency = async (
  id: number,
  payload: DependencyPayload,
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
// Backend: DELETE /api/dependency/delete/:id
export const deleteDependency = async (
  id: number,
): Promise<{ success: boolean; message: string }> => {
  const res = await fetchWithAuth(`${BASE}/delete/${id}`, {
    method: "DELETE",
  });
  return handleResponse<{ success: boolean; message: string }>(res);
};
