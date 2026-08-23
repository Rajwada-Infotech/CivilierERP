import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/asset-transfer";

export interface TransferUser {
  id: number;
  name: string;
  avatar_url?: string | null;
  DepartmentId?: number | null;
  DepartmentName?: string | null;
}

export interface EligibleTransferAsset {
  AssetId: number;
  AssetName: string;
  AssetCode: string | null;
  AssetCategory: string;
  CompanyId: number | null;
  ProjectId: number | null;
  FinYear: string | null;
}

export interface TransferableAsset {
  AssetId: number;
  AssetName: string;
  AssetCode: string | null;
  AssetCategory: string;
  FAItemCode: string | null;
  CompanyId: number | null;
  ProjectId: number | null;
  FinYear: string | null;
  CustodianUserId: number | null;
  CustodianName: string | null;
  CustodianAvatar: string | null;
}

export interface TransferListItem {
  Id: number;
  DocNo: string | null;
  DocDate: string | null;
  TransferDate: string | null;
  FinYear: string | null;
  Remarks: string | null;
  CreatedAt: string;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCode: string | null;
  AssetCategory: string | null;
  FAItemCode: string | null;
  FromUserId: number;
  FromUserName: string | null;
  FromUserAvatar: string | null;
  ToUserId: number;
  ToUserName: string | null;
  ToUserAvatar: string | null;
  TransferredBy: number | null;
  TransferredByName: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
}

export type TransferDetail = TransferListItem;

export interface TransferPayload {
  docDate?: string;
  transferDate?: string;
  companyId?: number | null;
  projectId: number;
  finYear?: string;
  assetId: number;
  fromUserId: number;
  toUserId: number;
  departmentId: number;
  remarks: string;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getTransferUsers = async (): Promise<TransferUser[]> => {
  const res = await fetchWithAuth(`${BASE}/users`);
  if (!res.ok) await handleError(res, "Failed to fetch users");
  return res.json();
};

export const getEligibleTransferAssets = async (params: {
  fromUserId?: number;
  projectId?: number;
  companyId?: number;
  finYear?: string;
}): Promise<EligibleTransferAsset[]> => {
  const qs = new URLSearchParams();
  if (params.fromUserId) qs.set("fromUserId", String(params.fromUserId));
  if (params.projectId)  qs.set("projectId",  String(params.projectId));
  if (params.companyId)  qs.set("companyId",  String(params.companyId));
  if (params.finYear)    qs.set("finYear",    params.finYear);
  const res = await fetchWithAuth(`${BASE}/eligible-assets${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch eligible assets");
  return res.json();
};

export const getTransferableAssets = async (params: {
  projectId?: number;
  companyId?: number;
  finYear?: string;
}): Promise<TransferableAsset[]> => {
  const qs = new URLSearchParams();
  if (params.projectId)  qs.set("projectId",  String(params.projectId));
  if (params.companyId)  qs.set("companyId",  String(params.companyId));
  if (params.finYear)    qs.set("finYear",    params.finYear);
  const res = await fetchWithAuth(`${BASE}/transferable-assets${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch transferable assets");
  return res.json();
};

export const getAssetTransfers = async (params?: {
  companyId?: number;
  projectId?: number;
  finYear?: string;
  assetId?: number;
  fromUserId?: number;
  toUserId?: number;
  fromDate?: string;
  toDate?: string;
}): Promise<TransferListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId)  qs.set("companyId",  String(params.companyId));
  if (params?.projectId)  qs.set("projectId",  String(params.projectId));
  if (params?.finYear)    qs.set("finYear",    params.finYear);
  if (params?.assetId)    qs.set("assetId",    String(params.assetId));
  if (params?.fromUserId) qs.set("fromUserId", String(params.fromUserId));
  if (params?.toUserId)   qs.set("toUserId",   String(params.toUserId));
  if (params?.fromDate)   qs.set("fromDate",   params.fromDate);
  if (params?.toDate)     qs.set("toDate",     params.toDate);
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch asset transfers");
  return res.json();
};

export const getAssetTransfer = async (id: number): Promise<TransferDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch asset transfer");
  return res.json();
};

export const createAssetTransfer = async (data: TransferPayload): Promise<{ id: number; docNo: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create asset transfer");
  return res.json();
};

export const updateAssetTransfer = async (id: number, data: { transferDate?: string; remarks?: string }): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update asset transfer");
};
