import axios from "./axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChequeSearchResult {
  PPaymentID: number;
  DocNo: string | null;
  PPaymentName: string | null;
  PRemarks: string | null;
  PAmount: number;
  PDate: string;
  PMode: string;
  PProject: string | null;
  PCompany: string | null;
  PExpenseRef: string | null;
  Status: string;
  PChequeNo: string;
  PChequeLotId: number | null;
  PChequeLotNumber: string | null;
  PChequeDate: string | null;
  PChequeAccountNumber: string | null;
  PChequeIfsc: string | null;
  PIsPostDated: boolean | number;
  PBankID: number | null;
  PIsChequeCancelled: boolean | number;
  BankName: string | null;
  BankBranch: string | null;
  LotNumber: string | null;
  CancelledCheckId: number | null;
}

export interface BulkSearchResult {
  chequeNo: string;
  found: boolean;
  alreadyCancelled: boolean;
  payment: ChequeSearchResult | null;
}

export interface CancelledChequeRecord {
  CCId: number;
  ChequeLotId: number;
  ChequeLotNumber: string | null;
  ChequeNo: string;
  PaymentId: number | null;
  BankId: number | null;
  BankName: string | null;
  AccountNumber: string | null;
  Reason: string | null;
  CancelledBy: string | null;
  CancelledAt: string;
  DocNo: string | null;
  PPaymentName: string | null;
  PAmount: number | null;
  PDate: string | null;
  PProject: string | null;
  PCompany: string | null;
  PCompanyName: string | null;
}

export interface CancelledChequeListResponse {
  data: CancelledChequeRecord[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── Calls ────────────────────────────────────────────────────────────────────

export const searchChequeByNumber = (chequeNo: string) =>
  axios
    .get<ChequeSearchResult[]>("/cheque-cancellation/search", { params: { chequeNo } })
    .then((r) => r.data);

export const bulkSearchCheques = (chequeNumbers: string[]) =>
  axios
    .post<BulkSearchResult[]>("/cheque-cancellation/bulk-search", { chequeNumbers })
    .then((r) => r.data);

export const cancelCheque = (paymentId: number, chequeNo: string, reason?: string) =>
  axios
    .post<{ message: string }>("/cheque-cancellation", { paymentId, chequeNo, reason })
    .then((r) => r.data);

export const bulkCancelCheques = (
  items: { paymentId: number; chequeNo: string }[],
  reason?: string,
) =>
  axios
    .post<{ cancelled: string[]; skipped: { chequeNo: string; error: string }[] }>(
      "/cheque-cancellation/bulk",
      { items, reason },
    )
    .then((r) => r.data);

export const getCancelledCheques = (params: { search?: string; page?: number; limit?: number } = {}) =>
  axios
    .get<CancelledChequeListResponse>("/cheque-cancellation", { params })
    .then((r) => r.data);
