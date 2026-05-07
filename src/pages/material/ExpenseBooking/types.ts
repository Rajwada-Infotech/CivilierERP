// ─── Expense Booking — Shared Types ──────────────────────────────────────────
export type BookingStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Booked"
  | "Hold"
  | "Received";

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
  grossAmount: number;
  roundOff: number;
  netAmount: number;
}
