import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/fund-transfer";

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // ignore invalid JSON — error message falls back to HTTP status
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export type FundTransferType = "Intra" | "Inter";

export interface FundTransferPayload {
  TransferDate: string;
  TransferType: FundTransferType;
  SourceCompanyId: number;
  DestinationCompanyId: number;
  SourceBankId: number;
  DestinationBankId: number;
  Amount: number;
  Narration?: string;
  finYear?: string;
}

export interface FundTransferSummary {
  FTId: number;
  DocNo: string | null;
  TransferDate: string;
  TransferType: FundTransferType;
  Amount: number;
  Narration: string | null;
  Status: "Draft" | "Pending" | "Approved" | "Rejected";
  SourceCompanyId: number;
  SourceCompanyName: string | null;
  DestinationCompanyId: number;
  DestinationCompanyName: string | null;
  SourceBankId: number;
  SourceBankName: string | null;
  DestinationBankId: number;
  DestinationBankName: string | null;
  LoanHeadId: number | null;
  LoanHeadName: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface FundTransferDetail extends FundTransferSummary {
  PostedToGL: boolean;
}

export const getFundTransfers = async (params: {
  status?: string;
  transferType?: FundTransferType;
  companyId?: string | number;
  dateFrom?: string;
  dateTo?: string;
} = {}): Promise<FundTransferSummary[]> => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const s = qs.toString();
  const res = await fetchWithAuth(`${BASE}${s ? `?${s}` : ""}`);
  return handleResponse(res);
};

export const getFundTransfer = async (id: number): Promise<FundTransferDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse(res);
};

export const createFundTransfer = async (
  payload: FundTransferPayload,
): Promise<{ FTId: number; DocNo: string; message: string }> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
};

export const approveFundTransfer = async (id: number, note?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/approve`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return handleResponse(res);
};

export const rejectFundTransfer = async (id: number, note?: string) => {
  const res = await fetchWithAuth(`${BASE}/${id}/reject`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note }),
  });
  return handleResponse(res);
};
