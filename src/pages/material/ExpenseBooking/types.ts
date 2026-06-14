// ─── Expense Booking — Shared Types ──────────────────────────────────────────
export type BookingStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Booked"
  | "Hold"
  | "Received";

export type BillStatus = "Payment Due" | "Partially Paid" | "Paid";

export type PageView = "list" | "form";

export interface PurchaseOrder {
  id: number | null;
  poNumber: string;
  supplier: string;
  projectSite: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  rate: number;
  totalAmount: number;
  paymentTerms: string;
  cgstRate: number;
  sgstRate: number;
  invoiceReference: string;
}

export interface DiscountConfig {
  applicable: boolean;
  type: "percentage" | "fixed";
  value: number;
  appliedOn: "pre-gst" | "post-gst";
  masterTermId: string | null;
  masterTermName: string | null;
  /** Whether this term adds to or subtracts from the base amount */
  deductionType?: "Addition" | "Deduction";

  /** Unique local key for React list rendering (not persisted) */
  _key?: string;

  /** Optional calculated amount (used in UI for fixed discounts) */
  amount?: number;
}

export interface EmiScheduleRow {
  installmentNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid";
  /** Auto-generated ref: base doc number + "-EMI-01", "-EMI-02", etc. */
  refNumber: string;
}

export interface EmiConfig {
  enabled: boolean;
  installmentCount: number;
  emiAmount: number;
  startDate: string;
  schedule: EmiScheduleRow[];
  frequency?: string;
}

export interface ApprovalStep {
  level: number;
  role: string;
  approverEmail: string | null;
  status: "Pending" | "Approved" | "Rejected";
  actionAt: string | null;
  note: string | null;
}

export interface ApprovalTrail {
  steps: ApprovalStep[];
  currentLevel: number;
  fullyApproved: boolean;
}

export interface ExpenseRecord {
  id: string;
  bookingName: string;
  bookingReference: string;
  docTypeName: string;
  bookingDate: string;
  dueDate: string;
  financialYear: string;
  companyId: number | null;
  poId: string | null;
  supplier: string;
  projectSite: string;
  materialCategory: string;
  invoiceReference: string;
  basicAmount: number;
  cgstRate: number;
  sgstRate: number;
  discount: DiscountConfig;
  emi: EmiConfig;
  /** Payment mode derived from EMI flag. */
  paymentType?: "full" | "partial";
  netAmount: number | null;
  /** Live GRN incl-GST total for GRN-linked bookings; null for others. */
  grnTotalAmount: number | null;
  status: BookingStatus;
  remarks: string;
  billingTermId: number | null;
  billingTermName: string;
  /** Multi-term support: list of all applied billing terms */
  billingTerms: DiscountConfig[];
  tcId: number | null;
  tcName: string;
  tcText: string;
  approvalTrail?: ApprovalTrail;

  // Optional fields for display / frontend use
  companyName?: string;
  projectName?: string;
  projectId?: number | string;
  purchaseOrderId?: number | string;
  workOrderId?: number | string;
  sourceDocNo?: string;
  igstRate?: number;
  /** Source document type: PO | WO | GRN | TOD — saved to DB and restored on edit */
  eSourceType?: "PO" | "WO" | "WO_PO" | "GRN" | "TOD" | "WORK_DONE" | null;
  /** Source document DB id — saved to DB and restored on edit */
  eSourceId?: number | null;

  // ── Invoice Details (Step 6 spec) ───────────────────────────────────────────
  /** Vendor/supplier invoice number (from their physical invoice) */
  vendorInvoiceNo?: string;
  /** Vendor/supplier invoice date */
  vendorInvoiceDate?: string;

  // ── Expense Allocation (Step 6 spec) ────────────────────────────────────────
  /** Cost Centre / Department for expense allocation */
  costCenter?: string;
  /** GL Account code or name for accounting entry */
  glAccount?: string;
  /** Work Done doc reference — auto-populated when source is WO_PO or WORK_DONE */
  workDoneRef?: string;
  /** Additional charges: freight, insurance, etc. JSON array {label, amount} */
  additionalCharges?: { label: string; amount: number }[];

  // ── Bill Status (Step 7 spec) ────────────────────────────────────────────────
  /** Payment Due | Partially Paid | Paid — set by syncBillStatus after each payment */
  billStatus?: BillStatus | null;
  /** Sum of all Approved payments against this booking */
  totalPaid?: number;
  /** ENetAmount - totalPaid */
  remainingAmount?: number;

  grnItems?: {
    itemName?: string;
    qty?: number;
    rate?: number;
    amount?: number;
    [key: string]: any;
  }[];
}

export interface PriceBreakdown {
  basicAmount: number;
  discountAmount: number;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount?: number;
  grossAmount: number;
  roundOff: number;
  netAmount: number;
  /** Resolved pre-GST terms with termType normalised to "Addition" | "Deduction" */
  preGstTerms?: (DiscountConfig & { termType: "Addition" | "Deduction" })[];
  /** Resolved post-GST terms with termType normalised */
  postGstTerms?: (DiscountConfig & { termType: "Addition" | "Deduction" })[];
}

export interface GrnGstLine {
  lineNo: number;
  itemId: string | null;
  itemName: string;
  orderedQty: number;
  receivedQty: number;
  uom: string;
  unitRate: number;
  hsnCode: string | null;
  gstPercent: number;
  taxableAmount: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  gstAmount: number;
  netAmount: number;
}

export interface GrnGstData {
  grnId: number;
  grnNo: string;
  poId: number | null;
  poNo: string | null;
  supplierId: number | null;
  supplierName: string | null;
  companyId: number | null;
  vendorState: string;
  companyState: string;
  taxMode: "cgst_sgst" | "igst";
  gstPercent: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  totals: {
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    gstAmount: number;
    netAmount: number;
    receivedQty: number;
  };
  lines: GrnGstLine[];
}
