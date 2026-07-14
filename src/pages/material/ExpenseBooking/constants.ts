import type { ElementType } from "react";
import {
  FileText,
  CalendarDays,
  BadgePercent,
  Truck,
  Receipt,
  CreditCard,
  CheckCircle2,
  StickyNote,
} from "lucide-react";
import type { BookingStatus } from "./types";

// ─── Shared styles (matching PurchaseOrderMaster) ────────────────────────────

export const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

export const selectTriggerCls =
  "w-full h-auto text-sm rounded-lg border border-border px-3 py-2 bg-background text-foreground hover:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/30 transition";

// ─── Small UI helpers ─────────────────────────────────────────────────────────
export const SECTION_ICONS: Record<string, ElementType> = {
  "Document Selection": FileText,
  "Booking Information": CalendarDays,
  "Amount & GST": BadgePercent,
  "GRN Items Summary": Truck,
  "Billing Terms": Receipt,
  "EMI / Installment Options": CreditCard,
  "Approval Workflow": CheckCircle2,
  "Terms & Conditions": FileText,
  Remarks: StickyNote,
};

export const BOOKING_STATUSES: BookingStatus[] = [
  "Pending",
  "Approved",
  "Rejected",
];
export const ALL_STATUSES = ["All", ...BOOKING_STATUSES] as const;
export const PAGE_SIZE = 20;

// ─── Template columns ─────────────────────────────────────────────────────────
export const INVOICE_TEMPLATE_COLUMNS = [
  { header: "Document Type", accessor: "Document Type" },
  { header: "Supplier", accessor: "Supplier" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Financial Year", accessor: "Financial Year" },
  { header: "Booking Date (YYYY-MM-DD)", accessor: "Booking Date (YYYY-MM-DD)" },
  { header: "Due Date (YYYY-MM-DD)", accessor: "Due Date (YYYY-MM-DD)" },
  { header: "Payment Terms", accessor: "Payment Terms" },
  { header: "Vendor Invoice No", accessor: "Vendor Invoice No" },
  { header: "Vendor Invoice Date (YYYY-MM-DD)", accessor: "Vendor Invoice Date (YYYY-MM-DD)" },
  { header: "Basic Amount", accessor: "Basic Amount" },
  { header: "CGST %", accessor: "CGST %" },
  { header: "SGST %", accessor: "SGST %" },
  { header: "IGST %", accessor: "IGST %" },
  { header: "Remarks", accessor: "Remarks" },
];
