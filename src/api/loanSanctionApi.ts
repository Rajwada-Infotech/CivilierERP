import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/loan-sanction";

export type LoanType = "Inter-Company" | "Bank Loan" | "Customer Loan";
export type InterestCalcType = "SI" | "CI";

export interface LoanSanction {
  LoanId: number;
  LoanNo: string;
  LoanType: LoanType;
  LoanDocNo?: string | null;
  LenderCompanyId?: number | null;
  LenderCompanyName?: string | null;
  LenderBankId?: number | null;
  LenderBankName?: string | null;
  LenderBankAccountId?: number | null;
  LenderBankAccountName?: string | null;
  BorrowerCompanyId?: number | null;
  BorrowerCompanyName?: string | null;
  BorrowerCustomerId?: number | null;
  BorrowerCustomerSource?: "AH" | "CRM" | null;
  BorrowerCustomerName?: string | null;
  BorrowerBankAccountId?: number | null;
  BorrowerBankAccountName?: string | null;
  LoanDate: string;
  Amount: number;
  HasInterest?: boolean;
  InterestType?: InterestCalcType;
  InterestRate?: number | null;
  TenureMonths?: number | null;
  Purpose?: string | null;
  Status: string;
  LenderLHeadId?: number | null;
  BorrowerLHeadId?: number | null;
  Remarks?: string | null;
  CreatedBy?: string | null;
  CreatedAt?: string | null;
  TotalEMIs?: number;
  PaidEMIs?: number;
  LenderLHeadCode?: string | null;
  LenderGroupName?: string | null;
  LenderParentGroupName?: string | null;
  BorrowerLHeadCode?: string | null;
  BorrowerGroupName?: string | null;
  BorrowerParentGroupName?: string | null;
  ClosedAt?: string | null;
  NOCAttachmentId?: number | null;
  NOCFileName?: string | null;
}

export interface CompanyExposure {
  asLender: {
    loanCount: number;
    totalLent: number;
    totalOutstanding: number;
    nextDue: { DueDate: string; EMIAmount: number; LoanNo: string } | null;
  };
  asBorrower: {
    loanCount: number;
    totalBorrowed: number;
    totalOutstanding: number;
    nextDue: { DueDate: string; EMIAmount: number; LoanNo: string } | null;
  };
}

export interface LoanSanctionPayload {
  loanType: LoanType;
  loanDocNo?: string | null;
  lenderCompanyId?: number | string | null;
  lenderBankId?: number | string | null;
  lenderBankAccountId?: number | string | null;
  borrowerCompanyId?: number | string | null;
  borrowerCustomerId?: number | string | null;
  borrowerCustomerSource?: "AH" | "CRM" | null;
  borrowerBankAccountId?: number | string | null;
  loanDate: string;
  amount: number | string;
  hasInterest?: boolean;
  interestType?: InterestCalcType;
  interestRate?: number | string | null;
  tenureMonths?: number | string | null;
  // Only applied when the loan has no EMI breakdown (n=1 installment,
  // typically an Inter-Company simple transfer) — lets the user set the
  // whole-loan repayment due date directly instead of loanDate + 1 month.
  dueDate?: string | null;
  purpose?: string | null;
  remarks?: string | null;
}

export interface LoanEMI {
  EMIId: number;
  LoanId: number;
  InstallmentNo: number;
  DueDate: string;
  EMIAmount: number;
  PrincipalComponent: number;
  InterestComponent: number;
  IsPaid: boolean;
  PaidDate?: string | null;
  PaidBy?: string | null;
  PaymentId?: number | null;
}

export interface PayableEmi {
  EMIId: number;
  LoanId: number;
  InstallmentNo: number;
  DueDate: string;
  EMIAmount: number;
  PrincipalComponent: number;
  InterestComponent: number;
  LoanNo: string;
  LoanType: LoanType;
  BorrowerName: string;
  /** Company-only borrower name — null when the borrower is a customer, not one of our own companies. */
  BorrowerCompanyName: string | null;
  /** Lender is always a company — who repayment actually goes to. */
  LenderName: string | null;
  /** Same lender company, but as the Payment page's Company auto-fill
   *  source on a Customer Loan — see BorrowerCompanyName's note. */
  LenderCompanyName: string | null;
  IsOverdue: boolean;
}

export interface LoanPayment {
  PaymentId: number;
  LoanId: number;
  PaymentRef: string;
  PaymentDate: string;
  PaymentType: "EMI" | "LumpSum";
  PrincipalInterestAmount: number;
  LateFee: number;
  TotalAmount: number;
  ExcessCredited: number;
  ClosedLoan: boolean;
  Notes?: string | null;
  CreatedBy?: string | null;
  CreatedAt: string;
  EmisCovered: number;
  // The real dbo.NewPayment record this settlement was made through (see
  // migration 340) — null for older rows recorded before this link existed.
  NewPaymentId?: number | null;
  PaymentMode?: string | null;
  ChequeNo?: string | null;
  ChequeDate?: string | null;
  BankName?: string | null;
  NeftNumber?: string | null;
  UpiTransactionId?: string | null;
  RtgsReference?: string | null;
  ImpsReference?: string | null;
  PaymentDocNo?: string | null;
}

export interface PayLoanPayload {
  emiIds?: number[];
  lumpSumAmount?: number | string;
  lateFee?: number | string;
  paymentDate: string;
  notes?: string;
  // The dbo.NewPayment row Payment.tsx just created for this settlement —
  // links the loan's own payment record back to the one that actually
  // carries mode/cheque/bank details (see migration 340).
  newPaymentId?: number;
}

export interface PayLoanResponse {
  paymentId: number;
  paymentRef: string;
  totalAmount: number;
  /** Always false now — loan closure requires an explicit closeLoan() call.
   *  Use readyToClose to know when to show the "Close Loan" prompt. */
  loanClosed: false;
  /** True when all EMIs are paid and total paid ≥ scheduled total.
   *  The UI should show the "Close Loan" button when this is true. */
  readyToClose: boolean;
  excessCredited: number;
  /** Non-null when the repayment was recorded but GL posting was skipped
   *  (e.g. no Lender/Borrower Bank A/C tagged on the loan). Frontend should
   *  show this as a warning toast so the user knows GL needs manual attention. */
  glPostingWarning: string | null;
}

export interface CustomerOption {
  id: number;
  label: string;
  source: "AH" | "CRM"; // discriminator: which table the customer comes from
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getLoanSanctions = () =>
  fetchWithAuth(BASE).then((r) => handle<LoanSanction[]>(r));

export const getLoanSanction = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`).then((r) => handle<LoanSanction>(r));

export const getLoanSchedule = (id: number) =>
  fetchWithAuth(`${BASE}/${id}/schedule`).then((r) => handle<LoanEMI[]>(r));

export const createLoanSanction = (payload: LoanSanctionPayload) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle<{ loanId: number; loanNo: string }>(r));

export const toggleEmiPaid = (loanId: number, emiId: number, paid: boolean) =>
  fetchWithAuth(`${BASE}/${loanId}/emi/${emiId}/pay`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paid }),
  }).then((r) => handle(r));

export const deleteLoanSanction = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handle(r));

// Everything except the parties' identity (LoanType, Lender/Borrower
// Company/Bank/Customer) can be edited after sanction. Financial-core
// fields (amount/interest/tenure/dates) re-run the EMI schedule and are
// only accepted while nothing has been repaid yet — the backend rejects
// them with a 409 once any EMI/LoanPayment exists; administrative fields
// (doc no/purpose/remarks/bank A/C tags) can always be edited.
export interface LoanEditPayload {
  loanDocNo?: string | null;
  purpose?: string | null;
  remarks?: string | null;
  lenderBankAccountId?: number | string | null;
  borrowerBankAccountId?: number | string | null;
  loanDate?: string;
  amount?: number | string;
  hasInterest?: boolean;
  interestType?: InterestCalcType;
  interestRate?: number | string | null;
  tenureMonths?: number | string | null;
  dueDate?: string | null;
}

export const updateLoanSanction = (id: number, payload: LoanEditPayload) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const getPayableEmis = () =>
  fetchWithAuth(`${BASE}/emi-payable`).then((r) => handle<PayableEmi[]>(r));

export const getLoanPayments = (loanId: number) =>
  fetchWithAuth(`${BASE}/${loanId}/payments`).then((r) => handle<LoanPayment[]>(r));

export const payLoan = (loanId: number, payload: PayLoanPayload) =>
  fetchWithAuth(`${BASE}/${loanId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle<PayLoanResponse>(r));

/** Explicitly close a loan that has been fully repaid.
 *  The backend validates that all EMIs are paid and total paid ≥ scheduled.
 *  This is intentionally a separate step from recording the last payment. */
export const closeLoan = (loanId: number) =>
  fetchWithAuth(`${BASE}/${loanId}/close`, { method: "POST" })
    .then((r) => handle<{ success: boolean; message: string }>(r));

export const uploadLoanNoc = (loanId: number, file: File) => {
  const formData = new FormData();
  formData.append("file", file);
  return fetchWithAuth(`${BASE}/${loanId}/noc`, {
    method: "POST",
    body: formData,
  }).then((r) => handle<{ attachmentId: number; fileName: string }>(r));
};

export interface LoanDocument {
  AttachmentId: number;
  LoanId: number;
  DocType: string;
  FileName: string;
  MimeType: string;
  FileSize: number;
  UploadedBy?: string | null;
  UploadedAt: string;
}

export const getLoanDocuments = (loanId: number) =>
  fetchWithAuth(`${BASE}/${loanId}/documents`).then((r) => handle<LoanDocument[]>(r));

export const uploadLoanDocument = (loanId: number, file: File, docType = "Agreement") => {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("docType", docType);
  return fetchWithAuth(`${BASE}/${loanId}/document`, {
    method: "POST",
    body: formData,
  }).then((r) => handle<{ attachmentId: number; fileName: string }>(r));
};

export const getCustomerOptions = () =>
  fetchWithAuth(`${BASE}/customer-options`).then((r) =>
    handle<CustomerOption[]>(r),
  );

export interface BankOption {
  id: number;
  label: string;
}

export const getBankOptions = () =>
  fetchWithAuth("/api/account-head/options?type=B").then((r) =>
    handle<BankOption[]>(r),
  );

export const getCompanyExposure = (companyId: number) =>
  fetchWithAuth(`${BASE}/company-exposure/${companyId}`).then((r) =>
    handle<CompanyExposure>(r),
  );
