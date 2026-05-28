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
  return res.json();
};

export const addPayment = async (data: PaymentPayload) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "POST failed"));
  return res.json();
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
  return res.json();
};

export const deletePayment = async (id: string | number) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "DELETE failed"));
  return res.json();
};
