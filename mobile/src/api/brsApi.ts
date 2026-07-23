// RN port of src/api/brsApi.ts (web uses an axios instance with
// baseURL:"/api" — same effective paths as fetchWithAuth's "/api/..." here).
// BRS has no create/edit/delete of its own; entries are a read view over
// NewPayment/ReceivedPayment rows, reconciled via a Clear/Unclear toggle
// plus a Bounce action — see BrsScreen.tsx.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/brs";

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    const detail = body?.message || body?.error;
    return detail ? `${fallback} (${res.status}): ${detail}` : `${fallback} (HTTP ${res.status})`;
  } catch {
    return `${fallback} (HTTP ${res.status})`;
  }
}

export type BrsSourceType = "PAYMENT" | "RECEIVED";

export interface BrsEntry {
  BRSID: number | null;
  SourceID: number;
  SourceType: BrsSourceType;
  PaymentName: string;
  CompanyName: string | null;
  CompanyID: number | null;
  BankID: number | null;
  BankName: string | null;
  Amount: number;
  PayDate: string;
  Mode: string;
  DocNo: string | null;
  TxnId: string | null;
  ChequeNo: string | null;
  PayStatus: string;
  IsMatched: boolean | number;
  IsBounced: boolean | number;
  BounceDate: string | null;
  BounceReason: string | null;
  BounceRemarks: string | null;
  ClearingDate: string | null;
  ReplacementDocNo: string | null;
  ReplacementPaymentId: number | null;
  OriginalDocNo: string | null;
  OriginalPaymentId: number | null;
  CreatedAt: string;
}

export interface BrsListResponse {
  data: BrsEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  clearAmount: number;
  unclearAmount: number;
  bounceAmount: number;
  clearCount: number;
  unclearCount: number;
  bounceCount: number;
}

export interface BrsFilterOption {
  id: number;
  name: string;
  companyId?: number | null;
  companyName?: string | null;
}

export interface BrsFilters {
  companies: BrsFilterOption[];
  banks: BrsFilterOption[];
}

export function isCleared(e: BrsEntry): boolean {
  return e.IsMatched === true || e.IsMatched === 1;
}

export function isBounced(e: BrsEntry): boolean {
  return e.IsBounced === true || e.IsBounced === 1;
}

export async function getBRSFilters(): Promise<BrsFilters> {
  const res = await fetchWithAuth(`${BASE}/filters`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to load BRS filters"));
  return res.json().catch(() => ({ companies: [], banks: [] }));
}

export async function getBRS(params: {
  bankId?: number;
  fromDate?: string;
  toDate?: string;
  status?: "clear" | "unclear" | "bounced";
  hideDummyBank?: boolean;
  page?: number;
  limit?: number;
}): Promise<BrsListResponse> {
  const qs = new URLSearchParams();
  if (params.bankId) qs.set("bankId", String(params.bankId));
  if (params.fromDate) qs.set("fromDate", params.fromDate);
  if (params.toDate) qs.set("toDate", params.toDate);
  if (params.status) qs.set("status", params.status);
  if (params.hideDummyBank) qs.set("hideDummyBank", "true");
  qs.set("page", String(params.page ?? 1));
  qs.set("limit", String(params.limit ?? 25));

  const res = await fetchWithAuth(`${BASE}?${qs.toString()}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to load BRS data"));
  return res.json();
}

export async function markClear(sourceType: BrsSourceType, sourceId: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${sourceType}/${sourceId}/clear`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to mark as clear"));
}

export async function markUnclear(sourceType: BrsSourceType, sourceId: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${sourceType}/${sourceId}/unclear`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to mark as unclear"));
}

export async function markBounced(
  sourceType: BrsSourceType,
  sourceId: number,
  payload: { bounceDate: string; bounceReason: string; bounceRemarks?: string },
): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${sourceType}/${sourceId}/bounce`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to record bounce"));
}
