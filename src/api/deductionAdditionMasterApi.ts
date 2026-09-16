import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/deduction-addition-master";

export type DeductionAdditionType = "Deduction" | "Addition";

export interface DeductionAdditionRow {
  Id: number;
  Name: string;
  Code: string;
  Type: DeductionAdditionType;
  LedgerId: number | null;
  LedgerName: string | null;
  IsActive: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
}

export interface DeductionAdditionPayload {
  Name: string;
  Code: string;
  Type: DeductionAdditionType;
  LedgerId: number | null;
  IsActive?: boolean;
}

async function handle<T = unknown>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const getDeductionAdditions = async (): Promise<DeductionAdditionRow[]> => {
  const res = await fetchWithAuth(BASE);
  return handle(res);
};

export const addDeductionAddition = async (payload: DeductionAdditionPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const updateDeductionAddition = async (id: number, payload: DeductionAdditionPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
};

export const deleteDeductionAddition = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handle<{ message: string }>(res);
};
