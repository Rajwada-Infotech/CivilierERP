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

export type FundTransferMode =
  | "Cash"
  | "Cheque"
  | "Post-Dated Cheque"
  | "NEFT"
  | "UPI"
  | "RTGS"
  | "IMPS"
  | "Card";

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
  Mode?: FundTransferMode;
  // Cheque / Post-Dated Cheque — mirrors the same cheque-lot mechanism
  // Payment uses (see ChequePanel.tsx), so a leaf claimed here is unusable
  // in Payment and vice versa.
  ChequeLotId?: number;
  ChequeLotNumber?: string;
  ChequeNo?: string;
  ChequeDate?: string;
  // NEFT / UPI / RTGS / IMPS / Card — one free-text reference field.
  DigitalRefNumber?: string;
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
  // Inter-company transfers create/link a real dbo.LoanSanction record on
  // approval (see postFundTransferApproval in generalLedger.js) — this is
  // the loan-sanction module's own primary key + doc no + status, not
  // anything Fund Transfer stores itself.
  LinkedLoanId: number | null;
  LinkedLoanNo: string | null;
  LinkedLoanStatus: string | null;
  Mode: FundTransferMode | null;
  ChequeNo: string | null;
  ChequeLotNumber: string | null;
  ChequeDate: string | null;
  IsPostDated: boolean;
  DigitalRefNumber: string | null;
  CreatedBy: string | null;
  CreatedAt: string;
}

export interface FundTransferDetail extends FundTransferSummary {
  PostedToGL: boolean;
}

export interface FundTransferPostingRow {
  label: string;
  side: "debit" | "credit";
  amount: number;
}

export interface FundTransferPostingVoucher {
  jvNo: string | null;
  companyName?: string | null;
  rows: FundTransferPostingRow[];
}

export interface FundTransferPosting {
  docNo: string;
  transferType: FundTransferType;
  amount: number;
  sourceCompanyName: string | null;
  destinationCompanyName: string | null;
  linkedLoanNo: string | null;
  isPosted: boolean;
  vouchers: FundTransferPostingVoucher[];
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

export const getFundTransferPosting = async (id: number): Promise<FundTransferPosting> => {
  const res = await fetchWithAuth(`${BASE}/${id}/posting`);
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
