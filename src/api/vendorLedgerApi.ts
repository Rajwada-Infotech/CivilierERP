import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/vendor-ledger";

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

export interface LedgerHead {
  Id: number;
  Name: string | null;
  Type: string | null;
  Code: string | null;
  CompanyName: string | null;
}

export interface LedgerSummary {
  head: LedgerHead;
  openingBalance: number;
  currentBalance: number;
  windowOpeningBalance: number;
  periodDebit: number;
  periodCredit: number;
  periodTxnCount: number;
  lastTransactionDate: string | null;
}

export interface LedgerEntry {
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
  ExpenseBookingDocNo: string | null;
  LoanDocNo: string | null;
  // Present only on a single party's ledger (/:headId/transactions) — a
  // running balance across mixed parties wouldn't mean anything.
  RunningBalance?: number;
  // Present only on the unfiltered all-parties view (/all-transactions).
  LHeadId?: number;
  PartyName?: string | null;
  PartyType?: string | null;
}

export interface LedgerTransactionsResponse {
  head: LedgerHead;
  windowOpeningBalance: number;
  transactions: LedgerEntry[];
}

export interface AllLedgerTransactionsResponse {
  transactions: LedgerEntry[];
}

export const searchLedgerHeads = async (q: string): Promise<LedgerHead[]> => {
  const res = await fetchWithAuth(`${BASE}/search?q=${encodeURIComponent(q)}`);
  return handleResponse<LedgerHead[]>(res);
};

export const getLedgerSummary = async (
  headId: number,
  params: { from?: string; to?: string } = {},
): Promise<LedgerSummary> => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const res = await fetchWithAuth(`${BASE}/${headId}/summary?${qs.toString()}`);
  return handleResponse<LedgerSummary>(res);
};

export const getLedgerTransactions = async (
  headId: number,
  params: { from?: string; to?: string; limit?: number } = {},
): Promise<LedgerTransactionsResponse> => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}/${headId}/transactions?${qs.toString()}`);
  return handleResponse<LedgerTransactionsResponse>(res);
};

export const getAllLedgerTransactions = async (
  params: { from?: string; to?: string; limit?: number } = {},
): Promise<AllLedgerTransactionsResponse> => {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetchWithAuth(`${BASE}/all-transactions?${qs.toString()}`);
  return handleResponse<AllLedgerTransactionsResponse>(res);
};
