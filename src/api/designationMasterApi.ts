import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/designation-master";

export interface DesignationRow {
  Id: number;
  DesignationName: string;
  DesignationCode: string;
  DepartmentId: number | null;
  DepartmentName: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface DesignationPayload {
  DesignationName: string;
  DesignationCode: string;
  DepartmentId: number | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getDesignations = async (): Promise<DesignationRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addDesignation = async (payload: DesignationPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const updateDesignation = async (id: number, payload: DesignationPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const deleteDesignation = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
