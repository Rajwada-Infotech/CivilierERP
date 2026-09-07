// RN port of src/pages/material/FixedAssetRecord.tsx + src/api/
// fixedAssetApi.ts. Simplest of the recent Material masters — a pure
// register/CRUD of company assets with NO depreciation ledger, NO
// transfer/movement history, and NO GRN/PO link at all: Location/
// Department/Custodian are plain free-text columns (no FK master), and
// disposal is just an AssetStatus flip + optional sale fields with a
// client-computed profit/loss — nothing posts to any GL. Depreciation
// itself is a single straight-line snapshot computed fresh on every read
// (calcDepreciation below), never persisted per-period; the rate is
// copied from Depreciation Setup at create time and does NOT re-sync if
// the master rate changes later — matches web exactly, not a bug to fix
// here. No approval workflow of any kind (confirmed no ApprovalStatusChain
// usage on web) — "FixedAssetRecord" correctly does NOT belong in mobile's
// ApprovalTable union.
//
// Deviations from web, both intentional:
//  1. Suppliers use mobile's own established `/api/account-head/options`
//     convention (already used by debitNoteApi.ts, purchaseOrdersApi.ts)
//     rather than web's heavier full-record `/api/account-head?type=S`.
//  2. No server-side pagination exists either way (web's own list
//     endpoint returns everything unfiltered by page) — same here.
// Also dropped: print/export (page-rights exist for them but no UI ever
// used them on web), and the dead company/project list-filter state (web
// declares it but never wires a control to change it).
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/fixed-assets";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function normalizeArray<T>(payload: any): T[] {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type AssetStatus = "Active" | "Sold" | "Scrapped" | "Under Maintenance";

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
  DepreciationRate: number | null;
  AssetStatus: AssetStatus;
  SellingPrice: number | null;
  Status: string;
  CompanyId: number | null;
  CompanyName: string | null;
  ProjectId: number | null;
  ProjectName: string | null;
  SupplierId: number | null;
  SupplierName: string | null;
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
  assetName: string;
  assetCategory: string;
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
  custodian?: string;
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

// ─── CRUD (no server pagination — web fetches everything too) ─────────────

export const getFixedAssets = async (params: {
  category?: string; assetStatus?: string; finYear?: string; fromDate?: string; toDate?: string;
} = {}): Promise<FixedAssetListItem[]> => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
  const res = await fetchWithAuth(`${BASE}?${qs}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch fixed assets"));
  return normalizeArray<FixedAssetListItem>(await res.json().catch(() => []));
};

export const getFixedAsset = async (id: number | string): Promise<FixedAssetDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch fixed asset"));
  return res.json().catch(() => ({}));
};

export const createFixedAsset = async (payload: FixedAssetPayload): Promise<{ assetId: number; docNo: string; assetCode: string }> => {
  const res = await fetchWithAuth(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to create fixed asset"));
  return res.json().catch(() => ({}));
};

export const updateFixedAsset = async (id: number | string, payload: Partial<FixedAssetPayload>) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update fixed asset"));
  return res.json().catch(() => ({}));
};

export const deleteFixedAsset = async (id: number | string) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete fixed asset"));
  return res.json().catch(() => ({}));
};

// ─── Master data ────────────────────────────────────────────────────────────

export interface NameOption { id: string; name: string }

export const getCompanies = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((c) => ({ id: String(c.id), name: c.label ?? "" }));
};

export interface ProjectOption extends NameOption { companyId: string | null }

export const getProjects = async (): Promise<ProjectOption[]> => {
  const raw = await fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((p) => ({ id: String(p.id), name: p.label ?? "", companyId: p.company_id != null ? String(p.company_id) : null }));
};

export const getSuppliers = async (): Promise<NameOption[]> => {
  const raw = await fetchWithAuth("/api/account-head/options?type=S").then((r) => r.json().catch(() => []));
  return normalizeArray<any>(raw).map((s) => ({ id: String(s.id), name: s.label ?? "" }));
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => (r.FStatus === 1 || r.FStatus === true) && !r.FLocked)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

export interface DepreciationSetup {
  SetupId: number;
  AssetCategory: string;
  DepreciationType: string;
  DepreciationRate: number;
  EffectiveFrom: string;
  Status: "Active" | "Inactive";
}

export const getActiveDepreciationSetups = async (): Promise<DepreciationSetup[]> => {
  const res = await fetchWithAuth("/api/depreciation-setup/active");
  if (!res.ok) return [];
  return normalizeArray<DepreciationSetup>(await res.json().catch(() => []));
};

// ─── UI constants ───────────────────────────────────────────────────────────

// Seed list — Depreciation Setup is the real source of truth for what
// categories exist in practice; this is only shown before any rate has
// been configured, matching web's own fallback.
export const ASSET_CATEGORIES = ["Laptop", "Desktop", "Mobile Phone", "Printer", "Scanner", "Furniture", "Vehicle", "Machinery", "Other"];

export const ASSET_STATUS_OPTIONS: AssetStatus[] = ["Active", "Sold", "Scrapped", "Under Maintenance"];

export const STATUS_COLOR: Record<string, string> = {
  Active: "#059669",
  Sold: "#3b82f6",
  Scrapped: "#dc2626",
  "Under Maintenance": "#d97706",
};

// ─── Depreciation (straight-line, client-computed, never persisted) ────────
// DepreciationType is stored (e.g. "SLM") but never actually branched on —
// web always applies straight-line math regardless of the label. Kept
// identical here for parity rather than "fixed."
export interface DepreciationCalc {
  years: number;
  annualDepreciation: number;
  totalDepreciation: number;
  bookValue: number;
}

export function calcDepreciation(purchaseCost: number | null | undefined, rate: number | null | undefined, purchaseDate: string | null | undefined): DepreciationCalc | null {
  const cost = Number(purchaseCost);
  const r = Number(rate);
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(r) || r <= 0 || !purchaseDate) return null;
  const purchased = new Date(purchaseDate).getTime();
  if (!Number.isFinite(purchased)) return null;
  const years = Math.max(0, (Date.now() - purchased) / (365.25 * 24 * 60 * 60 * 1000));
  const annualDepreciation = cost * (r / 100);
  const totalDepreciation = Math.min(cost, annualDepreciation * years);
  const bookValue = Math.max(0, cost - totalDepreciation);
  return { years, annualDepreciation, totalDepreciation, bookValue };
}
