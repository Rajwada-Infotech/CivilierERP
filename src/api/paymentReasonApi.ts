import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/payment-reason-master";

export interface PaymentReason {
  id: number;
  name: string;
  description?: string | null;
  isActive?: boolean | number;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getPaymentReasonOptions = () =>
  fetchWithAuth(`${BASE}/options`).then((r) => handle<PaymentReason[]>(r));

export const getPaymentReasons = () =>
  fetchWithAuth(BASE).then((r) => handle<PaymentReason[]>(r));

export const createPaymentReason = (payload: { name: string; description?: string; isActive: boolean }) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const updatePaymentReason = (id: number, payload: { name: string; description?: string; isActive: boolean }) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const deletePaymentReason = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handle(r));

export const permanentlyDeletePaymentReason = (id: number) =>
  fetchWithAuth(`${BASE}/${id}/permanent`, { method: "DELETE" }).then((r) => handle(r));
