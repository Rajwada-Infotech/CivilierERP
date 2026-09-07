import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-quality-check";

export const QUALITY_STATUSES = ["Good", "Average", "Defective", "Repairing"] as const;
export const FOLLOWUP_TYPES = ["Inspection", "Repair Follow-Up", "Maintenance", "Recheck"] as const;
export const FOLLOWUP_STATUSES = ["Pending", "Completed", "Cancelled"] as const;

export type QualityStatus = (typeof QUALITY_STATUSES)[number];
export type FollowUpStatus = (typeof FOLLOWUP_STATUSES)[number];

export interface QCAsset {
  AssetId: number;
  FAItemCode: string;
  AssetName: string;
  AssetCategory: string | null;
  CompanyId: number | null;
  ProjectId: number | null;
  FinYear: string | null;
}

export interface AssetContext {
  assetId: number;
  faItemCode: string | null;
  itemName: string | null;
  companyId: number | null;
  projectId: number | null;
  finYear: string | null;
  itemPicture: string | null;          // previous/latest image for reference (from the most recent QC record)
  itemPictureFromDocNo: string | null;
  itemPictureFromDate: string | null;
  currentUserId: number | null;
  currentUserName: string | null;
  currentUserAvatar: string | null;
  userPhoto: string | null;
  hasAssignment: boolean;
  assignmentId: number | null;
  responsibleUserId: number | null;
  responsibleUserName: string | null;
  responsibleUserAvatar: string | null;
}

export interface QualityCheckItem {
  QualityCheckId: number;
  DocNo: string | null;
  DocDate: string | null;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  AssetId: number;
  AssetCode: string | null;
  FAItemCode: string | null;
  ItemName: string | null;
  ItemPicture: string | null;
  CurrentUserId: number | null;
  CurrentUserName: string | null;
  CurrentUserAvatar: string | null;
  UserPhoto: string | null;
  QualityStatus: QualityStatus;
  Remarks: string | null;
  NextFollowUpDate: string | null;
  FollowUpType: string | null;
  FollowUpRemarks: string | null;
  ResponsibleUserId: number | null;
  ResponsibleUserName: string | null;
  ResponsibleUserAvatar: string | null;
  FollowUpStatus: FollowUpStatus;
  LastFollowUpDate: string | null;
  NextActionNotes: string | null;
  CompletedBy: string | null;
  CompletedAt: string | null;
  Status: string;
  CreatedBy: string | null;
  CreatedAt: string;
  IsOverdue: 0 | 1;
}

export interface QualityCheckPayload {
  docDate?: string;
  companyId?: number | null;
  projectId?: number | null;
  assetId: number;
  qualityStatus: QualityStatus;
  remarks?: string;
  itemPicture?: string | null;   // this record's own captured image
  nextFollowUpDate: string;
  followUpType?: string;
  followUpRemarks?: string;
  responsibleUserId?: number | null;
  followUpStatus?: FollowUpStatus;
  lastFollowUpDate?: string;
  nextActionNotes?: string;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getQCAssets = async (params: { companyId?: number; projectId?: number }): Promise<QCAsset[]> => {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  const res = await fetchWithAuth(`${BASE}/assets${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch assets");
  return res.json();
};

export const getAssetContext = async (assetId: number): Promise<AssetContext> => {
  const res = await fetchWithAuth(`${BASE}/asset-context/${assetId}`);
  if (!res.ok) await handleError(res, "Failed to fetch asset details");
  return res.json();
};

export const getQualityChecks = async (params?: {
  companyId?: number; projectId?: number; assetId?: number;
  followUpStatus?: FollowUpStatus; overdue?: boolean;
}): Promise<QualityCheckItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId) qs.set("assetId", String(params.assetId));
  if (params?.followUpStatus) qs.set("followUpStatus", params.followUpStatus);
  if (params?.overdue) qs.set("overdue", "1");
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch quality checks");
  return res.json();
};

export const getQualityCheck = async (id: number): Promise<QualityCheckItem> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch quality check");
  return res.json();
};

export const createQualityCheck = async (data: QualityCheckPayload): Promise<{ qualityCheckId: number; docNo: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create quality check");
  return res.json();
};

export const updateQualityCheck = async (id: number, data: QualityCheckPayload): Promise<{ ok: true }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update quality check");
  return res.json();
};

export const setFollowUpStatus = async (id: number, status: FollowUpStatus): Promise<{ ok: true }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/follow-up-status`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
  });
  if (!res.ok) await handleError(res, "Failed to update follow-up status");
  return res.json();
};

export const deleteQualityCheck = async (id: number): Promise<{ ok: true }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete quality check");
  return res.json();
};

