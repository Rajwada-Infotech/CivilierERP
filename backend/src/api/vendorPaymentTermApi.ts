import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/payment-terms";

export interface VendorPaymentTermRow {
  PaymentTermId: number;
  Description: string;
  Days: number;
  IsActive: boolean;
}

export interface VendorPaymentTermPayload {
  Description: string;
  Days: number;
  IsActive?: boolean;
}

export interface VendorPaymentTermOption {
  id: number;
  label: string;
  days: number;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getVendorPaymentTerms = async (): Promise<VendorPaymentTermRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const getVendorPaymentTermOptions = async (): Promise<VendorPaymentTermOption[]> => {
  const res = await fetchWithAuth(`${BASE}/options`);
  return handle(res);
};

export const addVendorPaymentTerm = async (payload: VendorPaymentTermPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const updateVendorPaymentTerm = async (id: number, payload: VendorPaymentTermPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const deleteVendorPaymentTerm = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle(res);
};
