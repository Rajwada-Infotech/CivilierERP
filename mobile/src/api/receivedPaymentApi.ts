// RN port of src/api/receivedPaymentApi.ts + the inline types/helpers at the
// top of src/pages/finance/ReceivedPayment.tsx (that page has no dedicated
// subfolder like Payment's src/pages/finance/payment/ — everything lives in
// one file on web, so this one file covers the same ground here).
// Received Payment has no GL-posting/chain feature on web at all (unlike
// outbound Payment), so there's no equivalent to getPaymentPosting here.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/received-payment";

export type PaymentMode = "Cash" | "Check" | "UPI" | "NEFT" | "RTGS" | "Card" | "EMI";

export const PAYMENT_MODES: PaymentMode[] = ["Cash", "Check", "UPI", "NEFT", "RTGS", "Card", "EMI"];

export const MODE_COLOR: Record<string, string> = {
  Cash: "#10b981",
  Check: "#3b82f6",
  UPI: "#8b5cf6",
  NEFT: "#0ea5e9",
  RTGS: "#06b6d4",
  Card: "#f97316",
  EMI: "#6366f1",
};

export interface ReceivedPaymentRecord {
  RPPaymentID: number;
  RPCompanyName: string | null;
  RPCompanyId: number | null;
  RPReceivedFrom: string;
  RPCustomerName: string | null;
  RPProjectName: string;
  RPProjectId: number | null;
  RPDocDate: string;
  RPFinYear: string | null;
  RPDocTypeId: number | null;
  RPDocNo: string | null;
  RPMode: string;
  RPAmount: number;
  RPDepositBankId: number | null;
  RPDepositBankName: string | null;
  RPBankName: string | null;
  RPTransactionID: string | null;
  RPCheckNumber: string | null;
  RPChequeDate: string | null;
  RPIsPostDated: boolean;
  RPRemarks: string | null;
  RPStatus: string;
  RPCreatedAt: string;
}

export interface ReceivedPayment {
  id: string;
  docNo: string;
  companyId?: number;
  companyName: string;
  projectId?: number;
  projectName: string;
  finYear?: string;
  receivedFrom: string;
  customerName?: string;
  depositBankId?: number;
  depositBankName?: string;
  docDate: string;
  mode: PaymentMode;
  amount: number;
  bankName?: string;
  transactionId?: string;
  checkNumber?: string;
  chequeDate?: string;
  isPostDated?: boolean;
  remarks?: string;
  status: "Draft" | "Pending" | "Approved" | "Rejected";
  createdAt: string;
}

export function dbToRecord(r: ReceivedPaymentRecord): ReceivedPayment {
  return {
    id: String(r.RPPaymentID),
    docNo: r.RPDocNo || `REC/${String(r.RPPaymentID).padStart(6, "0")}`,
    companyId: r.RPCompanyId ?? undefined,
    companyName: r.RPCompanyName ?? "",
    projectId: r.RPProjectId ?? undefined,
    projectName: r.RPProjectName,
    finYear: r.RPFinYear ?? undefined,
    receivedFrom: r.RPReceivedFrom,
    customerName: r.RPCustomerName ?? undefined,
    depositBankId: r.RPDepositBankId ?? undefined,
    depositBankName: r.RPDepositBankName ?? undefined,
    docDate: r.RPDocDate?.slice(0, 10) || "",
    mode: r.RPMode as PaymentMode,
    amount: Number(r.RPAmount),
    bankName: r.RPBankName ?? undefined,
    transactionId: r.RPTransactionID ?? undefined,
    checkNumber: r.RPCheckNumber ?? undefined,
    chequeDate: r.RPChequeDate ? String(r.RPChequeDate).slice(0, 10) : undefined,
    isPostDated: !!r.RPIsPostDated,
    remarks: r.RPRemarks ?? undefined,
    status: (r.RPStatus as ReceivedPayment["status"]) || "Draft",
    createdAt: r.RPCreatedAt,
  };
}

export interface PaginatedReceivedPayments {
  data: ReceivedPaymentRecord[];
  page: number;
  totalPages: number;
  total: number;
}

export async function getReceivedPayments(page = 1, limit = 20): Promise<PaginatedReceivedPayments> {
  const res = await fetchWithAuth(`${BASE}?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch received payments");
  return res.json().catch(() => ({}));
}

export interface ReceivedPaymentFormPayload {
  RPCompanyName: string | null;
  RPCompanyId: number | null;
  RPReceivedFrom: string;
  RPCustomerName: string;
  RPProjectName: string;
  RPProjectId: number | null;
  RPDocDate: string;
  RPFinYear: string;
  RPDocTypeId: number | null;
  RPMode: string;
  RPAmount: number;
  RPBankName: string | null;
  RPTransactionID: string | null;
  RPCheckNumber: string | null;
  RPChequeDate: string | null;
  RPIsPostDated: boolean;
  RPRemarks: string | null;
  RPDepositBankId: number | null;
  RPDepositBankName: string | null;
}

export async function addReceivedPayment(payload: ReceivedPaymentFormPayload): Promise<ReceivedPaymentRecord> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create received payment");
  return res.json().catch(() => ({}));
}

// ─── Option fetchers (Company/Project/Customer/Bank/FinYear/DocType) ───────

export const fetchCompanyOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchProjectOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export interface CustomerOption {
  id: number;
  label: string;
}

// Source: AccountHeadMaster WHERE LHeadType = 'A' — stored as a free-text
// name on the record (RPCustomerName), not an FK, same as web.
export const fetchCustomerOptions = async (): Promise<CustomerOption[]> => {
  const res = await fetchWithAuth("/api/account-head/options?type=A");
  if (!res.ok) return [];
  const data: any[] = await res.json().catch(() => []);
  return data.map((x) => ({ id: x.id ?? x.LHeadId, label: x.label ?? x.LHeadName ?? "" }));
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => (r.FStatus === 1 || r.FStatus === true) && !r.FLocked)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

export interface BankOption {
  id: number;
  label: string;
  companyName?: string | null;
}

export const fetchBankOptions = async (): Promise<BankOption[]> => {
  const res = await fetchWithAuth("/api/bank-master");
  if (!res.ok) return [];
  const banks: any[] = await res.json().catch(() => []);
  return banks
    .filter((b) => b.BStatus)
    .map((b) => ({
      id: b.BId,
      label: b.BName ? `${b.BName}${b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}` : `Bank #${b.BId}`,
      companyName: b.BCompanyName ?? null,
    }));
};

// Port of DocNumberPreview.tsx's standalone fetch helpers.
export async function fetchNextDocNumber(docTypeId: number, finYear?: string): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`/api/document-type/${docTypeId}/next-number${qs}`);
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.nextDocNo ?? "";
}

export async function fetchDocTypes(module?: string): Promise<{ TypeOfDocId: number }[]> {
  const qs = module ? `?module=${encodeURIComponent(module)}` : "";
  const res = await fetchWithAuth(`/api/document-type${qs}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
}
