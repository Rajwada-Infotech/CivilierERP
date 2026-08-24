import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/received-payment";

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || fallback);
}

export interface ReceivedPaymentRecord {
  RPPaymentID: number;
  // Legacy fields (always present)
  RPCompanyName: string | null;
  RPReceivedFrom: string;
  RPProjectName: string;
  RPDocDate: string;
  RPMode: string;
  RPAmount: number;
  RPBankName: string | null;
  RPTransactionID: string | null;
  RPCheckNumber: string | null;
  RPChequeDate: string | null;
  RPIsPostDated: boolean;
  RPRemarks: string | null;
  RPIsEmi: boolean;
  RPEmiTotal: number | null;
  RPEmiMonths: number | null;
  RPEmiStartDate: string | null;
  RPEmiSchedule: string | null; // JSON string
  RPEmiPaying: string | null; // JSON string
  RPStatus: string;
  RPCreatedBy: string | null;
  RPCreatedAt: string;
  RPUpdatedBy: string | null;
  RPUpdatedAt: string | null;
  RPApprovedBy: string | null;
  RPApprovedAt: string | null;
  RPRejectedBy: string | null;
  RPRejectedAt: string | null;
  RPRejectionNote: string | null;
  // New schema columns (migration 017+, always present now)
  RPDocNo: string | null;
  RPFinYear: string | null;
  RPDocTypeId: number | null;
  RPCompanyId: number | null;
  RPProjectId: number | null;
  RPCustomerName: string | null;
  RPDepositBankId: number | null;
  RPDepositBankName: string | null;
  // Sale Invoice cash-collection link (workflow: SO → SI → Cash Payment).
  // When set, the backend force-enforces RPMode = "Cash" and overrides
  // RPDepositBankId to the Dummy Bank account regardless of what's sent.
  SourceSaleInvoiceId?: number | null;
}

export type ReceivedPaymentPayload = Omit<
  ReceivedPaymentRecord,
  | "RPPaymentID"
  | "RPCreatedAt"
  | "RPUpdatedAt"
  | "RPApprovedAt"
  | "RPRejectedAt"
>;

export interface ReceivedPaymentSummary {
  totalAmount: number;
  approvedCount: number;
  draftCount: number;
  pendingCount: number;
  rejectedCount: number;
}

export interface PaginatedReceivedPayments {
  data: ReceivedPaymentRecord[];
  page: number;
  totalPages: number;
  total: number;
  summary: ReceivedPaymentSummary;
}

export async function getReceivedPayments(
  page = 1,
  limit = 20,
): Promise<PaginatedReceivedPayments> {
  const res = await fetchWithAuth(`${BASE}?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch received payments");
  return res.json().catch(() => ({}));
}

export async function createReceivedPayment(
  payload: Partial<ReceivedPaymentPayload>,
): Promise<ReceivedPaymentRecord> {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to create received payment");
  return res.json().catch(() => ({}));
}

export async function getReceivedPayment(
  id: number,
): Promise<ReceivedPaymentRecord> {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  if (!res.ok) throw await readError(res, "Failed to fetch received payment");
  return res.json();
}

export async function updateReceivedPayment(
  id: number,
  payload: Partial<ReceivedPaymentPayload>,
): Promise<ReceivedPaymentRecord> {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("Failed to update received payment");
  return res.json().catch(() => ({}));
}

export async function deleteReceivedPayment(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await readError(res, "Failed to delete received payment");
}

export async function submitReceivedPaymentForApproval(
  id: number,
): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${id}/submit`, { method: "PATCH" });
  if (!res.ok) throw new Error("Submit for approval failed");
}

export async function approveReceivedPayment(
  id: number,
  action: "approve" | "reject",
  rejectionNote?: string,
): Promise<void> {
  const endpoint =
    action === "approve" ? `${BASE}/${id}/approve` : `${BASE}/${id}/reject`;
  const method = "PUT";
  const res = await fetchWithAuth(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: rejectionNote }),
  });
  if (!res.ok) throw new Error("Approval action failed");
}

// Alias used by ReceivedPayment.tsx
export const addReceivedPayment = createReceivedPayment;