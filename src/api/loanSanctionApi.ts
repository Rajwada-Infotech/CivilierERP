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
  BorrowerCompanyId?: number | null;
  BorrowerCompanyName?: string | null;
  BorrowerCustomerId?: number | null;
  BorrowerCustomerSource?: "AH" | "CRM" | null;
  BorrowerCustomerName?: string | null;
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
  borrowerCompanyId?: number | string | null;
  borrowerCustomerId?: number | string | null;
  borrowerCustomerSource?: "AH" | "CRM" | null;
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
}

export interface PayLoanPayload {
  emiIds?: number[];
  lumpSumAmount?: number | string;
  lateFee?: number | string;
  paymentDate: string;
  notes?: string;
}

export interface PayLoanResponse {
  paymentId: number;
  paymentRef: string;
  totalAmount: number;
  loanClosed: boolean;
  excessCredited: number;
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
