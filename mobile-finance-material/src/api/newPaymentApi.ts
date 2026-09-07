// RN port of src/api/newPaymentApi.ts + src/pages/finance/payment/{types,api,formHelpers,partialPayment,constants}.ts
// (web). Covers list/detail/create for the mobile Payment module — GL
// posting (post-to-gl / post-bounce-charge-to-gl / chain-posting mutation)
// stays web-only, see getPaymentPosting below and PaymentDetailModal.tsx.
import { fetchWithAuth } from "@/services/fetchWithAuth";

const BASE_URL = "/api/new-payment";

async function parseError(res: Response, fallback: string) {
  try {
    const err = await res.json();
    return err.message || err.error || fallback;
  } catch {
    return fallback;
  }
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DbPayment {
  PPaymentID: number;
  PPaymentName: string | null;
  PMode: string | null;
  PAmount: number | null;
  PDocType: string | null;
  PDate: string | null;
  PBankID: number | null;
  PBankName: string | null;
  PProject: string | null;
  PProjectName?: string | null;
  PCompany: string | null;
  PSupplierName?: string | null;
  PSupplierContact?: string | null;
  PExpenseRef: string | null;
  DocNo?: string | null;
  ParentDocNo?: string | null;
  RootExBDocNo?: string | null;
  Status?: string;
  DisplayStatus?: string;
  PChequeNo?: string | null;
  PChequeLotNumber?: string | null;
  PChequeDate?: string | null;
  PNeftNumber?: string | null;
  PUpiTransactionId?: string | null;
  PRtgsReference?: string | null;
  PImpsReference?: string | null;
  PCardReference?: string | null;
  PCardId?: number | null;
  PCardNumber?: string | null;
  PCardNetwork?: string | null;
  PCardHolderName?: string | null;
  PExpenseId?: number | null;
}

export interface PaymentRecord {
  id: string;
  paymentName: string;
  paidTo: string;
  supplierContact: string;
  mode: string;
  amount: number | null;
  date: string;
  bankName: string;
  project: string;
  projectSite: string;
  company: string;
  expenseRef: string;
  expenseId: string;
  docNo: string;
  parentDocNo: string;
  docType: string;
  status: string;
  displayStatus: string;
  chequeNo: string;
  chequeLotNumber: string;
  chequeDate: string;
  neftNumber: string;
  upiTransactionId: string;
  rtgsReference: string;
  impsReference: string;
  cardReference: string;
  cardDisplay: string;
}

export function dbToRecord(item: DbPayment): PaymentRecord {
  return {
    id: String(item.PPaymentID),
    paymentName: item.PPaymentName || "",
    paidTo: item.PSupplierName || "",
    supplierContact: item.PSupplierContact || "",
    mode: item.PMode || "",
    amount: item.PAmount ?? null,
    date: item.PDate?.slice(0, 10) || "",
    bankName: item.PBankName && item.PBankName !== "N/A" ? item.PBankName : "",
    project: item.PProjectName || item.PProject || "",
    projectSite: item.PProjectName || item.PProject || "",
    company: item.PCompany || "",
    expenseRef: item.PExpenseRef || "",
    expenseId: item.PExpenseId ? String(item.PExpenseId) : "",
    docNo: item.DocNo || "",
    parentDocNo: item.ParentDocNo || "",
    docType: item.PDocType || "",
    status: item.Status || "Draft",
    displayStatus: item.DisplayStatus || item.Status || "Draft",
    chequeNo: item.PChequeNo || "",
    chequeLotNumber: item.PChequeLotNumber || "",
    chequeDate: item.PChequeDate?.slice(0, 10) || "",
    neftNumber: item.PNeftNumber || "",
    upiTransactionId: item.PUpiTransactionId || "",
    rtgsReference: item.PRtgsReference || "",
    impsReference: item.PImpsReference || "",
    cardReference: item.PCardReference || "",
    cardDisplay: item.PCardId
      ? [item.PCardNetwork, maskCardNumber(item.PCardNumber ?? null), item.PCardHolderName]
          .filter(Boolean)
          .join(" · ")
      : "",
  };
}

export const PAYMENT_MODES = [
  "Cash",
  "Cheque",
  "Post-Dated Cheque",
  "NEFT",
  "UPI",
  "RTGS",
  "IMPS",
  "Card",
] as const;

export type DisplayStatus =
  | "Success"
  | "Pending"
  | "Cheque Issued"
  | "Cheque Cleared"
  | "Cheque Bounced"
  | "Reissued"
  | "Failed"
  | "Cancelled"
  | "Partial"
  | string;

export interface PaymentChainItem {
  PPaymentID: number;
  DocNo: string | null;
  PDate: string | null;
  PAmount: number | null;
  PMode: string | null;
  Status: string;
  PChequeNo: string | null;
  IsBounced: number;
  BounceDate: string | null;
  BounceReason: string | null;
  BounceCharge: number | null;
  ReplacementDocNo: string | null;
  OriginalDocNo: string | null;
  DisplayStatus: DisplayStatus;
}

export interface PaymentChainInvoice {
  Eid: number;
  EDocNo: string | null;
  ENetAmount: number | null;
  EAmount: number | null;
  ESourceType: string | null;
  GrnTotalAmount: number | null;
  ETotalPaid: number | null;
  ERemainingAmount: number | null;
  EBillStatus: string | null;
  ProjectName: string | null;
  PartyName: string | null;
}

export interface PaymentChainResponse {
  invoice: PaymentChainInvoice | null;
  payments: PaymentChainItem[];
}

export interface ChainSummary {
  docNo: string | null;
  status: string | null;
  billStatus: string | null;
  netAmount: number;
  totalPaid: number;
  remaining: number;
  chain: {
    mrDocNo: string | null;
    workDoneRef: string | null;
    poNo: string | null;
    grnNo: string | null;
    expenseDocNo: string | null;
    vendorInvoiceNo: string | null;
    vendorInvoiceDate: string | null;
  };
  supplier: {
    id: number;
    name: string | null;
    code: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gst: string | null;
    pan: string | null;
  } | null;
}

export interface PaymentPostingEntry {
  date: string;
  docNo: string;
  pmtId: number;
  type: "payment" | "bounce_charge";
  amount: number;
  mode: string;
  bounceReason?: string;
  isBounced?: boolean;
  accounts: {
    supplier?: { label: string; code?: string };
    bank?: { label: string; code?: string };
    bankCharges?: { label: string; code?: string };
  };
  isPosted: boolean;
  jvNo: string | null;
}

export interface PaymentPostingResponse {
  isPosted?: boolean;
  invoiceTotal?: number;
  entries: PaymentPostingEntry[];
}

// ─── List / detail fetchers ────────────────────────────────────────────────

export const getPayments = async (
  page = 1,
  limit = 20,
  supplier = "",
  company = "",
  project = "",
  finYear = "",
  docNumber = "",
) => {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (supplier) params.set("supplier", supplier);
  if (company) params.set("company", company);
  if (project) params.set("project", project);
  if (finYear) params.set("finYear", finYear);
  if (docNumber) params.set("docNumber", docNumber);

  const res = await fetchWithAuth(`${BASE_URL}?${params.toString()}`);
  if (!res.ok) throw new Error(await parseError(res, `GET failed: ${res.status}`));
  return res.json().catch(() => ({}));
};

// Single-payment fetch — used by Trial Balance's drill-down transaction
// list to show a payment's full detail inline (same data web's
// ExpenseBookingPreviewModal-adjacent flow shows via GET /api/new-payment/:id).
export const getPaymentById = async (id: number): Promise<PaymentRecord> => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch payment"));
  const row: DbPayment = await res.json();
  return dbToRecord(row);
};

export const getPaymentChain = async (expenseRef: string): Promise<PaymentChainResponse> => {
  const res = await fetchWithAuth(`${BASE_URL}/chain/${encodeURIComponent(expenseRef)}`);
  if (!res.ok) throw new Error(await parseError(res, "Failed to fetch payment chain"));
  return res.json();
};

// Read-only — this deliberately does NOT call the web app's auto-posting
// endpoints (post-to-gl / post-bounce-charge-to-gl). Posting money to the
// GL is a side-effecting finance action kept web-only; mobile only ever
// displays whatever posting state already exists.
export const getPaymentPosting = async (
  id: string,
  expenseRef?: string,
): Promise<PaymentPostingResponse | null> => {
  const url = expenseRef
    ? `${BASE_URL}/chain-posting/${encodeURIComponent(expenseRef)}`
    : `${BASE_URL}/${id}/posting`;
  const res = await fetchWithAuth(url);
  if (!res.ok) return null;
  return res.json().catch(() => null);
};

export const fetchPaymentSummary = async (expenseId: string): Promise<ChainSummary | null> => {
  if (!expenseId) return null;
  try {
    const res = await fetchWithAuth(`/api/expense-booking/${expenseId}/payment-summary`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// ─── Create ─────────────────────────────────────────────────────────────────
// Payload shape mirrors Payment.tsx's handleSave payload exactly (BaseTransaction
// + PaymentPayload fields the backend expects) so the same /api/new-payment
// POST handler processes it identically regardless of which client sent it.
export interface PaymentFormPayload {
  companyId: string | null;
  projectId: string | null;
  docDate: string;
  docTypeId: string | null;
  remarks: string | null;
  supplierId: string | null;
  partyId: number | null;
  bankId: number | null;
  amount: number;
  bankName: string | null;
  parentDocNo: string | null;
  mode: string | null;
  chequeNo: string | null;
  chequeLotId: number | null;
  chequeLotNumber: string | null;
  chequeDate: string | null;
  chequeAccountNumber: string | null;
  chequeIfsc: string | null;
  isPostDated: boolean;
  neftNumber: string | null;
  upiTransactionId: string | null;
  rtgsReference: string | null;
  impsReference: string | null;
  cardReference: string | null;
  cardId: number | null;
  ReplacesPaymentId?: number;
  BounceCharge?: number | null;
  ContractId?: number | null;
  oaSkipAutoApply?: boolean;
}

export const addPayment = async (data: PaymentFormPayload) => {
  const res = await fetchWithAuth(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to save payment"));
  return res.json().catch(() => ({}));
};

export const updatePayment = async (id: string, data: PaymentFormPayload) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to update payment"));
  return res.json().catch(() => ({}));
};

export const deletePayment = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to delete payment"));
};

export const approvePayment = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}/approve`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to approve payment"));
};

export const rejectPayment = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}/reject`, { method: "PUT" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to reject payment"));
};

// GL-posting — a genuine side-effecting money write (creates a journal
// entry), same as web's Posting tab auto-post. Kept explicit/user-triggered
// here (a button + confirm), not auto-fired on tab open like web, since an
// unprompted background GL write on mobile would be an easy way to post
// something the user hasn't actually reviewed yet.
export const postPaymentToGL = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}/post-to-gl`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to post to GL"));
  return res.json().catch(() => ({}));
};

export const postBounceChargeToGL = async (id: string) => {
  const res = await fetchWithAuth(`${BASE_URL}/${id}/post-bounce-charge-to-gl`, { method: "POST" });
  if (!res.ok) throw new Error(await parseError(res, "Failed to post bounce charge to GL"));
  return res.json().catch(() => ({}));
};

// ─── Bank / cheque / card lookups (ChequePanel + CardPanel ports) ──────────

export interface BankOption {
  id: number;
  label: string;
}

export const fetchBankOptions = async (): Promise<BankOption[]> => {
  const res = await fetchWithAuth("/api/bank-master");
  if (!res.ok) return [];
  const banks: any[] = await res.json().catch(() => []);
  return banks
    .filter((b) => b.BStatus)
    .map((b) => ({
      id: b.BId,
      label: b.BName ? `${b.BName}${b.BAccountNumber ? ` — ${b.BAccountNumber}` : ""}` : `Bank #${b.BId}`,
    }));
};

export interface ChequeLot {
  CId: number;
  ChequeLotNumber: string;
  AccountNumber: string | null;
  IFSCCode: string | null;
  ChequeStartNumber: number | null;
  ChequeEndNumber: number | null;
  RemainingCheques: number | null;
}

export const fetchChequeLots = async (bankId?: number | null): Promise<ChequeLot[]> => {
  const url = bankId ? `${BASE_URL}/cheque-lots?bankId=${bankId}` : `${BASE_URL}/cheque-lots`;
  const res = await fetchWithAuth(url);
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchChequeNumbers = async (
  lotId: number,
): Promise<{ number: string; used: boolean; bounced: boolean }[]> => {
  const res = await fetchWithAuth(`${BASE_URL}/cheque-numbers/${lotId}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

// Reserves the cheque number against its lot — a lightweight bookkeeping
// write (decrements remaining count), not a GL-posting action, so it's fine
// to keep on mobile.
export const deductChequeFromLot = async (
  lotId: number,
  chequeNo: string,
): Promise<{ remainingCheques: number }> => {
  const res = await fetchWithAuth(`${BASE_URL}/deduct-cheque`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lotId, chequeNo }),
  });
  if (!res.ok) throw new Error(await parseError(res, "Failed to deduct cheque from lot"));
  return res.json().catch(() => ({}));
};

export interface CardOption {
  id: number;
  card_holder_name: string | null;
  card_number: string | null;
  card_network: string | null;
  card_type: string | null;
}

export const fetchCardsByBank = async (bankId?: number | null): Promise<CardOption[]> => {
  if (!bankId) return [];
  const res = await fetchWithAuth(`/api/card-master?bankId=${bankId}`);
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export function maskCardNumber(num: string | null): string {
  const digits = (num || "").replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

// ─── Invoice / expense-booking linking (simplified ExpenseBookingPicker port) ──
// v1 skips the web picker's Contract tab, EMI-doc-number synthesis, and
// on-account-balance auto-apply — it links a payment to an open invoice and
// autofills company/project/party/amount from the options list itself.

export interface ExpenseOption {
  id: string;
  label: string;
  docNo?: string;
  refNumber?: string | null;
  parentDocNo?: string;
  projectName?: string;
  companyName?: string;
  supplierName?: string;
  partyId?: number | null;
  amount?: number;
  remainingAmount?: number;
  billStatus?: string;
}

export const fetchExpenseOptions = async (): Promise<ExpenseOption[]> => {
  const res = await fetchWithAuth("/api/expense-booking/options");
  if (!res.ok) return [];
  const items: any[] = await res.json().catch(() => []);
  return items.map((o) => ({
    id: o.id,
    label: o.label,
    docNo: o.docNo,
    refNumber: o.refNumber,
    parentDocNo: o.parentDocNo,
    projectName: o.projectName || o.EProjectDisplayName || o.EProjectName || o.project_name || o.ProjectName || null,
    companyName: o.companyName || o.ECompanyName || o.company_name || o.CompanyName || null,
    supplierName: o.supplierName || o.ESupplierName || o.supplier_name || o.SupplierName || o.partyName || null,
    partyId: o.partyId ?? null,
    amount: o.amount,
    remainingAmount: o.remainingAmount,
    billStatus: o.billStatus,
  }));
};

// ─── Filter option fetchers ─────────────────────────────────────────────────

export const fetchCompanyOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=C");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchProjectOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/enterprises/options?business_type=P");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchSupplierOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/account-head/options?type=S,C");
  if (!res.ok) return [];
  return res.json().catch(() => []);
};

export const fetchFinYearOptions = async (): Promise<{ id: number; label: string }[]> => {
  const res = await fetchWithAuth("/api/fin-year");
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const rows: any[] = Array.isArray(data) ? data : (data?.data ?? []);
  return rows
    .filter((r: any) => r.FStatus === 1 || r.FStatus === true)
    .map((r: any) => ({ id: r.FId, label: r.FName }))
    .sort((a: any, b: any) => b.label.localeCompare(a.label));
};

// ─── Mode/status styling + outstanding-amount formula ──────────────────────
// (constants.ts + partialPayment.ts ports)

export const MODE_COLOR: Record<string, string> = {
  Cash: "#10b981",
  Cheque: "#3b82f6",
  "Post-Dated Cheque": "#6366f1",
  UPI: "#8b5cf6",
  Card: "#f59e0b",
  NEFT: "#06b6d4",
  RTGS: "#f97316",
  IMPS: "#ec4899",
};

export const STATUS_COLOR: Record<string, string> = {
  Draft: "#64748b",
  Pending: "#d97706",
  Approved: "#059669",
  Rejected: "#dc2626",
};

export const DISPLAY_STATUS_COLOR: Record<string, string> = {
  Success: "#059669",
  "Cheque Cleared": "#059669",
  Pending: "#d97706",
  "Cheque Issued": "#2563eb",
  "Cheque Bounced": "#dc2626",
  Reissued: "#7c3aed",
};

export interface ChainPaymentLike {
  Status?: string | null;
  IsBounced?: boolean | number | null;
  PAmount?: number | string | null;
  BounceCharge?: number | string | null;
}

export function computePaymentStatus(netAmount: number, payments: ChainPaymentLike[] | null | undefined) {
  const approved = (payments ?? []).filter((p) => p.Status === "Approved" && !p.IsBounced);
  const totalPaid = approved.reduce((sum, p) => {
    const amt = parseFloat(String(p.PAmount ?? 0)) || 0;
    const bounce = parseFloat(String(p.BounceCharge ?? 0)) || 0;
    return sum + amt - bounce;
  }, 0);
  const bounceChargeTotal = approved.reduce(
    (sum, p) => sum + (parseFloat(String(p.BounceCharge ?? 0)) || 0),
    0,
  );
  const remaining = Math.max(0, Math.round((netAmount - totalPaid) * 100) / 100);
  return { totalPaid, bounceChargeTotal, remaining };
}

// RN port of partialPayment.ts's resolveOutstanding — prefers live per-payment
// chain data (excludes bounced, subtracts bounce charges) and falls back to a
// known/DB-persisted totalPaid snapshot only when the live chain hasn't
// loaded yet.
export function resolveOutstanding(netAmount: number, liveRemaining: number | null | undefined, knownTotalPaid: number | null | undefined): number {
  if (liveRemaining != null) return liveRemaining;
  return Math.max(0, netAmount - (knownTotalPaid ?? 0));
}
