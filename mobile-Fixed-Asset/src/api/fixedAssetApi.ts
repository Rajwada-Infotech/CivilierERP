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
  DepreciationType: string | null;
  DepreciationRate: number | null;
  AssetStatus: "Pending" | "Active" | "Sold" | "Scrapped" | "Under Maintenance";
  Status: string;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  SupplierName: string | null;
  FAItemCode: string | null;
  RepairType: string | null;
}

export interface FixedAssetDetail extends FixedAssetListItem {
  UsefulLife: number | null;
  SellingPrice: number | null;
  SaleDate: string | null;
  BuyerName: string | null;
  Remarks: string | null;
  PurchaseInvoiceRef: string | null;
  PictureBase64: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export const getFixedAssets = (params?: {
  companyId?: number; projectId?: number; category?: string; assetStatus?: string; finYear?: string;
}): Promise<FixedAssetListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.category) qs.set("category", params.category);
  if (params?.assetStatus) qs.set("assetStatus", params.assetStatus);
  if (params?.finYear) qs.set("finYear", params.finYear);
  return getJson(`/api/fixed-assets${qs.toString() ? `?${qs}` : ""}`, "Failed to load fixed assets");
};

export const getFixedAsset = (id: number): Promise<FixedAssetDetail> =>
  getJson(`/api/fixed-assets/${id}`, "Failed to load asset");

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
