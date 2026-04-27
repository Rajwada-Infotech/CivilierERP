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
}

export interface EmiScheduleRow {
  installmentNo: number;
  dueDate: string;
  amount: number;
  status: "Pending" | "Paid";
}

export interface EmiConfig {
  enabled: boolean;
  installmentCount: number;
  emiAmount: number;
  startDate: string;
  schedule: EmiScheduleRow[];
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
  bookingReference: string;
  docTypeName: string;        // e.g. "PR/REC — Received Payment"
  bookingDate: string;
  dueDate: string;
  financialYear: string;
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
  netAmount: number | null;
  status: BookingStatus;
  remarks: string;
  approvalTrail?: ApprovalTrail;
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
