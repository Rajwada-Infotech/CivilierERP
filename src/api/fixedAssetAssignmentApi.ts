import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-assignment";

export interface AssignableAsset {
  AssetId: number;
  FAItemCode: string;
  AssetName: string;
  AssetCategory: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  CustodianUserId: number | null;
  CurrentCustodianName: string | null;
}

export interface AssignmentListItem {
  AssignmentId: number;
  DocNo: string | null;
  DocDate: string | null;
  FinYear: string | null;
  Remarks: string | null;
  CreatedAt: string;
  CreatedBy: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCategory: string | null;
  AssetCode: string | null;
  FAItemCode: string | null;
  UserId: number;
  UserName: string | null;
  UserAvatar: string | null;
  IsCurrent: boolean;
}

export type AssignmentDetail = AssignmentListItem & { UserImage: string | null };

export interface AssignmentPayload {
  docDate: string;
  companyId: number;
  projectId: number;
  finYear: string;
  assetId: number;
  userId: number;
  userImage?: string | null;
  remarks?: string;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getAssignableAssets = async (): Promise<AssignableAsset[]> => {
  const res = await fetchWithAuth(`${BASE}/fa-item-codes`);
  if (!res.ok) await handleError(res, "Failed to fetch FA Item Codes");
  return res.json();
};

export const getAssignments = async (params?: {
  companyId?: number;
  projectId?: number;
  assetId?: number;
  userId?: number;
}): Promise<AssignmentListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId)   qs.set("assetId",   String(params.assetId));
  if (params?.userId)    qs.set("userId",    String(params.userId));
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch assignments");
  return res.json();
};

export const getAssignment = async (id: number): Promise<AssignmentDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch assignment");
  return res.json();
};

export const createAssignment = async (data: AssignmentPayload): Promise<{ assignmentId: number; docNo: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create assignment");
  return res.json();
};
