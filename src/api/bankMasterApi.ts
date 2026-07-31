import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/bank-master";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    /* ignore invalid JSON responses */
  }

  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface BankRecord {
  BId: number;
  BName: string | null;
  BBranch: string | null;
  BAccountNumber: string | null;
  BIfscCode: string | null;
  BAccountType: string | null;
  BBankType: string | null;
  BAccountHolderName: string | null;
  BOpeningBalance: number | null;
  BAddress: string | null;
  BStatus: boolean;
  BCompanyName: string | null;
  BLBelongsTo: number | null;
  // Project tagging — optional, not-mandatory. A comma-joined list of
  // Project ids/names this bank is currently tagged to (see
  // crmProjectBanks.js's GET /for-project for what tagging actually does:
  // once tagged, this bank becomes the ONLY option offered for those
  // Projects and disappears from every other Project's dropdown).
  ProjectIds?: string | null;
  ProjectNames?: string | null;
}

export interface BankPayload {
  BName: string;
  BBranch?: string | null;
  BAccountNumber?: string | null;
  BIfscCode: string;
  BAccountType?: string | null;
  BBankType?: string | null;
  BAccountHolderName?: string | null;
  BOpeningBalance: number;
  BAddress?: string | null;
  BStatus: boolean;
  BCompanyName?: string | null;
  BLBelongsTo?: number | null;
  ProjectIds?: number[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const cleanIfsc = (value: string | null | undefined): string | null => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim().toUpperCase().slice(0, 11);
};

const cleanStr = (value: string | null | undefined): string | null => {
  if (!value || String(value).trim() === "") return null;
  return String(value).trim();
};

// ─── Company options (LHeadType = 'C') ───────────────────────────────────────
export interface CompanyOption {
  id: number;
  label: string;
}

export const getCompanyOptions = async (): Promise<CompanyOption[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  return handleResponse<CompanyOption[]>(res);
};

// ─── GET ALL BANKS ────────────────────────────────────────────────────────────
export const getBanks = async (): Promise<BankRecord[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<BankRecord[]>(res);
};

// ─── ADD BANK ─────────────────────────────────────────────────────────────────
export const addBank = async (
  formData: Record<string, unknown>,
): Promise<BankRecord> => {
  const payload: BankPayload = {
    BName: String(formData.BName || "").trim(),
    BBranch: cleanStr(formData.BBranch as string),
    BAccountNumber: cleanStr(formData.BAccountNumber as string),
    BIfscCode: cleanIfsc(formData.BIfscCode as string) || "", // required
    BAccountType: cleanStr(formData.BAccountType as string),
    BBankType: cleanStr(formData.BBankType as string),
    BAccountHolderName: cleanStr(formData.BAccountHolderName as string),
    BOpeningBalance: Number(formData.BOpeningBalance) || 0,
    BAddress: cleanStr(formData.BAddress as string),
    BStatus: formData.BStatus !== false,
    BCompanyName: cleanStr(formData.BCompanyName as string),
    BLBelongsTo:
      formData.BLBelongsTo != null ? Number(formData.BLBelongsTo) : null,
    ProjectIds: Array.isArray(formData.ProjectIds)
      ? (formData.ProjectIds as unknown[]).map((x) => Number(x)).filter(Number.isFinite)
      : undefined,
  };

  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse<BankRecord>(res);
};

// ─── UPDATE BANK ──────────────────────────────────────────────────────────────
export const updateBank = async (
  id: number | string,
  formData: Record<string, unknown>,
): Promise<{ success: boolean; message: string }> => {
  const payload: BankPayload = {
    BName: String(formData.BName || "").trim(),
    BBranch: cleanStr(formData.BBranch as string),
    BAccountNumber: cleanStr(formData.BAccountNumber as string),
    BIfscCode: cleanIfsc(formData.BIfscCode as string) || "",
    BAccountType: cleanStr(formData.BAccountType as string),
    BBankType: cleanStr(formData.BBankType as string),
    BAccountHolderName: cleanStr(formData.BAccountHolderName as string),
    BOpeningBalance: Number(formData.BOpeningBalance) || 0,
    BAddress: cleanStr(formData.BAddress as string),
    BStatus: formData.BStatus !== false,
    BCompanyName: cleanStr(formData.BCompanyName as string),
    BLBelongsTo:
      formData.BLBelongsTo != null ? Number(formData.BLBelongsTo) : null,
    ProjectIds: Array.isArray(formData.ProjectIds)
      ? (formData.ProjectIds as unknown[]).map((x) => Number(x)).filter(Number.isFinite)
      : undefined,
  };

  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return handleResponse(res);
};

// ─── DELETE BANK ──────────────────────────────────────────────────────────────
export const deleteBank = async (
  id: number | string,
): Promise<{ success: boolean }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
