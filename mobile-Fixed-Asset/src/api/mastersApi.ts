// Master-data clients every Fixed Asset form needs — companies, projects,
// users, departments, godowns, suppliers, vendors, SAC codes, active
// depreciation setups. Mirrors the web app's src/api/* endpoints exactly
// (same URLs, same shapes), trimmed to what the mobile forms read.
import { fetchWithAuth } from "@/services/fetchWithAuth";

async function getJson<T>(url: string, fallback: string): Promise<T> {
  const res = await fetchWithAuth(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || fallback);
  }
  return res.json();
}

// ── Companies / Projects (dbo.enterprise) ──────────────────────────────────
export interface EnterpriseOption {
  id: number;
  label: string;
  belongs_to: string | null;
  company_id: number | null;
}

export const getCompanies = (): Promise<EnterpriseOption[]> =>
  getJson("/api/enterprises/options?type=C", "Failed to load companies");

export const getProjects = (): Promise<EnterpriseOption[]> =>
  getJson("/api/enterprises/options?type=P", "Failed to load projects");

// ── Users (active) — same endpoint the web Asset Transfer form uses ────────
export interface DirectoryUser {
  id: number;
  name: string;
  avatar_url: string | null;
  DepartmentId: number | null;
  DepartmentName: string | null;
}

export const getUsers = (): Promise<DirectoryUser[]> =>
  getJson("/api/asset-transfer/users", "Failed to load users");

// ── Departments ───────────────────────────────────────────────────────────
export interface DepartmentOption {
  Id: number;
  DepartmentName: string;
  IsActive: boolean;
}

export const getDepartments = (): Promise<DepartmentOption[]> =>
  getJson("/api/department-master", "Failed to load departments");

// ── Godowns ───────────────────────────────────────────────────────────────
export interface Godown {
  GodownID: number;
  GodownCode: string;
  GodownName: string;
  EnterpriseID: number | null;
  ProjectID: number | null;
  IsActive: boolean;
}

export const getGodowns = async (): Promise<Godown[]> => {
  const r = await getJson<{ data?: Godown[] } | Godown[]>("/api/godowns", "Failed to load godowns");
  const list = Array.isArray(r) ? r : r.data ?? [];
  return list.filter((g) => g.IsActive);
};

// ── Suppliers (ledger heads, type S) — Fixed Asset Record supplier field ───
export interface Supplier {
  LHeadId: number;
  LHeadName: string;
  LHeadCode?: string | null;
}

export const getSuppliers = (): Promise<Supplier[]> =>
  getJson("/api/account-head?type=S", "Failed to load suppliers");

// ── SAC codes (HSN rows with the Is-SAC toggle) — "Type of Repairs" field ──
export interface SacCode {
  HId: number;
  HCode: string;
  HDescription: string | null;
  HShortDescription: string | null;
  HStatus: boolean;
  HIsSAC: boolean;
}

export const getSacCodes = async (): Promise<SacCode[]> => {
  const rows = await getJson<SacCode[]>("/api/hsn", "Failed to load SAC codes");
  return Array.isArray(rows) ? rows.filter((r) => r.HIsSAC && r.HStatus !== false) : [];
};

// ── Active depreciation setups (category → type + rate autofill) ───────────
export interface DepreciationSetup {
  SetupId: number;
  AssetCategory: string;
  DepreciationType: string;
  DepreciationRate: number;
  EffectiveFrom: string;
  Status: "Active" | "Inactive";
}

export const getActiveDepreciationSetups = (): Promise<DepreciationSetup[]> =>
  getJson("/api/depreciation-setup/active", "Failed to load depreciation setups");

// ── Maintenance vendors (ledger heads usable as a vendor) ──────────────────
export interface Vendor {
  id: number;
  label: string;
  code: string | null;
  type: string | null;
}

export const getVendors = (): Promise<Vendor[]> =>
  getJson("/api/fixed-asset-maintenance/vendors", "Failed to load vendors");

// ── Fixed-Asset-category items (item master) — Inventory Import picker ─────
export interface FixedAssetItem {
  M_Id: string;
  M_Name: string;
  M_Group: string | null;
  M_code: string | null;
}

export const getFixedAssetItems = async (): Promise<FixedAssetItem[]> => {
  const rows = await getJson<FixedAssetItem[] & { M_Type?: string }[]>("/api/item-master", "Failed to load items");
  return (Array.isArray(rows) ? rows : []).filter(
    (r) => (r as { M_Type?: string }).M_Type === "Fixed Asset",
  );
};

// ── Financial years (unlocked + active) ───────────────────────────────────
export interface FinYearRow {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus: boolean;
  FisLocked: boolean;
}

export const getFinYears = async (): Promise<FinYearRow[]> => {
  const rows = await getJson<FinYearRow[]>("/api/fin-year", "Failed to load financial years");
  return Array.isArray(rows) ? rows : [];
};
