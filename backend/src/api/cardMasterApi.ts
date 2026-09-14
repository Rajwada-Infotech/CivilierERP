import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/card-master";
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
export interface DbCard {
  id: number;
  company_name: string | null;
  bank_id: number | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  card_network: string | null;
  card_type: string | null;
  card_holder_name: string | null;
  card_number: string | null;
  cvv: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  reminder_enabled: boolean;
  reminder_days: number | null;
  status: boolean;
}

export interface BankOption {
  id: number;
  label: string;
  accountNumber: string | null;
  ifscCode: string | null;
  branchName: string | null;
}

export interface CompanyOption {
  id: number;
  label: string;
}

export interface CardPayload {
  company_name: string | null;
  bank_id: number | null;
  bank_name: string | null;
  account_number: string | null;
  ifsc_code: string | null;
  card_network: string | null;
  card_type: string | null;
  card_holder_name: string | null;
  card_number: string | null;
  cvv: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  reminder_enabled: boolean;
  reminder_days: number | null;
  status: boolean;
}

// ─── API calls ────────────────────────────────────────────────────────────────
export const getCards = (): Promise<DbCard[]> =>
  fetchWithAuth(BASE).then((r) => handleResponse<DbCard[]>(r));

// Active cards for a specific bank — used by the Payment form's card
// selector so a bank with multiple cards can be disambiguated.
export const getCardsByBank = (bankId: number): Promise<DbCard[]> =>
  fetchWithAuth(`${BASE}?bankId=${bankId}`).then((r) =>
    handleResponse<DbCard[]>(r),
  );

export const getBanksForCard = (): Promise<BankOption[]> =>
  fetchWithAuth(BANKS_URL).then((r) => handleResponse<BankOption[]>(r));

export const getCompanyOptions = (): Promise<CompanyOption[]> =>
  fetchWithAuth(COMPANY_URL).then((r) => handleResponse<CompanyOption[]>(r));

export const addCard = (data: CardPayload): Promise<DbCard> =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => handleResponse<DbCard>(r));

export const updateCard = (
  id: string | number,
  data: CardPayload,
): Promise<{ success: boolean; message: string }> =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => handleResponse(r));

export const deleteCard = (
  id: string | number,
): Promise<{ success: boolean }> =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) =>
    handleResponse(r),
  );
