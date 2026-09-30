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
  /** Only needed when the preview comes back with needsManualRate for this
   *  item (no purchase history found anywhere under the sending company). */
  manualRate?: number;
  /** Set when this line came from a Material Request — the source
   *  MaterialRequestItems row (see SourceMRId on the transfer payload). */
  mrItemId?: number | null;
}

export interface InterCompanyTransferPayload {
  SenderProjectId: number;
  ReceiverProjectId: number;
  /** Optional — override the sender company when using a cross-tagged project godown. */
  SenderCompanyId?: number;
  /** Optional — override the receiver company when using a cross-tagged project godown. */
  ReceiverCompanyId?: number;
  TransferDate?: string;
  Remarks?: string;
  ReferenceNumber?: string;
  /** Whether this transfer is a taxable supply at all — defaults to true
   *  server-side; pass false for a genuine no-GST movement (not just a
   *  display preference — it zeroes the GST component entirely). */
  ApplyGst?: boolean;
  /** Set when this transfer was raised from a Material Request — see
   *  materialRequestApi.ts's getICTMRPrefill. */
  SourceMRId?: number;
  Items: InterCompanyTransferItemPayload[];
}

export interface InterCompanyTransferResult {
  ICTId: number;
  DocNo: string;
  TotalAmount: number;
  Status: "Pending";
  message: string;
}

export interface InterCompanyTransferPreviewItem {
  itemId: string;
  itemName: string | null;
  qty: number;
  unit: string;
  rate: number;
  amount: number;        // excl. GST
  gstPct?: number;
  gstAmount?: number;
  amountInclGst?: number;
  sourceDocNo: string | null;
  /** True when no purchase history exists anywhere under the sending
   *  company — rate/amount come back 0 until the caller supplies
   *  manualRate for this item and re-previews. */
  needsManualRate?: boolean;
}

export interface InterCompanyTransferPreview {
  items: InterCompanyTransferPreviewItem[];
  totalAmount: number;           // excl. GST
  totalGstAmount?: number;
  totalAmountInclGst?: number;
  applyGst?: boolean;
  senderCompanyId?: number;
  senderCompanyName?: string;
  receiverCompanyId?: number;
  receiverCompanyName?: string;
}

// Prices items at the sending company's most recent purchase rate (excl.
// GST) without creating anything — powers the Posting preview shown before
// submit. An item with no purchase history anywhere under the sending
// company comes back with needsManualRate: true (rate/amount 0) rather
// than failing the whole call — pass manualRate for that item and
// re-preview once the user's entered one.
export const previewInterCompanyTransfer = async (payload: {
  SenderProjectId: number;
  ReceiverProjectId: number;
  /** Optional override — when the selected FROM company differs from the
   *  project's primary company_id (cross-tagged project godown). */
  SenderCompanyId?: number;
  /** Optional override — when the selected TO company differs from the
   *  project's primary company_id (cross-tagged project godown). */
  ReceiverCompanyId?: number;
  /** Whether this transfer is a taxable supply at all — defaults to true. */
  ApplyGst?: boolean;
  Items: InterCompanyTransferItemPayload[];
}): Promise<InterCompanyTransferPreview> => {
  const res = await fetchWithAuth(`${BASE}/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handleResponse<InterCompanyTransferPreview>(res);
};


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
  SenderProjectId?: number;
  SenderCompanyId?: number;
  SenderProjectName?: string;
  SenderCompanyName?: string;
  ReceiverProjectId?: number;
  ReceiverCompanyId?: number;
  ReceiverProjectName?: string;
  ReceiverCompanyName?: string;
  TotalAmount: number;
  TotalGstAmount?: number;
  TotalAmountInclGst?: number;
  Status: string;
  Remarks?: string | null;
  CreatedBy?: string | null;
  SaleOrderId?: number | null;
  SaleInvoiceId?: number | null;
  ReceivedPaymentId?: number | null;
  PurchaseOrderId?: number | null;
  GRNId?: number | null;
  ExpenseBookingId?: number | null;
  NewPaymentId?: number | null;
}

export interface InterCompanyTransferDetailItem {
  ICTItemId: number;
  ItemId: string;
  ItemName: string | null;
  UOMCode: string | null;
  Quantity: number;
  Rate: number;
  Amount: number;
  GstPct?: number;
  GstAmount?: number;
  AmountInclGst?: number;
  SourceDocNo: string | null;
}

export interface InterCompanyTransferDetail extends InterCompanyTransferSummary {
  items: InterCompanyTransferDetailItem[];
}


export const getInterCompanyTransfer = async (
  id: number,
): Promise<InterCompanyTransferDetail> => {
  const res = await fetchWithAuth(`${BASE}/${id}`);
  return handleResponse(res);
};

export interface InterCompanyTransferPostingRow {
  label: string;
  side: "debit" | "credit";
  amount: number;
}

export interface InterCompanyTransferPostingVoucher {
  jvNo: string | null;
  companyName: string | null;
  rows: InterCompanyTransferPostingRow[];
}

export interface InterCompanyTransferPosting {
  docNo: string;
  status: string;
  amount: number;
  senderCompanyName: string | null;
  receiverCompanyName: string | null;
  isPosted: boolean;
  vouchers: InterCompanyTransferPostingVoucher[];
}

export const getInterCompanyTransferPosting = async (
  id: number,
): Promise<InterCompanyTransferPosting> => {
  const res = await fetchWithAuth(`${BASE}/${id}/posting`);
  return handleResponse(res);
};

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

// Deletes an ICT of any status — for a Completed one, the backend reverses
// the StockLedger movement and the two-sided GL voucher first.
export const deleteInterCompanyTransfer = async (
  id: number,
): Promise<{ message: string }> => {
  const res = await fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" });
  return handleResponse(res);
};
