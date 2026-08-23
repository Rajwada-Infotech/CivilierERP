import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-tagging";

export interface EligibleAssetItem {
  ItemId: string;
  ItemName: string | null;
  AssetCategory: string | null;
  AvailableQty: number;
  TaggedQty: number;
  UntaggedQty: number;
}

export interface TaggingListItem {
  TagId: number;
  DocNo: string | null;
  DocDate: string | null;
  FinYear: string | null;
  TaggedQty: number;
  FAItemCode: string | null;
  Remarks: string | null;
  Status: "Tagged" | "Cancelled";
  CreatedBy: string | null;
  CreatedAt: string;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  GodownId: number | null;
  GodownName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCategory: string | null;
  AssetCode: string | null;
}

export interface TaggingDetail extends TaggingListItem {
  ItemId: string | null;
  BatchQuantity: number;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface UnassignedFAItemCode {
  TagId: number;
  FAItemCode: string;
  DocNo: string | null;
  ItemId: string | null;
  ItemName: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  GodownId: number | null;
  GodownName: string | null;
}

export interface TaggingPayload {
  docDate?: string;
  companyId?: number | null;
  projectId: number;
  finYear?: string;
  godownId: number;
  itemId: string;
  numberOfItems: number;
  remarks?: string;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getEligibleAssetItems = async (params?: {
  godownId?: number;
  companyId?: number;
  projectId?: number;
  finYear?: string;
}): Promise<EligibleAssetItem[]> => {
  const qs = new URLSearchParams();
  if (params?.godownId)  qs.set("godownId",  String(params.godownId));
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.finYear)   qs.set("finYear",   params.finYear);
  const res = await fetchWithAuth(`${BASE}/eligible-items${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch eligible fixed asset items");
  return res.json();
};

export const getUnassignedFAItemCodes = async (): Promise<UnassignedFAItemCode[]> => {
  const res = await fetchWithAuth(`${BASE}/unassigned-codes`);
  if (!res.ok) await handleError(res, "Failed to fetch unassigned FA Item Codes");
  return res.json();
};

export const getFixedAssetTaggings = async (params?: {
  companyId?: number;
  projectId?: number;
  finYear?: string;
  assetId?: number;
  godownId?: number;
  fromDate?: string;
  toDate?: string;
}): Promise<TaggingListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.finYear)   qs.set("finYear",   params.finYear);
  if (params?.assetId)   qs.set("assetId",   String(params.assetId));
  if (params?.godownId)  qs.set("godownId",  String(params.godownId));
  if (params?.fromDate)  qs.set("fromDate",  params.fromDate);
  if (params?.toDate)    qs.set("toDate",    params.toDate);
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch fixed asset tagging entries");
  return res.json();
};

export const getFixedAssetTagging = async (id: number): Promise<TaggingDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch fixed asset tagging entry");
  return res.json();
};

export const createFixedAssetTagging = async (data: TaggingPayload): Promise<{ tagId: number; docNo: string; codes: string[] }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create fixed asset tagging entry");
  return res.json();
};

export const updateFixedAssetTagging = async (id: number, data: { docDate?: string; remarks?: string }): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update fixed asset tagging entry");
};

export const deleteFixedAssetTagging = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete fixed asset tagging entry");
};
