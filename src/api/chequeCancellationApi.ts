import axios from "./axios";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChequeSearchResult {
  // null marks a payment-less match — a cheque number within an active
  // lot's range that was never issued against any dbo.NewPayment row.
  // Cancelling it goes through chequeLotId instead of paymentId.
  PPaymentID: number | null;
  DocNo: string | null;
  PPaymentName: string | null;
  PRemarks: string | null;
  PAmount: number | null;
  PDate: string | null;
  PMode: string | null;
  PProject: string | null;
  PCompany: string | null;
  PExpenseRef: string | null;
  Status: string | null;
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

export const cancelCheque = (
  paymentId: number | null,
  chequeNo: string,
  reason?: string,
  chequeLotId?: number | null,
) =>
  axios
    .post<{ message: string }>("/cheque-cancellation", { paymentId, chequeLotId, chequeNo, reason })
    .then((r) => r.data);

export const bulkCancelCheques = (
  items: { paymentId: number | null; chequeLotId?: number | null; chequeNo: string }[],
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
