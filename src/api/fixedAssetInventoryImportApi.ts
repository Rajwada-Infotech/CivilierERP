import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-inventory-import";

export interface InventoryImportListItem {
  ImportId: number;
  DocNo: string | null;
  DocDate: string | null;
  Quantity: number;
  Rate: number | null;
  Remarks: string | null;
  Status: "Active" | "Reversed";
  CreatedBy: string | null;
  CreatedAt: string;
  ReversedBy: string | null;
  ReversedAt: string | null;
  AssetId: number | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  GodownId: number;
  GodownName: string | null;
  ItemId: string;
  ItemName: string | null;
  AssetCategory: string | null;
}

export interface InventoryImportPayload {
  docDate: string;
  companyId?: number | null;
  projectId?: number | null;
  godownId: number;
  itemId: string;
  quantity: number;
  rate?: number | null;
  remarks?: string;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getInventoryImports = async (params?: {
  companyId?: number;
  projectId?: number;
  godownId?: number;
}): Promise<InventoryImportListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.godownId)  qs.set("godownId",  String(params.godownId));
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch inventory imports");
  return res.json();
};

export const createInventoryImport = async (
  data: InventoryImportPayload,
): Promise<{ importId: number; assetId: number; docNo: string; tagged: number }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create inventory import");
  return res.json();
};

export const deleteInventoryImport = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to reverse this import");
};
