import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/balance-enquiry";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore invalid JSON */
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export interface EnquiryBank {
  BId: number;
  BName: string | null;
  BBranch: string | null;
  BAccountNumber: string | null;
  BIfscCode: string | null;
  BAccountType: string | null;
  BBankType: string | null;
  BOpeningBalance: number;
  BCompanyName: string | null;
  BStatus: boolean;
}

export interface BalanceSummary {
  bank: EnquiryBank;
  openingBalance: number;
  currentBalance: number;
  windowOpeningBalance: number;
  periodDebit: number;
  periodCredit: number;
  periodTxnCount: number;
  lastTransactionDate: string | null;
}

export interface PassbookEntry {
  EntryId: number;
  VoucherNo: string;
  VoucherDate: string;
  DebitAmount: number;
  CreditAmount: number;
  Narration: string | null;
  SourceType: string;
  SourceId: number;
  CompanyId: number | null;
  ProjectId: number | null;
  CostCenterId: number | null;
  CostCenterCode: string | null;
  CostCenterName: string | null;
  NewPaymentDocNo: string | null;
  ReceivedPaymentDocNo: string | null;
  JournalVoucherNo: string | null;
  FundTransferDocNo: string | null;
  RunningBalance: number;
}

export interface TransactionsResponse {
  bank: EnquiryBank;
  windowOpeningBalance: number;
  transactions: PassbookEntry[];
}

export const getEnquiryBanks = async (companyName?: string): Promise<EnquiryBank[]> => {
  const qs = companyName ? `?companyName=${encodeURIComponent(companyName)}` : "";
  const res = await fetchWithAuth(`${BASE}/banks${qs}`);
  return handleResponse<EnquiryBank[]>(res);
};

export const getBalanceSummary = async (
  bankId: number,
  params: { from?: string; to?: string } = {},
): Promise<BalanceSummary> => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const res = await fetchWithAuth(`${BASE}/${bankId}/summary?${qs.toString()}`);
  return handleResponse<BalanceSummary>(res);
};

export const getPassbook = async (
  bankId: number,
  params: { from?: string; to?: string; limit?: number } = {},
): Promise<TransactionsResponse> => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}/${bankId}/transactions?${qs.toString()}`);
  return handleResponse<TransactionsResponse>(res);
};
