import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/inter-company-transfer";

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

export interface InterCompanyTransferItemPayload {
  itemId: string;
  itemName?: string;
  uom?: string;
  qty: number;
}

export interface InterCompanyTransferPayload {
  SenderProjectId: number;
  ReceiverProjectId: number;
  TransferDate?: string;
  Remarks?: string;
  ReferenceNumber?: string;
  Items: InterCompanyTransferItemPayload[];
}

export interface InterCompanyTransferResult {
  ICTId: number;
  DocNo: string;
  TotalAmount: number;
  links: {
    SaleOrderID: number;
    SaleInvoiceID: number;
    ReceivedPaymentID: number;
    PurchaseOrderID: number;
    GRNID: number;
    ExpenseBookingID: number;
    NewPaymentID: number;
  };
}

export const createInterCompanyTransfer = async (
  payload: InterCompanyTransferPayload,
): Promise<InterCompanyTransferResult> => {
  const res = await fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<InterCompanyTransferResult>(res);
};

export interface InterCompanyTransferSummary {
  ICTId: number;
  DocNo: string;
  TransferDate: string;
  SenderProjectName?: string;
  ReceiverProjectName?: string;
  TotalAmount: number;
  Status: string;
}

export const getInterCompanyTransfers = async (params: {
  companyId?: string | number;
  projectId?: string | number;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
} = {}): Promise<{ data: InterCompanyTransferSummary[]; total: number }> => {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  });
  const s = qs.toString();
  const res = await fetchWithAuth(`${BASE}${s ? `?${s}` : ""}`);
  return handleResponse(res);
};
