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
  /** AccountHeadMaster.LHeadId for `supplier` — only meaningful for direct/manual
   *  (non PO/WO/GRN-linked) bookings, where the backend has no source document to
   *  derive the supplier from and relies on this instead (ExpenseBooking.LHeadId). */
  supplierLHeadId?: number | null;
  /** Whether the resolved supplier/contractor is GST-registered — drives the
   *  "GST Bill" / "Non GST Bill" badge on the invoice list. */
  supplierGstRegistered?: boolean;
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
  /** For paymentType "partial" — the amount paid up-front; EMI is generated
   *  against the remainder (netAmount - partialAmount), not the full net. */
  partialAmount?: number;
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
  /** PaymentTermId from PaymentTermMaster — drives auto-calculated due date */
  paymentTermId?: number | null;
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

// ─── Document Selector types (PO / WO / WO_PO / TOD / GRN / Work Done picker) ──

export interface CompanyOption {
  id: number;
  label: string;
}
export interface ProjectOption {
  id: number;
  label: string;
  company_id?: number | null;
}
export interface GSTConfig {
  applicable: boolean;
  type: "none" | "cgst_sgst" | "igst";
  rate: number;
}
export interface POItem {
  PurchaseOrderID: number;
  PurchaseOrderNo: string;
  DocNo?: string;
  PODate: string;
  ItemDescription?: string;
  SupplierName?: string;
  CompanyId?: number;
  ProjectId?: number;
  TotalAmount?: number;
  Status: string;
  GST?: GSTConfig | null;
  SourceWOId?: number | null;
  SourceWODocNo?: string | null;
  SourceWDId?: number | null;
  SourceWDDocNo?: string | null;
  POType?: string | null;
  POItems?: Record<string, unknown>[];
}
export interface WOItem {
  Id: number;
  DocumentNumber: string;
  DocNo?: string;
  DocumentDate: string;
  ContractorName?: string;
  Remarks?: string;
  CompanyId?: number;
  ProjectId?: number;
  TotalAmount?: number;
  Status: string;
  GST?: GSTConfig | null;
}
export interface WorkDoneItem {
  ID: number;
  DocNo?: string;
  DocDate?: string;
  FinYear?: string | null;
  ContractorName?: string;
  SupplierId?: number;
  SupplierName?: string;
  DescriptionOfWork?: string;
  CertifiedAmount?: number;
  Status: string;
  CompanyId?: number;
  ProjectId?: number;
  WorkOrderID?: number;
  WorkOrderNo?: string;
  GST?: GSTConfig | null;
}
export interface TodItem {
  TypeOfDocId: number;
  Prefix: string;
  FullPrefix?: string;
  Description: string;
  EntryType?: string;
}
export type SourceKind = "PO" | "WO" | "WO_PO" | "TOD" | "GRN" | "WORK_DONE";

export interface GRNItemLine {
  itemName?: string;
  itemId?: string;
  orderedQty: number;
  receivedQty: number;
  remainingQty: number;
  uom?: string;
  rate?: number;
  quantity?: number;
  totalAmount?: number;
  // GST breakdown fields (populated after /gst-breakdown fetch)
  hsnCode?: string;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  baseAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  gstAmount?: number;
  totalAmountInclGST?: number;
}

export interface SelectedDoc {
  kind: SourceKind;
  docNo: string;
  sourceId: number;
  nameLabel?: string;
  vendorLabel?: string;
  companyId?: number;
  projectId?: number;
  amount?: number;
  /** Pre-tax subtotal (sum of qty × rate across all line items) — populated for PO / WO_PO */
  subtotal?: number;
  /** CGST rate derived from PO line items (weighted avg) */
  derivedCgstRate?: number;
  /** SGST rate derived from PO line items (weighted avg) */
  derivedSgstRate?: number;
  status?: string;
  date?: string;
  gst?: GSTConfig | null;
  grnItems?: GRNItemLine[];
  /** Set only when multiple GRNs (same PO) were combined into this one
   *  invoice — see ExpenseBooking/invoiceLinking.ts. */
  linkedGrnIds?: number[];
  linkedGrnDocNos?: string[];
}

export interface GRNItem {
  GRNID: number;
  GRNNo: string;
  DocNo?: string;
  GRNDate: string;
  SupplierName?: string;
  PONumber?: string;
  POID?: number;
  CompanyId?: number;
  ProjectId?: number;
  FinYear?: string;
  Status?: string;
  TotalItems?: number;
  Remarks?: string;
  GRNItems?: string | GRNItemLine[];
  ParentGST?: GSTConfig | string | null;
}

export interface BillingTermOption {
  BillingTermID: number;
  Name: string;
  Description?: string;
  Type?: string;
  GST?: string;
  IsActive?: boolean;
}
export interface TCOption {
  Id: number;
  Name: string;
  TermsAndCondition?: string;
}
export interface CostCenterOption {
  id: number;
  label: string;
  code: string;
  projectId: number | null;
}

export interface DocSelectorProps {
  poList: POItem[];
  woPOList: POItem[];
  workDoneList: WorkDoneItem[];
  todList: TodItem[];
  grnList: GRNItem[];
  loadingPO: boolean;
  loadingWorkDone: boolean;
  loadingWOPO: boolean;
  loadingTOD: boolean;
  loadingGRN: boolean;

  // GRN filtering (suppliers-based picker)
  companyOptions: CompanyOption[];
  projectOptions: ProjectOption[];
  suppliers: { id: number; label: string }[];

  selected: SelectedDoc | null;
  finYear?: string;
  filterCompanyId?: number | null;
  filterProjectId?: number | null;
  filterFinYear?: string | null;
  filterSupplier?: string | null;
  /** IDs already booked — excludes them from picker (except the one being edited) */
  bookedPOIds?: Set<number>;
  bookedWorkDoneIds?: Set<number>;
  bookedWOPOIds?: Set<number>;
  bookedGRNIds?: Set<number>;
  onSelect: (doc: SelectedDoc) => void;
  onClear: () => void;
  onTodSelected?: (tod: TodItem | null) => void;
  /** Combines several selected GRNs (same PO) into one invoice — the
   *  second way to link GRNs, alongside picking one at a time. */
  onSelectMultiGRN?: (grns: GRNItem[]) => void;
}
