import axios from "./axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BrsSourceType =
  | "PAYMENT"
  | "RECEIVED"
  | "CRM_RECEIVED"
  | "FUND_TRANSFER_OUT"
  | "FUND_TRANSFER_IN"
  | "LOAN_DISBURSED"
  | "LOAN_RECEIVED";

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
  ChequeNo: string | null;
  PayStatus: string;
  IsChequeCancelled: boolean | number; // SQL BIT comes back as 0/1 or true/false
  IsMatched: boolean | number; // SQL BIT comes back as 0/1 or true/false
  IsBounced: boolean | number;
  BounceDate: string | null;
  BounceReason: string | null;
  BounceRemarks: string | null;
  // Clearing timestamp — set when IsMatched flips to 1 (UpdatedAt on BRS row)
  ClearingDate: string | null;
  // The date the bank actually cleared this entry (operator-entered, not a
  // system timestamp) and who clicked Clear — both null once unclear'd.
  BankClearingDate: string | null;
  ClearedBy: string | null;
  // Re-issue chain
  ReplacementDocNo: string | null;       // DocNo of payment that replaced this bounced one
  ReplacementPaymentId: number | null;
  OriginalDocNo: string | null;          // DocNo of the bounced payment this one replaced
  OriginalPaymentId: number | null;
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
  bounceAmount: number;
  clearCount: number;
  unclearCount: number;
  bounceCount: number;
}

export interface BrsFilterOption {
  id: number;
  name: string;
  companyId?: number | null;
  companyName?: string | null;
  accountNoLast4?: string | null;
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
  toDate?: string;   // YYYY-MM-DD
  status?: "clear" | "unclear" | "bounced";
  page?: number;
  limit?: number;
}) => axios.get<BrsListResponse>("/brs", { params });

/** Mark a payment as Clear (bank-confirmed), recording the date it actually cleared in the bank */
export const markClear = (sourceType: BrsSourceType, sourceId: number, bankClearingDate: string) =>
  axios.put(`/brs/${sourceType}/${sourceId}/clear`, { bankClearingDate });

/** Mark a payment as Unclear (unconfirmed in passbook) */
export const markUnclear = (sourceType: BrsSourceType, sourceId: number) =>
  axios.put(`/brs/${sourceType}/${sourceId}/unclear`);

/** Mark a payment as bounced / dishonoured */
export const markBounced = (
  sourceType: BrsSourceType,
  sourceId: number,
  payload: { bounceDate: string; bounceReason: string; bounceRemarks?: string }
) => axios.put(`/brs/${sourceType}/${sourceId}/bounce`, payload);

