import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/profit-center";

export interface ProfitCenterRow {
  ProfitCenterId: number;
  Code: string;
  Name: string;
  Description: string | null;
  IsActive: boolean;
  ProjectId: number | null;
  ProjectName: string | null;
  GLAccountCount: number;
  GLAccountIds: string | null; // comma-separated LHeadIds
  GLAccountNames: string | null; // comma-separated names, for display
}

export interface ProfitCenterPayload {
  Code: string;
  Name: string;
  Description?: string | null;
  IsActive?: boolean;
  ProjectId?: number | null;
  GLAccountIds?: string[];
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getProfitCenters = async (): Promise<ProfitCenterRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getProfitCenterOptions = async (): Promise<
  { id: number; label: string; code: string }[]
> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handle(res);
};

export const addProfitCenter = async (payload: ProfitCenterPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const updateProfitCenter = async (
  id: number,
  payload: ProfitCenterPayload,
) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const deleteProfitCenter = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle(res);
};
