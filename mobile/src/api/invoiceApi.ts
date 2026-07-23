// RN port of src/pages/material/MaterialExpenseBooking.tsx +
// ExpenseBookingPreviewModal.tsx — list/detail/create/update, GRN as a
// document source, EMI, and billing terms. Field names copied verbatim
// from ExpenseBooking/helpers.ts's dbToRecord()/recordToDb(). Not ported:
// file attachments (the web Invoice form has none either — no backend
// column for it), the multi-GRN combine flow, and GL posting writes
// (view-only fetchInvoicePosting — this app never triggers a money-posting
// side effect from mobile).
import { fetchWithAuth } from "@/services/fetchWithAuth";

export const INVOICE_API = "/api/expense-booking";
export const PAGE_SIZE = 20;

export type BookingStatus = "Draft" | "Pending" | "Approved" | "Rejected" | "Booked" | "Hold" | "Received";

export interface BillingTerm {
  applicable: boolean;
  type: "percentage" | "fixed";
  value: number;
  appliedOn: "pre-gst" | "post-gst";
  deductionType?: "Addition" | "Deduction";
  masterTermName?: string | null;
}

export interface EmiConfig {
  enabled: boolean;
  installmentCount: number;
  emiAmount: number;
  startDate: string;
  frequency?: string;
}

export interface GRNItemLine {
  itemName?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
}

export interface InvoiceRecord {
  id: string;
  bookingReference: string;
  docTypeName: string;
  materialCategory: string;
  bookingDate: string;
  dueDate: string;
  companyId: number | null;
  companyName: string;
  projectId: string;
  projectName: string;
  supplier: string;
  supplierLHeadId: number | null;
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  netAmount: number | null;
  status: BookingStatus;
  billingTerms: BillingTerm[];
  billingTermId: number | null;
  billingTermName: string;
  emi: EmiConfig;
  eSourceType: "PO" | "WO" | "WO_PO" | "GRN" | "TOD" | "WORK_DONE" | null;
  eSourceId: number | null;
  linkedGrnIds: number[] | null;
  sourceDocNo: string | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  costCenter: string;
  workDoneRef: string;
  glAccount: string;
  remarks: string;
  financialYear: string;
  grnItems: GRNItemLine[];
  grnTotalAmount: number | null;
  totalPaid?: number;
}

export interface InvoiceListResponse {
  data: InvoiceRecord[];
  totalPages: number;
  total: number;
  statusCounts: Record<string, number>;
  totalBookedAmount: number;
}

function dbToRecord(row: any): InvoiceRecord {
  let billingTerms: BillingTerm[] = [];
  try {
    if (row.EBillingTermsData) {
      let parsed = JSON.parse(row.EBillingTermsData);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (Array.isArray(parsed)) billingTerms = parsed;
    }
  } catch {
    /* ignore */
  }

  let emi: EmiConfig = { enabled: false, installmentCount: 0, emiAmount: 0, startDate: "" };
  try {
    if (row.EEmiData) {
      const parsed = JSON.parse(row.EEmiData);
      emi = { enabled: false, installmentCount: 0, emiAmount: 0, startDate: "", ...parsed };
    }
  } catch {
    /* ignore */
  }

  const rawId = row.Eid ?? row.EId ?? row.id;
  const id = rawId == null || rawId === "" ? "" : String(rawId);

  let linkedGrnIds: number[] | null = null;
  try {
    if (row.ELinkedGrnIds) {
      const ids = JSON.parse(row.ELinkedGrnIds);
      linkedGrnIds = Array.isArray(ids) ? ids.map((n: any) => Number(n)) : null;
    }
  } catch {
    /* ignore */
  }

  // GRN line items aren't stored on ExpenseBooking itself (matches web's
  // dbToRecord, which never sets ExpenseRecord.grnItems from a GET either) —
  // the GRN Items Summary section fetches them live via fetchGRNItemsFor().
  const projectEnterpriseId = row.EProjectName ? parseInt(row.EProjectName, 10) : null;

  return {
    id,
    bookingReference: row.EDocNo ?? (id ? `Draft #${id}` : ""),
    docTypeName: row.DocTypeName ?? "",
    materialCategory: row.EDocumentType ?? "",
    bookingDate: row.EDocDate ? String(row.EDocDate).slice(0, 10) : "",
    dueDate: row.EReminder ? String(row.EReminder).slice(0, 10) : "",
    companyId: row.ECompanyId ? parseInt(row.ECompanyId, 10) : null,
    companyName: row.ECompanyName ?? "",
    projectId: projectEnterpriseId && Number.isFinite(projectEnterpriseId) ? String(projectEnterpriseId) : "",
    projectName: row.EProjectDisplayName ?? row.projectName ?? "",
    supplier: row.ESupplierName ?? row.EName ?? "",
    supplierLHeadId: row.ESupplierId ?? row.LHeadId ?? null,
    basicAmount: parseFloat(row.EAmount) || 0,
    cgstRate: row.ECgstRate ? parseFloat(row.ECgstRate) : 0,
    sgstRate: row.ESgstRate ? parseFloat(row.ESgstRate) : 0,
    igstRate: row.EIgstRate ? parseFloat(row.EIgstRate) : 0,
    netAmount: row.ENetAmount != null
      ? parseFloat(row.ENetAmount)
      : row.EGrnTotalAmount != null
        ? parseFloat(row.EGrnTotalAmount)
        : parseFloat(row.EAmount) || 0,
    status: (row.EStatus ?? row.Status ?? "Draft") as BookingStatus,
    billingTerms,
    billingTermId: row.EBillingTermId ? parseInt(row.EBillingTermId, 10) : null,
    billingTermName: row.EBillingTermName ?? "",
    emi,
    eSourceType: row.ESourceType ?? null,
    eSourceId: row.ESourceId ? parseInt(row.ESourceId, 10) : null,
    linkedGrnIds,
    sourceDocNo: row.sourceDocNo ?? null,
    vendorInvoiceNo: row.EVendorInvoiceNo ?? "",
    vendorInvoiceDate: row.EVendorInvoiceDate ? String(row.EVendorInvoiceDate).slice(0, 10) : "",
    costCenter: row.ECostCenter ?? "",
    workDoneRef: row.EWorkDoneRef ?? "",
    glAccount: row.EGLAccount ?? "",
    remarks: row.ERemarks ?? "",
    financialYear: row.EFinYear ?? "",
    grnItems: [],
    grnTotalAmount: row.EGrnTotalAmount != null ? parseFloat(row.EGrnTotalAmount) : null,
    totalPaid: row.ETotalPaid != null ? parseFloat(row.ETotalPaid) : undefined,
  };
}

export async function fetchInvoices(page: number, statusFilter?: string): Promise<InvoiceListResponse> {
  const res = await fetchWithAuth(`${INVOICE_API}?page=${page}&limit=${PAGE_SIZE}`);
  if (!res.ok) throw new Error("Failed to fetch invoices");
  const raw = await res.json().catch(() => ({}));
  const data: InvoiceRecord[] = (raw.data ?? []).map(dbToRecord);
  return {
    data: statusFilter && statusFilter !== "All" ? data.filter((r) => r.status === statusFilter) : data,
    totalPages: raw.totalPages ?? 1,
    total: raw.total ?? 0,
    statusCounts: raw.statusCounts ?? {},
    totalBookedAmount: raw.totalBookedAmount ?? 0,
  };
}

export async function fetchInvoiceById(id: string): Promise<InvoiceRecord> {
  const res = await fetchWithAuth(`${INVOICE_API}/${id}`);
  if (!res.ok) throw new Error("Failed to fetch invoice");
  const row = await res.json().catch(() => ({}));
  return dbToRecord(row);
}

// ── New/Edit Invoice form ───────────────────────────────────────────────────

export interface POOption {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  PODate: string;
  SupplierName?: string;
  TotalAmount?: number;
  CompanyId?: number;
  ProjectId?: number;
  GST?: { applicable?: boolean; type?: "cgst_sgst" | "igst"; rate?: number } | null;
}

export interface WorkDoneOption {
  ID: number;
  DocNo?: string;
  DocDate?: string;
  ContractorName?: string;
  SupplierId?: number;
  CertifiedAmount?: number;
  CompanyId?: number;
  ProjectId?: number;
  GST?: { applicable?: boolean; type?: "cgst_sgst" | "igst"; rate?: number } | null;
}

export interface DocTypeOption {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix: string | null;
  DocNoPrefix: string | null;
  Description: string;
}

export async function fetchPOOptions(): Promise<POOption[]> {
  const res = await fetchWithAuth("/api/purchase-orders/service-eligible");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => ({}));
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

export async function fetchWorkDoneOptions(): Promise<WorkDoneOption[]> {
  const res = await fetchWithAuth("/api/engineering/work-done?status=Approved&limit=200");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => ({}));
  const all: WorkDoneOption[] = Array.isArray(raw) ? raw : (raw.data ?? []);
  return all.filter((wd: any) => (wd.Status ?? "").toLowerCase() === "approved");
}

export async function fetchExpenseDocTypes(): Promise<DocTypeOption[]> {
  const res = await fetchWithAuth("/api/document-type?module=EB");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => ({}));
  return Array.isArray(raw) ? raw.filter((t: any) => !["PO", "WO"].includes(t.ModuleTag ?? "")) : [];
}

export async function fetchNextExpenseDocNumber(docTypeId: number, finYear?: string): Promise<string> {
  const qs = finYear ? `?finYear=${encodeURIComponent(finYear)}` : "";
  const res = await fetchWithAuth(`/api/document-type/${docTypeId}/next-number${qs}`);
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data.nextDocNo ?? "";
}

export interface SupplierHead {
  id: number;
  label: string;
}

export async function fetchSupplierHeads(): Promise<SupplierHead[]> {
  const res = await fetchWithAuth("/api/account-head?type=S");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => []);
  return (Array.isArray(raw) ? raw : []).map((h: any) => ({ id: h.LHeadId, label: h.LHeadName }));
}

export interface ExpenseBookingPayload {
  EName: string;
  LHeadId?: number | null;
  EProjectName?: string | null;
  EDocumentType?: string | null;
  EDocDate: string;
  EAmount: number;
  ENetAmount: number;
  ECgstRate: number;
  ESgstRate: number;
  EIgstRate: number;
  EDiscountData: string;
  EBillingTermsData: string;
  EDocNo?: string | null;
  EDocTypeId?: number | null;
  EFinYear?: string | null;
  EEmiPayment: boolean;
  EEmiData: string;
  EInstallmentCount?: number | null;
  EEmiAmount?: number | null;
  EEmiStartDate?: string | null;
  EReminder?: string | null;
  ERemarks?: string | null;
  ECompanyId?: number | null;
  EBillingTermId?: number | null;
  EBillingTermName?: string | null;
  EVendorInvoiceNo?: string | null;
  EVendorInvoiceDate?: string | null;
  ECostCenter?: string | null;
  EGLAccount?: string | null;
  ESourceType: "PO" | "WORK_DONE" | "TOD" | "GRN" | null;
  ESourceId: number | null;
  linkedGrnIds?: number[];
}

export async function createExpenseBooking(payload: ExpenseBookingPayload): Promise<{ docNo?: string }> {
  const res = await fetchWithAuth(INVOICE_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

export async function updateExpenseBooking(id: string, payload: ExpenseBookingPayload): Promise<{ docNo?: string }> {
  const res = await fetchWithAuth(`${INVOICE_API}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

// ── GRN as a document source ────────────────────────────────────────────────

export interface GRNOption {
  GRNID: number;
  GRNNo?: string;
  DocNo?: string;
  GRNDate?: string;
  SupplierName?: string;
  TotalAmount?: number;
  CompanyId?: number;
  ProjectId?: number;
  POID?: number;
}

export async function fetchGRNOptions(): Promise<GRNOption[]> {
  const res = await fetchWithAuth("/api/grns?limit=500");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => ({}));
  return Array.isArray(raw) ? raw : (raw.data ?? []);
}

function parseGRNItems(raw: any): GRNItemLine[] {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((it: any) => ({
      itemName: it.itemName ?? it.ItemName ?? "",
      orderedQty: Number(it.orderedQty ?? it.OrderedQty ?? 0),
      receivedQty: Number(it.receivedQty ?? it.ReceivedQty ?? 0),
      remainingQty: Number(it.remainingQty ?? it.RemainingQty ?? 0),
      uom: it.uom ?? it.UOM ?? "",
      rate: Number(it.rate ?? it.Rate ?? 0),
    }));
  } catch {
    return [];
  }
}

export interface GRNDetail {
  GRNID: number;
  GRNNo: string | null;
  DocNo: string | null;
  TotalAmount: number;
  items: GRNItemLine[];
}

export async function fetchGRNDetail(id: number): Promise<GRNDetail | null> {
  const res = await fetchWithAuth(`/api/grns/${id}`);
  if (!res.ok) return null;
  const r = await res.json().catch(() => ({}));
  return {
    GRNID: r.GRNID,
    GRNNo: r.GRNNo ?? null,
    DocNo: r.DocNo ?? null,
    TotalAmount: parseFloat(r.TotalAmount) || 0,
    items: parseGRNItems(r.GRNItems),
  };
}

export interface GrnGstBreakdownItem {
  itemName: string;
  gstPercent: number;
  receivedQty: number;
  totalAmountInclGST: number;
  baseAmount: number;
  gstAmount: number;
}

export interface GrnGstBreakdown {
  items: GrnGstBreakdownItem[];
  totals: { totalBase: number; totalCGST: number; totalSGST: number; totalGST: number; totalInclGST: number };
}

export async function fetchGrnGstBreakdown(id: number): Promise<GrnGstBreakdown | null> {
  const res = await fetchWithAuth(`/api/grns/${id}/gst-breakdown`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// Used by InvoicePreviewScreen's GRN Items Summary section — GRN line items
// aren't stored on the ExpenseBooking row (see dbToRecord's note above), so
// they're re-fetched live from the source GRN(s) whenever the record is
// GRN-linked. Handles the multi-GRN combined-invoice case by merging.
export async function fetchGRNItemsFor(eSourceType: string | null, eSourceId: number | null, linkedGrnIds: number[] | null): Promise<GRNItemLine[]> {
  if (eSourceType !== "GRN" || !eSourceId) return [];
  const ids = linkedGrnIds && linkedGrnIds.length > 1 ? linkedGrnIds : [eSourceId];
  const details = await Promise.all(ids.map((id) => fetchGRNDetail(id)));
  return details.filter((d): d is GRNDetail => !!d).flatMap((d) => d.items);
}

// RN port of aggregateGRNsForInvoice (ExpenseBooking/invoiceLinking.ts) —
// combines several GRNs raised against the *same* PO into one invoice.
// Sums each GRN's stored TotalAmount (GST-inclusive, authoritative) and its
// live per-item GST breakdown, so the merged CGST/SGST rate reflects the
// actual HSN-driven rates rather than a guess. The backend re-validates and
// re-totals this authoritatively on save — this is only the client preview.
export interface MultiGRNAggregate {
  valid: boolean;
  error?: string;
  grnIds: number[];
  grnDocNos: string[];
  basicAmount: number;
  totalAmount: number;
  cgstRate: number;
  sgstRate: number;
  items: GRNItemLine[];
}

export async function aggregateGRNsForInvoice(selected: GRNOption[]): Promise<MultiGRNAggregate> {
  const empty: MultiGRNAggregate = { valid: false, grnIds: [], grnDocNos: [], basicAmount: 0, totalAmount: 0, cgstRate: 0, sgstRate: 0, items: [] };
  if (selected.length === 0) return { ...empty, error: "Select at least one GRN." };

  const poIds = new Set(selected.map((g) => g.POID).filter((id): id is number => id != null));
  if (poIds.size !== 1) return { ...empty, error: "All selected GRNs must be linked to the same Purchase Order." };

  const ordered = [...selected].sort((a, b) => a.GRNID - b.GRNID);
  const details = await Promise.all(ordered.map((g) => fetchGRNDetail(g.GRNID)));
  const breakdowns = await Promise.all(ordered.map((g) => fetchGrnGstBreakdown(g.GRNID)));

  const grnIds = ordered.map((g) => g.GRNID);
  const grnDocNos = ordered.map((g, i) => details[i]?.GRNNo || details[i]?.DocNo || g.GRNNo || g.DocNo || `GRN-${g.GRNID}`);
  const items = details.filter((d): d is GRNDetail => !!d).flatMap((d) => d.items);
  const totalAmount = ordered.reduce((s, g) => s + (g.TotalAmount ?? 0), 0);

  const merged = breakdowns.filter((b): b is GrnGstBreakdown => !!b).reduce(
    (acc, b) => ({
      totalBase: acc.totalBase + b.totals.totalBase,
      totalCGST: acc.totalCGST + b.totals.totalCGST,
      totalSGST: acc.totalSGST + b.totals.totalSGST,
    }),
    { totalBase: 0, totalCGST: 0, totalSGST: 0 },
  );
  const basicAmount = merged.totalBase > 0 ? merged.totalBase : items.reduce((s, i) => s + (i.receivedQty || 0) * (i.rate || 0), 0);
  const cgstRate = merged.totalBase > 0 ? Math.round((merged.totalCGST / merged.totalBase) * 10000) / 100 : 0;
  const sgstRate = merged.totalBase > 0 ? Math.round((merged.totalSGST / merged.totalBase) * 10000) / 100 : 0;

  return { valid: true, grnIds, grnDocNos, basicAmount, totalAmount: totalAmount > 0 ? totalAmount : basicAmount, cgstRate, sgstRate, items };
}

// ── Billing terms & cost centres ────────────────────────────────────────────

export interface BillingTermOption {
  BillingTermID: number;
  Name: string;
  CalculationType: string;
  DiscountValue: number;
  DeductionType: "Addition" | "Deduction";
  IsActive?: boolean;
}

export async function fetchBillingTermOptions(): Promise<BillingTermOption[]> {
  const res = await fetchWithAuth("/api/billing-terms");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => []);
  return (Array.isArray(raw) ? raw : []).filter((t: any) => t.IsActive !== false);
}

export function billingTermToConfig(t: BillingTermOption): BillingTerm {
  return {
    applicable: true,
    type: t.CalculationType === "flat" ? "fixed" : "percentage",
    value: t.DiscountValue ?? 0,
    appliedOn: t.CalculationType === "After GST" ? "post-gst" : "pre-gst",
    deductionType: t.DeductionType === "Addition" ? "Addition" : "Deduction",
    masterTermName: t.Name,
  };
}

export interface CostCenterOption {
  id: number;
  label: string;
  code?: string | null;
}

export async function fetchCostCenterOptionsInv(): Promise<CostCenterOption[]> {
  const res = await fetchWithAuth("/api/cost-center/options");
  if (!res.ok) return [];
  const raw = await res.json().catch(() => []);
  return (Array.isArray(raw) ? raw : []).map((c: any) => ({ id: c.id, label: c.code ? `${c.code} - ${c.label}` : c.label, code: c.code ?? null }));
}

// ── EMI ──────────────────────────────────────────────────────────────────────
// RN port of generateEmiSchedule (ExpenseBooking/helpers.ts).

export interface EmiScheduleRow {
  installmentNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid";
  refNumber: string;
}

export function generateEmiSchedule(netAmount: number, installmentCount: number, startDate: string, baseDocNo = ""): EmiScheduleRow[] {
  if (!installmentCount || !startDate || installmentCount <= 0) return [];
  const baseAmount = Math.floor((netAmount / installmentCount) * 100) / 100;
  const lastAmount = Math.round((netAmount - baseAmount * (installmentCount - 1)) * 100) / 100;
  return Array.from({ length: installmentCount }, (_, i) => {
    const d = new Date(startDate);
    d.setMonth(d.getMonth() + i);
    const padded = String(i + 1).padStart(2, "0");
    return {
      installmentNo: i + 1,
      dueDate: d.toISOString().slice(0, 10),
      amount: i === installmentCount - 1 ? lastAmount : baseAmount,
      status: "Pending" as const,
      refNumber: baseDocNo ? `${baseDocNo}-EMI-${padded}` : `EMI-${padded}`,
    };
  });
}

// ── GL Posting (view-only — matches this app's convention elsewhere of never
// triggering money-posting side effects from mobile; the web preview modal
// auto-posts the instant the Posting tab opens, but that's a side-effecting
// GL write we deliberately don't fire from here) ───────────────────────────

export interface InvoicePostingAccount {
  id: number;
  label: string;
}

export interface InvoicePostingData {
  isGrnLinked: boolean;
  baseAmount: number;
  taxAmount: number;
  totalAmount: number;
  grnBreakdown: Array<{ grnId: number; docNo: string | null; date: string | null; baseAmount: number; taxAmount: number; totalAmount: number }> | null;
  supplierName: string | null;
  accounts: {
    purchase?: InvoicePostingAccount | null;
    pgrn?: InvoicePostingAccount | null;
    supplier?: InvoicePostingAccount | null;
    gstCredit?: InvoicePostingAccount | null;
  };
  isPosted: boolean;
  jvNo: string | null;
}

export async function fetchInvoicePosting(id: string): Promise<InvoicePostingData | null> {
  const res = await fetchWithAuth(`${INVOICE_API}/${id}/posting`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

// RN port of computeBreakdown (ExpenseBooking/helpers.ts) — pre/post-GST
// billing terms applied sequentially, same order as web.
export function computeBreakdown(basicAmount: number, cgstRate: number, sgstRate: number, igstRate: number, terms: BillingTerm[]) {
  const active = terms.filter((t) => t.applicable);
  const preTerms = active.filter((t) => t.appliedOn !== "post-gst");
  const postTerms = active.filter((t) => t.appliedOn === "post-gst");

  let runningBase = basicAmount;
  const preRows: Array<{ term: BillingTerm; amount: number }> = [];
  for (const t of preTerms) {
    const amt = t.type === "percentage" ? (runningBase * t.value) / 100 : t.value;
    preRows.push({ term: t, amount: amt });
    if (t.deductionType === "Addition") runningBase += amt;
    else runningBase = Math.max(0, runningBase - amt);
  }

  const taxableAmount = Math.max(0, runningBase);
  const cgstAmount = (taxableAmount * cgstRate) / 100;
  const sgstAmount = (taxableAmount * sgstRate) / 100;
  const igstAmount = (taxableAmount * igstRate) / 100;
  let grossAmount = taxableAmount + cgstAmount + sgstAmount + igstAmount;

  const postRows: Array<{ term: BillingTerm; amount: number }> = [];
  for (const t of postTerms) {
    const amt = t.type === "percentage" ? (grossAmount * t.value) / 100 : t.value;
    postRows.push({ term: t, amount: amt });
    if (t.deductionType === "Addition") grossAmount += amt;
    else grossAmount = Math.max(0, grossAmount - amt);
  }

  return {
    taxableAmount,
    cgstAmount,
    sgstAmount,
    igstAmount,
    grossAmount,
    netAmount: Math.round(grossAmount),
    preRows,
    postRows,
  };
}
