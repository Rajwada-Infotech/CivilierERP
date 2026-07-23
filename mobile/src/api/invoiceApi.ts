// RN port of the read paths of src/pages/material/MaterialExpenseBooking.tsx
// + its dbToRecord() (ExpenseBooking/helpers.ts) — field names copied
// verbatim from there. This app doesn't build/edit invoices yet, just
// views the register and previews a single record, so only the read-side
// fields are ported (no directItems/additionalCharges/EMI-schedule-build).
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

export interface InvoiceRecord {
  id: string;
  bookingReference: string;
  docTypeName: string;
  materialCategory: string;
  bookingDate: string;
  dueDate: string;
  companyName: string;
  projectName: string;
  supplier: string;
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  netAmount: number | null;
  status: BookingStatus;
  billingTerms: BillingTerm[];
  emi: EmiConfig;
  eSourceType: "PO" | "WO" | "WO_PO" | "GRN" | "TOD" | "WORK_DONE" | null;
  eSourceId: number | null;
  sourceDocNo: string | null;
  vendorInvoiceNo: string;
  vendorInvoiceDate: string;
  costCenter: string;
  workDoneRef: string;
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

  return {
    id,
    bookingReference: row.EDocNo ?? (id ? `Draft #${id}` : ""),
    docTypeName: row.DocTypeName ?? "",
    materialCategory: row.EDocumentType ?? "",
    bookingDate: row.EDocDate ? String(row.EDocDate).slice(0, 10) : "",
    dueDate: row.EReminder ? String(row.EReminder).slice(0, 10) : "",
    companyName: row.ECompanyName ?? "",
    projectName: row.EProjectDisplayName ?? row.projectName ?? "",
    supplier: row.ESupplierName ?? row.EName ?? "",
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
    emi,
    eSourceType: row.ESourceType ?? null,
    eSourceId: row.ESourceId ? parseInt(row.ESourceId, 10) : null,
    sourceDocNo: row.sourceDocNo ?? null,
    vendorInvoiceNo: row.EVendorInvoiceNo ?? "",
    vendorInvoiceDate: row.EVendorInvoiceDate ? String(row.EVendorInvoiceDate).slice(0, 10) : "",
    costCenter: row.ECostCenter ?? "",
    workDoneRef: row.EWorkDoneRef ?? "",
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
