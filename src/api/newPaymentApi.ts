import { fetchWithAuth } from "../lib/fetchWithAuth";
import { z } from "zod";
import { BaseTransactionSchema, PaymentPayloadSchema } from "../schemas/transaction.schema";

const BASE_URL = "/api/new-payment";

async function parseError(res: Response, fallback: string) {
  try {
    const err = await res.json();
    const details = Array.isArray(err.details)
      ? err.details
          .map((detail: any) => `${detail.field || "field"}: ${detail.message}`)
          .join(" | ")
      : "";
    const message = err.message || err.error;
    return details ? `${message || fallback} - ${details}` : message || fallback;
  } catch {
    return fallback;
  }
}

export type TransactionStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";

export const WORKFLOW_TRANSITIONS: Record<TransactionStatus, TransactionStatus[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["COMPLETED", "CANCELLED"],
  REJECTED: ["DRAFT"], // Sent back for correction
  CANCELLED: [],
  COMPLETED: [],
};

// Reusable base transaction model for all standardized entries
export type BaseTransaction = z.infer<typeof BaseTransactionSchema>;

export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

export const getPayments = async (
  page = 1,
  limit = 20,
  supplier = "",
  company = "",
  project = "",
  finYear = "",
  docNumber = "",
  docDate = "",
  date = "",
  dueDate = "",
  remarks = ""
) => {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (supplier) params.set("supplier", supplier);
  if (company)  params.set("company",  company);
  if (project)  params.set("project",  project);
  if (finYear)  params.set("finYear",  finYear);
  if (docNumber) params.set("docNumber", docNumber);
  if (docDate) params.set("docDate", docDate);
  if (date) params.set("date", date);
  if (dueDate) params.set("dueDate", dueDate);
  if (remarks) params.set("remarks", remarks);

  const res = await fetchWithAuth(`${BASE_URL}?${params.toString()}`);
  if (!res.ok)
    throw new Error(await parseError(res, `GET failed: ${res.status}`));
  return res.json().catch(() => ({}));
};

// Fetch a single payment by PPaymentID — used by the Trial Balance drill-down
// (Level 3: clicking a transaction opens this exact payment receipt).
export const getPaymentById = async (id: number) => {
  const res = await fetchWithAuth(`${BASE_URL}?id=${id}&limit=1`);
  if (!res.ok)
    throw new Error(await parseError(res, `GET failed: ${res.status}`));
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data) ? data : data?.data ?? data?.rows ?? [];
  return rows[0] ?? null;
};

export const addPayment = async (data: PaymentPayload) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "POST failed"));
  return res.json().catch(() => ({}));
};

export const updatePayment = async (
  id: string | number,
  data: Partial<PaymentPayload>,
) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "PUT failed"));
  return res.json().catch(() => ({}));
};

export const deletePayment = async (id: string | number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "DELETE failed"));
  return res.json().catch(() => ({}));
};

export type DisplayStatus =
  | "Success"
  | "Pending"
  | "Cheque Issued"
  | "Cheque Cleared"
  | "Cheque Bounced"
  | "Reissued"
  | "Failed"
  | "Cancelled"
  | "Partial"
  | string;

export interface PaymentChainItem {
  PPaymentID: number;
  DocNo: string | null;
  PDate: string | null;
  PAmount: number | null;
  PMode: string | null;
  Status: string;
  PChequeNo: string | null;
  PChequeLotNumber: string | null;
  PChequeDate: string | null;
  PChequeIfsc: string | null;
  PBankName: string | null;
  PIsChequeCancelled: boolean | number | null;
  ReplacesPaymentId: number | null;
  BounceCharge: number | null;
  PCreatedBy: string | null;
  PCreatedAt: string;
  PApprovedBy: string | null;
  IsMatched: number;
  IsBounced: number;
  BounceDate: string | null;
  BounceReason: string | null;
  BounceRemarks: string | null;
  ReplacementDocNo: string | null;
  ReplacementPaymentId: number | null;
  OriginalDocNo: string | null;
  DisplayStatus: DisplayStatus;
}

export interface PaymentChainInvoice {
  Eid: number;
  EDocNo: string | null;
  ENetAmount: number | null;
  EAmount: number | null;
  ESourceType: string | null;
  GrnTotalAmount: number | null;
  ETotalPaid: number | null;
  ERemainingAmount: number | null;
  EBillStatus: string | null;
  ProjectName: string | null;
  PartyName: string | null;
}

export interface PaymentChainResponse {
  invoice: PaymentChainInvoice | null;
  payments: PaymentChainItem[];
}

export const getPaymentChain = async (expenseRef: string): Promise<PaymentChainResponse> => {
  const res = await fetchWithAuth(`${BASE_URL}/chain/${encodeURIComponent(expenseRef)}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch payment chain"));
  return res.json();
};
