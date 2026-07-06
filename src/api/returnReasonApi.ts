import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/return-reason-master";

export interface ReturnReason {
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

export const getReturnReasonOptions = () =>
  fetchWithAuth(`${BASE}/options`).then((r) => handle<ReturnReason[]>(r));

export const getReturnReasons = () =>
  fetchWithAuth(BASE).then((r) => handle<ReturnReason[]>(r));

export const createReturnReason = (payload: { name: string; description?: string; isActive: boolean }) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const updateReturnReason = (id: number, payload: { name: string; description?: string; isActive: boolean }) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((r) => handle(r));

export const deleteReturnReason = (id: number) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then((r) => handle(r));
