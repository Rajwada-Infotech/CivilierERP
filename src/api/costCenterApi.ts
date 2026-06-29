import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/cost-center";

export interface CostCenterRow {
  CostCenterId: number;
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

export interface CostCenterPayload {
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

export const getCostCenters = async (): Promise<CostCenterRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getCostCenterOptions = async (): Promise<
  { id: number; label: string; code: string }[]
> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handle(res);
};

export const addCostCenter = async (payload: CostCenterPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const updateCostCenter = async (
  id: number,
  payload: CostCenterPayload,
) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const deleteCostCenter = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle(res);
};
