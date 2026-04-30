import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/typeofdoc";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TypeOfDoc {
  TypeOfDocId: number;
  Prefix: string;
  Description: string;
  CompanyId: number | null;
  ProjectId: number | null;
  EntryTypeId: string; // UUID
  IsActive: boolean;
  // Joined fields
  EntryType: string | null;
  Eprefix: string | null;
  EDOC_N: string | null;
  CompanyName: string;
  ProjectName: string;
  CreatedAt: string | null;
  UpdatedAt: string | null;
}

export interface EntryTypeOption {
  EntryTypeId: string; // UUID
  EntryType: string;
  Eprefix: string | null;
  EDOC_N: string | null;
}

export interface TypeOfDocPayload {
  Prefix: string;
  Description: string;
  EntryTypeId: string;
  CompanyId?: number | null;
  ProjectId?: number | null;
  IsActive?: boolean;
}

// ─── GET ENTRY TYPE OPTIONS (for the dropdown in the form) ────────────────────
export const getEntryTypeOptions = async (): Promise<EntryTypeOption[]> => {
  const res = await fetchWithAuth(`${BASE}/entrytypes`);
  return handleResponse<EntryTypeOption[]>(res);
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getTypeOfDocs = async (): Promise<TypeOfDoc[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<TypeOfDoc[]>(res);
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
export const addTypeOfDoc = async (
  payload: TypeOfDocPayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Prefix: payload.Prefix.toUpperCase().trim(),
      Description: payload.Description.trim(),
      EntryTypeId: payload.EntryTypeId,
      CompanyId: payload.CompanyId ?? null,
      ProjectId: payload.ProjectId ?? null,
    }),
  });
  return handleResponse<{ message: string }>(res);
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateTypeOfDoc = async (
  id: number,
  payload: TypeOfDocPayload,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Prefix: payload.Prefix.toUpperCase().trim(),
      Description: payload.Description.trim(),
      EntryTypeId: payload.EntryTypeId,
      CompanyId: payload.CompanyId ?? null,
      ProjectId: payload.ProjectId ?? null,
      IsActive: payload.IsActive !== false,
    }),
  });
  return handleResponse<{ message: string }>(res);
};

// ─── DELETE (soft — sets IsActive = 0) ───────────────────────────────────────
export const deleteTypeOfDoc = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse<{ message: string }>(res);
};
