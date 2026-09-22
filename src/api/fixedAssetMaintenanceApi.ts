import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fixed-asset-maintenance";

export const REPAIR_EXPENSE_TYPES = ["Direct", "Indirect"] as const;
export type RepairExpenseType = (typeof REPAIR_EXPENSE_TYPES)[number];

export const REPAIR_EXPENSE_LABEL: Record<RepairExpenseType, string> = {
  Direct: "Direct Repair Expense",
  Indirect: "Indirect Repair Expense",
};

export interface FAMaintAsset {
  AssetId: number;
  FAItemCode: string;
  AssetName: string;
  AssetCategory: string | null;
  CompanyId: number | null;
  ProjectId: number | null;
  FinYear: string | null;
  SacCode: string | null;          // configured on the Fixed Asset Depreciation Tag
  SacDescription: string | null;
  GstRatePct: number | null;       // resolved from the HSN master for that SAC
}

export interface VendorOption {
  id: number;
  label: string;
  code: string | null;
  type: string | null;
}

export interface PostingEntry {
  account: string;
  debit: number;
  credit: number;
}

export interface PostingGst {
  sacCode: string | null;
  sacDescription: string | null;
  ratePct: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
}

export interface PostingPlan {
  voucherNo: string;
  isPosted: boolean;
  entries: PostingEntry[];
  gst?: PostingGst;
  error?: string;
}

export interface MaintenanceItem {
  MaintenanceId: number;
  DocNo: string;
  DocDate: string | null;
  FinYear: string | null;
  CompanyId: number;
  CompanyName: string | null;
  ProjectId: number;
  ProjectName: string | null;
  AssetId: number;
  AssetCode: string | null;
  FAItemCode: string | null;
  ItemName: string | null;
  VendorId: number;
  VendorName: string | null;
  RepairExpenseType: RepairExpenseType;
  Amount: number;
  SacCode: string | null;
  GstRatePct: number | null;
  TaxableAmount: number | null;
  GstAmount: number | null;
  TotalAmount: number | null;
  Remarks: string | null;
  Status: "Draft" | "Posted" | "Cancelled";
  VoucherNo: string | null;
  PostedBy: string | null;
  PostedAt: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
  posting?: PostingPlan | null;
}

export interface MaintenancePayload {
  companyId: number;
  projectId: number;
  docDate: string;
  itemName: string;
  assetId: number;
  vendorId: number;
  repairExpenseType: RepairExpenseType;
  amount: number;
  remarks?: string;
}

export interface NextNumber {
  nextDocNo: string;
  prefix: string;
  nextSeq: number;
  finYear: string | null;
}

async function handleError(res: Response, fallback: string) {
  const err = await res.json().catch(() => ({}));
  throw new Error((err as { error?: string }).error || fallback);
}

export const getMaintAssets = async (params: { companyId?: number; projectId?: number }): Promise<FAMaintAsset[]> => {
  const qs = new URLSearchParams();
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  const res = await fetchWithAuth(`${BASE}/assets${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch assets");
  return res.json();
};

export const getFaItemCodesByItem = async (params: {
  itemName: string; companyId?: number; projectId?: number;
}): Promise<FAMaintAsset[]> => {
  const qs = new URLSearchParams({ itemName: params.itemName });
  if (params.companyId) qs.set("companyId", String(params.companyId));
  if (params.projectId) qs.set("projectId", String(params.projectId));
  const res = await fetchWithAuth(`${BASE}/fa-item-codes?${qs}`);
  if (!res.ok) await handleError(res, "Failed to fetch FA Item Codes");
  return res.json();
};

export const getNextNumber = async (finYear?: string | null): Promise<NextNumber> => {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`${BASE}/next-number${qs}`);
  if (!res.ok) await handleError(res, "Failed to fetch next document number");
  return res.json();
};

export const getMaintVendors = async (): Promise<VendorOption[]> => {
  const res = await fetchWithAuth(`${BASE}/vendors`);
  if (!res.ok) await handleError(res, "Failed to fetch vendors");
  return res.json();
};

export const getMaintenanceList = async (params?: {
  companyId?: number; projectId?: number; assetId?: number; status?: string;
}): Promise<MaintenanceItem[]> => {
  const qs = new URLSearchParams();
  if (params?.companyId) qs.set("companyId", String(params.companyId));
  if (params?.projectId) qs.set("projectId", String(params.projectId));
  if (params?.assetId) qs.set("assetId", String(params.assetId));
  if (params?.status) qs.set("status", params.status);
  const res = await fetchWithAuth(`${BASE}${qs.toString() ? `?${qs}` : ""}`);
  if (!res.ok) await handleError(res, "Failed to fetch records");
  return res.json();
};

export const getMaintenance = async (id: number): Promise<MaintenanceItem> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) await handleError(res, "Failed to fetch record");
  return res.json();
};

export const getPostingPreview = async (id: number): Promise<PostingPlan> => {
  const res = await fetchWithAuth(`${BASE}/${id}/posting-preview`);
  if (!res.ok) await handleError(res, "Failed to fetch posting preview");
  return res.json();
};

export const createMaintenance = async (data: MaintenancePayload): Promise<{ maintenanceId: number; docNo: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to create record");
  return res.json();
};

export const updateMaintenance = async (id: number, data: MaintenancePayload): Promise<{ ok: true; wasPosted?: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  if (!res.ok) await handleError(res, "Failed to update record");
  return res.json();
};

export const postMaintenance = async (id: number): Promise<{ ok: true; voucherNo: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}/post`, { method: "POST" });
  if (!res.ok) await handleError(res, "Failed to post record");
  return res.json();
};

export const deleteMaintenance = async (id: number): Promise<{ ok: true }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) await handleError(res, "Failed to delete record");
  return res.json();
};
