// Ported near-verbatim from src/api/paymentReasonApi.ts (web) — proves the
// api/ layer moves over unchanged aside from the fetchWithAuth import path.
// Used as the first end-to-end screen (see src/screens/dashboard) to
// validate auth -> query -> RBAC -> render before tackling a real module.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/payment-reason-master";

export interface PaymentReason {
  id: number;
  name: string;
  description?: string | null;
  isActive?: boolean | number;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const getPaymentReasons = () =>
  fetchWithAuth(BASE).then((r) => handle<PaymentReason[]>(r));
