import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/loan-sanction";

export type LoanType = "Inter-Company" | "Intra-Company" | "Customer Loan";

export interface LoanSanction {
  LoanId: number;
  LoanNo: string;
  LoanType: LoanType;
  LenderCompanyId: number;
  LenderCompanyName?: string | null;
  BorrowerCompanyId?: number | null;
  BorrowerCompanyName?: string | null;
  BorrowerCustomerId?: number | null;
  BorrowerCustomerName?: string | null;
  LoanDate: string;
  Amount: number;
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
}

export interface LoanSanctionPayload {
  loanType: LoanType;
  lenderCompanyId: number | string;
  borrowerCompanyId?: number | string | null;
  borrowerCustomerId?: number | string | null;
  borrowerCustomerSource?: "AH" | "CRM" | null;
  loanDate: string;
  amount: number | string;
  interestRate?: number | string | null;
  tenureMonths?: number | string | null;
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

export const getCustomerOptions = () =>
  fetchWithAuth(`${BASE}/customer-options`).then((r) =>
    handle<CustomerOption[]>(r),
  );
