import axios from "./axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrsSourceType = "PAYMENT" | "RECEIVED";

export interface BrsEntry {
  BRSID: number | null;
  SourceID: number;
  SourceType: BrsSourceType;
  PaymentName: string;
  CompanyName: string | null;
  CompanyID: number | null;
  BankID: number | null;
  BankName: string | null;
  Amount: number;
  PayDate: string; // ISO date string
  Mode: string;
  DocNo: string | null;
  TxnId: string | null;
  PayStatus: string;
  IsMatched: boolean | number; // SQL BIT comes back as 0/1 or true/false
  CreatedAt: string;
}

export interface BrsListResponse {
  data: BrsEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  clearAmount: number;
  unclearAmount: number;
  clearCount: number;
  unclearCount: number;
}

export interface BrsFilterOption {
  id: number;
  name: string;
  companyId?: number | null;
  companyName?: string | null;
}

export interface BrsFilters {
  companies: BrsFilterOption[];
  banks: BrsFilterOption[];
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const getBRSFilters = () => axios.get<BrsFilters>("/brs/filters");

export const getBRS = (params: {
  bankId?: number;
  companyName?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  status?: "clear" | "unclear";
  page?: number;
  limit?: number;
}) => axios.get<BrsListResponse>("/brs", { params });

/** Mark a payment as Clear (bank-confirmed) */
export const markClear = (sourceType: BrsSourceType, sourceId: number) =>
  axios.put(`/brs/${sourceType}/${sourceId}/clear`);

/** Mark a payment as Unclear (unconfirmed in passbook) */
export const markUnclear = (sourceType: BrsSourceType, sourceId: number) =>
  axios.put(`/brs/${sourceType}/${sourceId}/unclear`);
