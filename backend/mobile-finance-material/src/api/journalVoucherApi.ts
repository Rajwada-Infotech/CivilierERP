// RN port of src/api/journalVoucherApi.ts — same endpoints/types.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE = "/api/journal-voucher";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export interface JournalVoucherLine {
  LineID?: number;
  LHeadId: number | null;
  LHeadName?: string;
  DebitAmount: number;
  CreditAmount: number;
  Narration?: string;
}

export interface JournalVoucherSummary {
  JVID: number;
  JVNo: string | null;
  JVDate: string;
  Narration: string | null;
  CompanyName?: string | null;
  ProjectName?: string | null;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
  TotalAmount: number | null;
  PostedToGL?: boolean;
}

export interface JournalVoucherLedgerOption {
  id: number;
  label: string;
  code: string | null;
  type: "GL" | "C" | "S" | "B" | string;
}

export interface JournalVoucherPayload {
  JVDate: string;
  Narration?: string;
  CompanyId?: number | null;
  ProjectId?: number | null;
  lines: JournalVoucherLine[];
}

export const getJournalVouchers = async (): Promise<JournalVoucherSummary[]> => {
  const res = await fetchWithAuth(BASE);
  return handleResponse<JournalVoucherSummary[]>(res);
};

export const getJournalVoucherLedgerOptions = async (): Promise<JournalVoucherLedgerOption[]> => {
  const res = await fetchWithAuth(`${BASE}/ledger-options`);
  return handleResponse<JournalVoucherLedgerOption[]>(res);
};

export const createJournalVoucher = async (payload: JournalVoucherPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const approveJournalVoucher = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return handleResponse(res);
};

export const rejectJournalVoucher = async (id: number) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return handleResponse(res);
};
