// RN port of src/api/returnReasonApi.ts — only the options lookup is
// needed here (feeds the BRS Bounce modal's reason picker).
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/return-reason-master";

export interface ReturnReason {
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

export const getReturnReasonOptions = () =>
  fetchWithAuth(`${BASE}/options`).then((r) => handle<ReturnReason[]>(r));
