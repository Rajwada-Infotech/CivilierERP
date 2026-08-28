import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-assets";

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
}

export interface FixedAssetDetail extends FixedAssetListItem {
  DepreciationSetupId: number | null;
  DepreciationType: string | null;
  UsefulLife: number | null;
  SaleDate: string | null;
  BuyerName: string | null;
  SaleRemarks: string | null;
  Remarks: string | null;
  PurchaseInvoiceRef: string | null;
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
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getFixedAssets = async (params?: {
  companyId?: number;
  projectId?: number;
  category?: string;
  assetStatus?: string;
  finYear?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<FixedAssetListItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId)   qs.set("companyId",   String(params.companyId));
  if (params?.projectId)   qs.set("projectId",   String(params.projectId));
  if (params?.category)    qs.set("category",    params.category);
  if (params?.assetStatus) qs.set("assetStatus", params.assetStatus);
  if (params?.finYear)     qs.set("finYear",      params.finYear);
  if (params?.fromDate)    qs.set("fromDate",     params.fromDate);
  if (params?.toDate)      qs.set("toDate",       params.toDate);
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch fixed assets");
  return res.json();
};

export const getFixedAsset = async (id: number): Promise<FixedAssetDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch fixed asset");
  return res.json();
};

export const createFixedAsset = async (data: FixedAssetPayload): Promise<{ assetId: number; docNo: string; assetCode: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create fixed asset");
  return res.json();
};

export const updateFixedAsset = async (id: number, data: Partial<FixedAssetPayload>): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update fixed asset");
};

export const deleteFixedAsset = async (id: number): Promise<void> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete fixed asset");
};

// ── Delete & Reverse GRN ────────────────────────────────────────────────────
// A distinct, more destructive action from deleteFixedAsset above — see
// backend/services/fixedAssetReversal.js for exactly what it does.
export interface ReversalPlan {
  reversible: boolean;
  reason?: "not_source_linked" | "already_deleted" | "disposed" | "transferred" | "has_expense" | "grn_missing";
  message: string;
  sourceType?: "GRN" | "IMPORT";
  sourceId?: number;
  batchAssetId?: number;
  batchAssetName?: string;
  grnDocNo?: string | null;
  unitCount?: number;
  taggedCount?: number;
  units?: { assetId: number; assetName: string; faItemCode: string | null }[];
  blockedAssetIds?: number[];
}

export interface ReversalResult {
  ok: true;
  sourceType: "GRN" | "IMPORT";
  sourceId: number;
  grnDeleted: boolean;
  linkedPOId: number | null;
  unitsRemoved: number;
  tagsRemoved: number;
}

export const getFixedAssetReversalPlan = async (id: number): Promise<ReversalPlan> => {
  const res = await fetchWithAuth(`${BASE}/${id}/can-reverse`);
  if (!res.ok) await handleError(res, "Failed to check reversal eligibility");
  return res.json();
};

export const reverseFixedAsset = async (id: number): Promise<ReversalResult> => {
  const res = await fetchWithAuth(`${BASE}/${id}/reverse`, { method: "POST" });
  if (!res.ok) await handleError(res, "Failed to reverse this asset");
  return res.json();
};
