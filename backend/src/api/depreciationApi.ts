import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/depreciation-setup";

export interface DepreciationSetup {
  SetupId: number;
  AssetCategory: string;
  DepreciationType: string;
  DepreciationRate: number;
  EffectiveFrom: string;
  Status: "Active" | "Inactive";
  CreatedBy: string | null;
  CreatedAt: string;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface DepreciationPayload {
  assetCategory: string;
  depreciationType?: string;
  depreciationRate: number;
  effectiveFrom: string;
  status?: "Active" | "Inactive";
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getDepreciationSetups = async (status?: string): Promise<DepreciationSetup[]> => {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetchWithAuth(`${BASE}${qs}`);
  if (!res.ok) await handleError(res, "Failed to fetch depreciation setups");
  return res.json();
};

export const getActiveDepreciationSetups = async (): Promise<DepreciationSetup[]> => {
  const res = await fetchWithAuth(`${BASE}/active`);
  if (!res.ok) await handleError(res, "Failed to fetch active depreciation setups");
  return res.json();
};

export const createDepreciationSetup = async (data: DepreciationPayload): Promise<void> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create depreciation setup");
};

export const updateDepreciationSetup = async (id: number, data: Partial<DepreciationPayload>): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update depreciation setup");
};

export const deleteDepreciationSetup = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete depreciation setup");
};
