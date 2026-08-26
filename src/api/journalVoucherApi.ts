import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/journal-voucher";
const REPORTS_BASE = "/api/reports/journal-voucher";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
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
  CompanyId: number | null;
  ProjectId: number | null;
  CompanyName?: string | null;
  ProjectName?: string | null;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
  CreatedBy: string | null;
  CreatedAt: string;
  TotalAmount: number | null;
  PostedToGL?: boolean;
}

export interface JournalVoucherLedgerOption {
  id: number;
  label: string;
  code: string | null;
  type: "GL" | "C" | "S" | "B" | string;
  /** Last 4 digits of the bank account number — Bank ("B") heads only, null otherwise. */
  accountNoLast4: string | null;
}

export const getJournalVoucherLedgerOptions = async (): Promise<JournalVoucherLedgerOption[]> => {
  const res = await fetchWithAuth(`${BASE}/ledger-options`);
  return handleResponse<JournalVoucherLedgerOption[]>(res);
};

export interface JournalVoucherDetail extends JournalVoucherSummary {
  lines: JournalVoucherLine[];
}

export interface JournalVoucherPayload {
  JVDate: string;
  Narration?: string;
  CompanyId?: number | null;
  ProjectId?: number | null;
  lines: JournalVoucherLine[];
}

export interface JournalVoucherFilters {
  status?: string;
  companyId?: number | string;
  projectId?: number | string;
  dateFrom?: string;
  dateTo?: string;
}

function toQuery(filters: JournalVoucherFilters = {}): string {
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const getJournalVouchers = async (
  filters: JournalVoucherFilters = {},
): Promise<JournalVoucherSummary[]> => {
  const res = await fetchWithAuth(`${BASE}${toQuery(filters)}`);
  return handleResponse<JournalVoucherSummary[]>(res);
};

export const getJournalVoucher = async (id: number): Promise<JournalVoucherDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse<JournalVoucherDetail>(res);
};

export const createJournalVoucher = async (payload: JournalVoucherPayload) => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const updateJournalVoucher = async (id: number, payload: JournalVoucherPayload) => {
  const res = await fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const approveJournalVoucher = async (id: number, note?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return handleResponse(res);
};

export const rejectJournalVoucher = async (id: number, note?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return handleResponse(res);
};

export interface JournalVoucherYearSummary {
  Year: number;
  JVCount: number;
  TotalAmount: number | null;
}

export const getJournalVoucherYearSummary = async (
  filters: JournalVoucherFilters = {},
): Promise<JournalVoucherYearSummary[]> => {
  const res = await fetchWithAuth(`${REPORTS_BASE}/summary${toQuery(filters)}`);
  return handleResponse<JournalVoucherYearSummary[]>(res);
};

export const getJournalVoucherReportList = async (
  filters: JournalVoucherFilters = {},
): Promise<JournalVoucherSummary[]> => {
  const res = await fetchWithAuth(`${REPORTS_BASE}/list${toQuery(filters)}`);
  return handleResponse<JournalVoucherSummary[]>(res);
};
