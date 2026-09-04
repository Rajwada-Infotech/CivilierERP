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
  FAItemCode: string | null;
  ItemName: string | null;
  VendorName: string | null;
  RepairExpenseType: "Direct" | "Indirect";
  Amount: number;
  SacCode: string | null;
  GstRatePct: number | null;
  TaxableAmount: number | null;
  GstAmount: number | null;
  TotalAmount: number | null;
  Status: "Draft" | "Posted" | "Cancelled";
  VoucherNo: string | null;
  CreatedAt: string;
  posting?: {
    voucherNo: string;
    isPosted: boolean;
    entries: { account: string; debit: number; credit: number }[];
    error?: string;
  } | null;
}

export const getMaintenanceList = (params?: { status?: string }): Promise<MaintenanceItem[]> => {
  const qs = params?.status ? `?status=${encodeURIComponent(params.status)}` : "";
  return getJson(`/api/fixed-asset-maintenance${qs}`, "Failed to load maintenance records");
};

export const getMaintenance = (id: number): Promise<MaintenanceItem> =>
  getJson(`/api/fixed-asset-maintenance/${id}`, "Failed to load record");

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

export const getFixedAssetTaggings = (): Promise<TaggingListItem[]> =>
  getJson("/api/fixed-asset-tagging", "Failed to load FA inventory");

// ── Inventory Import ────────────────────────────────────────────────────────
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
  CompanyName: string | null;
  ProjectName: string | null;
  GodownName: string | null;
  ItemId: string;
  ItemName: string | null;
  AssetCategory: string | null;
}

export const getInventoryImports = (): Promise<InventoryImportListItem[]> =>
  getJson("/api/fixed-asset-inventory-import", "Failed to load inventory imports");

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

export const getAssignments = (): Promise<AssignmentListItem[]> =>
  getJson("/api/fixed-asset-assignment", "Failed to load assignments");

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

export const getAssetTransfers = (): Promise<TransferListItem[]> =>
  getJson("/api/asset-transfer", "Failed to load asset transfers");

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
}

export const getQualityChecks = (): Promise<QualityCheckItem[]> =>
  getJson("/api/fixed-asset-quality-check", "Failed to load quality checks");
