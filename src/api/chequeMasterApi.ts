import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/cheque-master";
const BANKS_URL = "/api/bank-master";
const COMPANY_URL = "/api/account-head/options?type=C";

// ─── Response handler ─────────────────────────────────────────────────────────
async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
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
  TotalCheques: number | null;
  Remarks: string | null;
  Status: boolean;
}

export interface DbBank {
  BId: number;
  BName: string | null;
  BBranch: string | null;
  BAccountNumber: string | null;
  BIfscCode: string | null;
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
  TotalCheques: number | null;
  Remarks: string | null;
  Status: boolean;
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const getCheques = (): Promise<DbCheque[]> =>
  fetchWithAuth(BASE).then((r) => handleResponse<DbCheque[]>(r));

export const getBanksForCheque = (): Promise<DbBank[]> =>
  fetchWithAuth(BANKS_URL).then((r) => handleResponse<DbBank[]>(r));

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
