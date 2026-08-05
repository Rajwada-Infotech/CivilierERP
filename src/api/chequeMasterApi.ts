import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/cheque-master";
const BANKS_URL = "/api/account-head/bank-options";
const COMPANY_URL = "/api/enterprises/options?business_type=C";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch (_e) {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DbCheque {
  CId: number;
  CompanyId: number | null;
  BankId: number | null;
  AccountNumber: string | null;
  IFSCCode: string | null;
  ChequeLotNumber: string | null;
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
  // Full padded cheque-number string (leading zeros preserved), optionally
  // followed by the 9-char city/bank/branch MICR suffix. Use this for display —
  // ChequeStartNumber/ChequeEndNumber are numeric and lose leading zeros.
  ChequeStartMICR: string | null;
  ChequeEndMICR: string | null;
  TotalCheques: number | null;
  Remarks: string | null;
  Status: boolean;
  // Joined fields
  BankName: string | null;
  BankBranch: string | null;
  BankAccountType: string | null;
  CompanyName: string | null;
}

export interface BankOption {
  id: number;
  label: string;
  accountNumber: string | null;
  ifscCode: string | null;
  branchName: string | null;
  companyName: string | null;
}

export interface CompanyOption {
  id: number;
  label: string;
}

export interface ChequePayload {
  CompanyId: number | null;
  BankId: number | null;
  AccountNumber: string | null;
  IFSCCode: string | null;
  ChequeLotNumber: string | null;
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
  ChequeStartMICR: string | null;
  ChequeEndMICR: string | null;
  Remarks: string | null;
  Status: boolean;
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const getCheques = (): Promise<DbCheque[]> =>
  fetchWithAuth(BASE).then((r) => handleResponse<DbCheque[]>(r));

export const getBanksForCheque = (): Promise<BankOption[]> =>
  fetchWithAuth(BANKS_URL).then((r) => handleResponse<BankOption[]>(r));

export const getCompanyOptions = (): Promise<CompanyOption[]> =>
  fetchWithAuth(COMPANY_URL).then((r) => handleResponse<CompanyOption[]>(r));

export const addCheque = (data: ChequePayload): Promise<{ message: string }> =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => handleResponse(r));

export const updateCheque = (
  id: string | number,
  data: ChequePayload,
): Promise<{ message: string }> =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => handleResponse(r));

export const deleteCheque = (
  id: string | number,
): Promise<{ message: string }> =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) =>
    handleResponse(r),
  );