// RN client for the Fixed Asset endpoints. Mirrors the web app's
// src/api/fixedAssetApi.ts + fixedAssetMaintenanceApi.ts shapes (same
// backend routes), trimmed to what the mobile screens read.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

// ── Fixed Asset Record ──────────────────────────────────────────────────────
export interface FixedAssetListItem {
  AssetId: number;
  DocNo: string | null;
  DocDate: string | null;
  FinYear: string | null;
  AssetName: string;
  AssetCategory: string;
  AssetCode: string | null;
  Brand: string | null;
  Model: string | null;
  SerialNumber: string | null;
  PurchaseDate: string | null;
  ActivationDate: string | null;
  PurchaseCost: number;
  Quantity: number;
  Location: string | null;
  Department: string | null;
  Custodian: string | null;
  CustodianUserId: number | null;
  DepreciationType: string | null;
  DepreciationRate: number | null;
  AssetStatus: "Pending" | "Active" | "Sold" | "Scrapped" | "Under Maintenance";
  SellingPrice: number | null;
  Status: string;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  SupplierId: number | null;
  SupplierName: string | null;
  GodownID: number | null;
  GodownName: string | null;
  SourceTagId: number | null;
  FAItemCode: string | null;
  RepairType: string | null;
}

export interface FixedAssetDetail extends FixedAssetListItem {
  DepreciationSetupId: number | null;
  UsefulLife: number | null;
  SaleDate: string | null;
  BuyerName: string | null;
  SaleRemarks: string | null;
  Remarks: string | null;
  PurchaseInvoiceRef: string | null;
  PictureBase64: string | null;
  SupplierCode: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface FixedAssetPayload {
  docDate?: string;
  companyId?: number | null;
  projectId?: number | null;
  finYear?: string;
  assetName?: string;
  assetCategory: string;
  sourceTagId?: number | null;
  brand?: string;
  model?: string;
  serialNumber?: string;
  purchaseDate?: string;
  activationDate?: string;
  purchaseInvoiceRef?: string;
  supplierId?: number | null;
  purchaseCost?: number;
  quantity?: number;
  location?: string;
  department?: string;
  custodianUserId?: number | null;
  depreciationSetupId?: number | null;
  depreciationType?: string;
  depreciationRate?: number | null;
  usefulLife?: number | null;
  assetStatus?: string;
  sellingPrice?: number | null;
  saleDate?: string;
  buyerName?: string;
  saleRemarks?: string;
  remarks?: string;
  status?: string;
  pictureBase64?: string | null;
  repairType?: string | null;
}

export const getFixedAssets = (params?: {
  companyId?: number; projectId?: number; category?: string; assetStatus?: string;
  finYear?: string; fromDate?: string; toDate?: string;
}): Promise<FixedAssetListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.category) qs.set("category", params.category);
  if (params?.assetStatus) qs.set("assetStatus", params.assetStatus);
  if (params?.finYear) qs.set("finYear", params.finYear);
  if (params?.fromDate) qs.set("fromDate", params.fromDate);
  if (params?.toDate) qs.set("toDate", params.toDate);
  return getJson(`/api/fixed-assets${qs.toString() ? `?${qs}` : ""}`, "Failed to load fixed assets");
};

export const getFixedAsset = (id: number): Promise<FixedAssetDetail> =>
  getJson(`/api/fixed-assets/${id}`, "Failed to load asset");

async function mutate<T>(url: string, method: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json().catch(() => ({} as T));
}

export const createFixedAsset = (data: FixedAssetPayload): Promise<{ assetId: number; docNo: string; assetCode: string }> =>
  mutate("/api/fixed-assets", "POST", data, "Failed to create fixed asset");

export const updateFixedAsset = (id: number, data: Partial<FixedAssetPayload>): Promise<{ ok: true }> =>
  mutate(`/api/fixed-assets/${id}`, "PUT", data, "Failed to update fixed asset");

export const deleteFixedAsset = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-assets/${id}`, "DELETE", undefined, "Failed to delete fixed asset");

// ── Delete & Reverse GRN / Import ──────────────────────────────────────────
export interface ReversalPlan {
  reversible: boolean;
  reason?: string;
  message: string;
  sourceType?: "GRN" | "IMPORT";
  grnDocNo?: string | null;
  unitCount?: number;
  taggedCount?: number;
  units?: { assetId: number; assetName: string; faItemCode: string | null }[];
}

export const getFixedAssetReversalPlan = (id: number): Promise<ReversalPlan> =>
  getJson(`/api/fixed-assets/${id}/can-reverse`, "Failed to check reversal eligibility");

export const reverseFixedAsset = (id: number): Promise<{ ok: true; grnDeleted: boolean; unitsRemoved: number; tagsRemoved: number }> =>
  mutate(`/api/fixed-assets/${id}/reverse`, "POST", undefined, "Failed to reverse this asset");

// Unassigned generated FA Item Codes — the Fixed Asset Record create picker.
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

export const getUnassignedFAItemCodes = (): Promise<UnassignedFAItemCode[]> =>
  getJson("/api/fixed-asset-tagging/unassigned-codes", "Failed to load unassigned FA Item Codes");

// ── Depreciation ────────────────────────────────────────────────────────────
export interface DepreciationEntry {
  EntryId: number;
  PeriodYear: number;
  PeriodMonth: number;
  FinYear: string | null;
  Method: string;
  RatePct: number;
  OpeningBookValue: number;
  DepreciationAmount: number;
  ClosingBookValue: number;
  AccumulatedDepreciation: number;
  Status: "Posted" | "Reversed";
  VoucherNo: string | null;
  PostedAt: string | null;
}

export interface DepreciationResponse {
  year: number;
  month: number;
  plan: {
    isPosted: boolean;
    voucherRef: string | null;
    error?: string;
    depreciation?: {
      method: string; ratePct: number; cost: number;
      openingBookValue: number; depreciationAmount: number;
      closingBookValue: number; accumulatedDepreciation: number; finYear: string;
    };
    entries?: { account: string; debit: number; credit: number }[];
  } | null;
  history: DepreciationEntry[];
}

export const getAssetDepreciation = (id: number, year: number, month: number): Promise<DepreciationResponse> =>
  getJson(`/api/fixed-assets/${id}/depreciation?year=${year}&month=${month}`, "Failed to load depreciation");

export const postAssetDepreciation = (id: number, year: number, month: number): Promise<{ ok: true; voucherNo: string; entryId: number }> =>
  mutate(`/api/fixed-assets/${id}/depreciation/post`, "POST", { year, month }, "Failed to post depreciation");

export const reverseAssetDepreciation = (id: number, entryId: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-assets/${id}/depreciation/${entryId}/reverse`, "POST", undefined, "Failed to reverse depreciation");

// ── Maintenance & Repair ────────────────────────────────────────────────────
export interface MaintenanceItem {
  MaintenanceId: number;
  DocNo: string;
  DocDate: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  CompanyId: number | null;
  ProjectId: number | null;
  AssetId: number;
  FAItemCode: string | null;
  ItemName: string | null;
  VendorId: number | null;
  VendorName: string | null;
  RepairExpenseType: "Direct" | "Indirect";
  Amount: number;
  SacCode: string | null;
  GstRatePct: number | null;
  TaxableAmount: number | null;
  GstAmount: number | null;
  TotalAmount: number | null;
  Remarks: string | null;
  Status: "Draft" | "Posted" | "Cancelled";
  VoucherNo: string | null;
  FinYear: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
  posting?: {
    voucherNo: string;
    isPosted: boolean;
    entries: { account: string; debit: number; credit: number }[];
    error?: string;
  } | null;
}

export interface MaintenanceAsset {
  AssetId: number; FAItemCode: string; AssetName: string; AssetCategory: string | null;
  CompanyId: number | null; ProjectId: number | null; FinYear: string | null;
  SacCode: string | null; SacDescription: string | null; GstRatePct: number | null;
}

export const getMaintenanceList = (params?: { status?: string; companyId?: number; projectId?: number; assetId?: number }): Promise<MaintenanceItem[]> => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId) qs.set("assetId", String(params.assetId));
  return getJson(`/api/fixed-asset-maintenance${qs.toString() ? `?${qs}` : ""}`, "Failed to load maintenance records");
};

export const getMaintenance = (id: number): Promise<MaintenanceItem> =>
  getJson(`/api/fixed-asset-maintenance/${id}`, "Failed to load record");

export const getMaintenanceAssets = (params: { companyId?: number; projectId?: number }): Promise<MaintenanceAsset[]> => {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  return getJson(`/api/fixed-asset-maintenance/assets${qs.toString() ? `?${qs}` : ""}`, "Failed to load assets");
};

export const getMaintenanceFaItemCodes = (params: { itemName: string; companyId?: number; projectId?: number }): Promise<MaintenanceAsset[]> => {
  const qs = new URLSearchParams({ itemName: params.itemName });
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  return getJson(`/api/fixed-asset-maintenance/fa-item-codes?${qs}`, "Failed to load FA Item Codes");
};

export interface MaintenancePayload {
  docDate: string; companyId: number; projectId: number;
  itemName: string; assetId: number; vendorId: number;
  repairExpenseType: "Direct" | "Indirect"; amount: number; remarks?: string; finYear?: string;
}

export const createMaintenance = (data: MaintenancePayload): Promise<{ maintenanceId: number; docNo: string }> =>
  mutate("/api/fixed-asset-maintenance", "POST", data, "Failed to create maintenance record");

export const updateMaintenance = (id: number, data: MaintenancePayload): Promise<{ ok: true; wasPosted: boolean }> =>
  mutate(`/api/fixed-asset-maintenance/${id}`, "PUT", data, "Failed to update maintenance record");

export const postMaintenance = (id: number): Promise<{ ok: true; voucherNo: string }> =>
  mutate(`/api/fixed-asset-maintenance/${id}/post`, "POST", undefined, "Failed to post maintenance voucher");

export const deleteMaintenance = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-maintenance/${id}`, "DELETE", undefined, "Failed to cancel maintenance record");

// ── FA Inventory (tagging) ──────────────────────────────────────────────────
// Mirrors the web app's src/api/fixedAssetTaggingApi.ts list shape.
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
  CompanyName: string | null;
  ProjectName: string | null;
  GodownName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCategory: string | null;
  AssetCode: string | null;
  RecordStatus: "Pending" | "Done" | null;
}

export interface TaggingDetail extends TaggingListItem {
  ItemId: string | null;
  BatchQuantity: number;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

export interface EligibleAssetItem {
  ItemId: string;
  ItemName: string | null;
  AssetCategory: string | null;
  AvailableQty: number;
  TaggedQty: number;
  UntaggedQty: number;
}

export const getFixedAssetTaggings = (params?: {
  companyId?: number; projectId?: number; finYear?: string; godownId?: number; fromDate?: string; toDate?: string;
}): Promise<TaggingListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.finYear) qs.set("finYear", params.finYear);
  if (params?.godownId) qs.set("godownId", String(params.godownId));
  if (params?.fromDate) qs.set("fromDate", params.fromDate);
  if (params?.toDate) qs.set("toDate", params.toDate);
  return getJson(`/api/fixed-asset-tagging${qs.toString() ? `?${qs}` : ""}`, "Failed to load FA inventory");
};

export const getFixedAssetTagging = (id: number): Promise<TaggingDetail> =>
  getJson(`/api/fixed-asset-tagging/${id}`, "Failed to load tagging entry");

// Depreciation Tag Stickers — assets whose Fixed Asset Depreciation Tag
// (Asset Register) process is complete: Status = Tagged, FAItemCode exists,
// AND a Fixed Asset Record was created from the tag. Nothing pending.
export interface TaggedFAItemCode {
  TagId: number;
  FAItemCode: string;
  ItemName: string | null;
  AssetId: number;
  AssetCode: string | null;
  DocNo: string | null;
  DocDate: string | null;
  FinYear: string | null;
  Status: "Tagged";
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  HasRecord: 1;
}

export const getTaggedFAItemCodes = (params?: {
  companyId?: number; finYear?: string; fromDate?: string; toDate?: string; faCode?: string; itemName?: string;
}): Promise<TaggedFAItemCode[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.finYear) qs.set("finYear", params.finYear);
  if (params?.fromDate) qs.set("fromDate", params.fromDate);
  if (params?.toDate) qs.set("toDate", params.toDate);
  if (params?.faCode) qs.set("faCode", params.faCode);
  if (params?.itemName) qs.set("itemName", params.itemName);
  return getJson(`/api/fixed-asset-tagging/tagged-codes${qs.toString() ? `?${qs}` : ""}`, "Failed to load FA Item Codes");
};

export const getEligibleAssetItems = (params: {
  godownId: number; companyId?: number; projectId?: number; finYear?: string;
}): Promise<EligibleAssetItem[]> => {
  const qs = new URLSearchParams({ godownId: String(params.godownId) });
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  if (params.finYear) qs.set("finYear", params.finYear);
  return getJson(`/api/fixed-asset-tagging/eligible-items?${qs}`, "Failed to load eligible items");
};

export const createFixedAssetTagging = (data: {
  docDate: string; companyId?: number | null; projectId: number; godownId: number; itemId: string; numberOfItems: number; remarks?: string;
}): Promise<{ tagId: number; docNo: string; codes: string[] }> =>
  mutate("/api/fixed-asset-tagging", "POST", data, "Failed to generate FA Item Codes");

export const updateFixedAssetTagging = (id: number, data: { docDate?: string; remarks?: string }): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-tagging/${id}`, "PUT", data, "Failed to update tagging entry");

export const deleteFixedAssetTagging = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-tagging/${id}`, "DELETE", undefined, "Failed to cancel tagging entry");

// ── Assignment ─────────────────────────────────────────────────────────────
export interface AssignmentListItem {
  AssignmentId: number;
  DocNo: string | null;
  DocDate: string | null;
  FinYear: string | null;
  Remarks: string | null;
  CreatedAt: string;
  CreatedBy: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCategory: string | null;
  AssetCode: string | null;
  FAItemCode: string | null;
  UserId: number;
  UserName: string | null;
  ResponsibleUserId: number | null;
  ResponsibleUserName: string | null;
  SourceTransferDocNo: string | null;
  IsCurrent: boolean;
}

export type AssignmentDetail = AssignmentListItem & { UserImage: string | null; ResponsibleUserAvatar: string | null; UserAvatar: string | null };

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

export const getAssignments = (params?: { companyId?: number; projectId?: number; assetId?: number; userId?: number }): Promise<AssignmentListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId) qs.set("assetId", String(params.assetId));
  if (params?.userId) qs.set("userId", String(params.userId));
  return getJson(`/api/fixed-asset-assignment${qs.toString() ? `?${qs}` : ""}`, "Failed to load assignments");
};

export const getAssignment = (id: number): Promise<AssignmentDetail> =>
  getJson(`/api/fixed-asset-assignment/${id}`, "Failed to load assignment");

export const getAssignableAssets = (): Promise<AssignableAsset[]> =>
  getJson("/api/fixed-asset-assignment/fa-item-codes", "Failed to load FA Item Codes");

export interface AssignmentPayload {
  docDate: string; companyId: number; projectId: number; finYear: string;
  assetId: number; userId: number; responsibleUserId: number; userImage?: string | null; remarks?: string;
}

export const createAssignment = (data: AssignmentPayload): Promise<{ assignmentId: number; docNo: string }> =>
  mutate("/api/fixed-asset-assignment", "POST", data, "Failed to create assignment");

export const updateAssignment = (id: number, data: {
  docDate: string; finYear: string; userId: number; responsibleUserId: number; userImage?: string | null; remarks?: string;
}): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-assignment/${id}`, "PUT", data, "Failed to update assignment");

export const deleteAssignment = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-assignment/${id}`, "DELETE", undefined, "Failed to delete assignment");

// ── User-Wise Asset Transfer ───────────────────────────────────────────────
export interface TransferListItem {
  Id: number;
  DocNo: string | null;
  DocDate: string | null;
  TransferDate: string | null;
  FinYear: string | null;
  Remarks: string | null;
  CreatedAt: string;
  CompanyName: string | null;
  ProjectName: string | null;
  AssetId: number;
  AssetName: string | null;
  AssetCode: string | null;
  AssetCategory: string | null;
  FAItemCode: string | null;
  FromUserId: number;
  FromUserName: string | null;
  ToUserId: number;
  ToUserName: string | null;
  TransferredByName: string | null;
  DepartmentName: string | null;
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
  PictureBase64: string | null;
  CustodianUserId: number | null;
  CustodianName: string | null;
}

export const getAssetTransfers = (params?: {
  companyId?: number; projectId?: number; finYear?: string; assetId?: number;
  fromUserId?: number; toUserId?: number; fromDate?: string; toDate?: string;
}): Promise<TransferListItem[]> => {
  const qs = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
  return getJson(`/api/asset-transfer${qs.toString() ? `?${qs}` : ""}`, "Failed to load asset transfers");
};

export const getAssetTransfer = (id: number): Promise<TransferListItem & { DepartmentId: number | null; CompanyId: number | null; ProjectId: number | null }> =>
  getJson(`/api/asset-transfer/${id}`, "Failed to load transfer");

export const getTransferableAssets = (params: { projectId?: number; companyId?: number; finYear?: string }): Promise<TransferableAsset[]> => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, String(v)); });
  return getJson(`/api/asset-transfer/transferable-assets${qs.toString() ? `?${qs}` : ""}`, "Failed to load transferable assets");
};

export interface TransferPayload {
  docDate?: string; transferDate?: string; companyId?: number | null; projectId: number; finYear?: string;
  assetId: number; fromUserId: number; toUserId: number; departmentId: number; remarks: string;
}

export const createAssetTransfer = (data: TransferPayload): Promise<{ id: number; docNo: string }> =>
  mutate("/api/asset-transfer", "POST", data, "Failed to create asset transfer");

export const updateAssetTransfer = (id: number, data: TransferPayload): Promise<{ ok: true }> =>
  mutate(`/api/asset-transfer/${id}`, "PUT", data, "Failed to update asset transfer");

export const deleteAssetTransfer = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/asset-transfer/${id}`, "DELETE", undefined, "Failed to delete asset transfer");

export const setAssetPicture = (assetId: number, pictureBase64: string | null): Promise<{ ok: true }> =>
  mutate(`/api/asset-transfer/asset-picture/${assetId}`, "PUT", { pictureBase64 }, "Failed to save item picture");

// ── Owner & Quality Checking ───────────────────────────────────────────────
export type QualityStatus = "Good" | "Average" | "Defective" | "Repairing";
export type FollowUpStatus = "Pending" | "Completed" | "Cancelled";

export interface QualityCheckItem {
  QualityCheckId: number;
  DocNo: string | null;
  DocDate: string | null;
  CompanyName: string | null;
  ProjectName: string | null;
  AssetId: number;
  AssetCode: string | null;
  FAItemCode: string | null;
  ItemName: string | null;
  CurrentUserName: string | null;
  QualityStatus: QualityStatus;
  Remarks: string | null;
  NextFollowUpDate: string | null;
  FollowUpType: string | null;
  ResponsibleUserName: string | null;
  FollowUpStatus: FollowUpStatus;
  Status: string;
  CreatedBy: string | null;
  CreatedAt: string;
  IsOverdue: 0 | 1;
  ItemPicture: string | null;
  UserPhoto: string | null;
  CurrentUserAvatar: string | null;
  ResponsibleUserAvatar: string | null;
  FollowUpRemarks: string | null;
  LastFollowUpDate: string | null;
  NextActionNotes: string | null;
  CompletedBy: string | null;
  CompletedAt: string | null;
}

export interface QCAsset {
  AssetId: number; FAItemCode: string; AssetName: string; AssetCategory: string | null;
  CompanyId: number | null; ProjectId: number | null; FinYear: string | null;
}

export interface QCAssetContext {
  assetId: number; faItemCode: string | null; itemName: string | null;
  companyId: number | null; projectId: number | null; finYear: string | null;
  itemPicture: string | null; itemPictureFromDocNo: string | null; itemPictureFromDate: string | null;
  currentUserId: number | null; currentUserName: string | null; currentUserAvatar: string | null;
  userPhoto: string | null; hasAssignment: boolean; assignmentId: number | null;
  responsibleUserId: number | null; responsibleUserName: string | null; responsibleUserAvatar: string | null;
}

export const getQualityChecks = (params?: {
  companyId?: number; projectId?: number; assetId?: number; followUpStatus?: FollowUpStatus; overdue?: boolean;
}): Promise<QualityCheckItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId) qs.set("assetId", String(params.assetId));
  if (params?.followUpStatus) qs.set("followUpStatus", params.followUpStatus);
  if (params?.overdue) qs.set("overdue", "1");
  return getJson(`/api/fixed-asset-quality-check${qs.toString() ? `?${qs}` : ""}`, "Failed to load quality checks");
};

export const getQualityCheck = (id: number): Promise<QualityCheckItem> =>
  getJson(`/api/fixed-asset-quality-check/${id}`, "Failed to load quality check");

export const getQCAssets = (params: { companyId?: number; projectId?: number }): Promise<QCAsset[]> => {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  return getJson(`/api/fixed-asset-quality-check/assets${qs.toString() ? `?${qs}` : ""}`, "Failed to load assets");
};

export const getQCAssetContext = (assetId: number): Promise<QCAssetContext> =>
  getJson(`/api/fixed-asset-quality-check/asset-context/${assetId}`, "Failed to load asset details");

export interface QualityCheckPayload {
  docDate?: string; companyId?: number | null; projectId?: number | null;
  assetId: number; qualityStatus: QualityStatus; remarks?: string; itemPicture?: string | null;
  nextFollowUpDate: string; followUpType?: string; followUpRemarks?: string;
  followUpStatus?: FollowUpStatus; lastFollowUpDate?: string; nextActionNotes?: string;
}

export const createQualityCheck = (data: QualityCheckPayload): Promise<{ qualityCheckId: number; docNo: string }> =>
  mutate("/api/fixed-asset-quality-check", "POST", data, "Failed to create quality check");

export const updateQualityCheck = (id: number, data: QualityCheckPayload): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-quality-check/${id}`, "PUT", data, "Failed to update quality check");

export const setFollowUpStatus = (id: number, status: FollowUpStatus): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-quality-check/${id}/follow-up-status`, "PATCH", { status }, "Failed to update follow-up status");

export const deleteQualityCheck = (id: number): Promise<{ ok: true }> =>
  mutate(`/api/fixed-asset-quality-check/${id}`, "DELETE", undefined, "Failed to delete quality check");
