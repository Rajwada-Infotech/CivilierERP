import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/godowns";

export interface Godown {
  GodownID: number;
  GodownCode: string;
  GodownName: string;
  ShortDesc: string | null;
  Description: string | null;
  Remarks: string | null;
  EnterpriseID: number | null;
  ProjectID: number | null;
  EnterpriseName: string | null;
  ProjectName: string | null;
  Location: string | null;
  IsActive: boolean;
  IsDeleted: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
  /** True for the one godown auto-created when its project was created. */
  IsProjectDefault: boolean;
}

export interface GodownsResponse {
  data: Godown[];
  total: number;
}

export const getGodowns = async (): Promise<GodownsResponse> => {
  const res = await fetchWithAuth(BASE);
  if (!res.ok) throw new Error(`Failed to fetch godowns: ${res.status}`);
  return res.json();
};

export const getGodown = async (id: number): Promise<Godown> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch godown: ${res.status}`);
  return res.json();
};

export interface CreateGodownPayload {
  GodownCode?: string;
  GodownName: string;
  ShortDesc?: string;
  Description?: string;
  Remarks?: string;
  EnterpriseID?: number | null;
  ProjectID?: number | null;
  Location?: string;
  IsActive?: boolean;
}

export const createGodown = async (
  payload: CreateGodownPayload,
): Promise<{ GodownID: number; message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Create failed: ${res.status}`);
  }
  return res.json();
};

export const updateGodown = async (
  id: number,
  payload: Partial<CreateGodownPayload>,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Update failed: ${res.status}`);
  }
  return res.json();
};

export const deleteGodown = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed: ${res.status}`);
  }
  return res.json();
};
