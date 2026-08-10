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
  "Expense Head": CreditCard,
  "Billing Terms": Receipt,
  "EMI / Installment Options": CreditCard,
  "Approval Workflow": CheckCircle2,
  "Terms & Conditions": FileText,
  Remarks: StickyNote,
};

// Gives each section of the Invoice form its own accent color (icon badge +
// label tint) instead of every SectionHeader looking identical — a quick
// visual anchor for "which part of the form am I in" on a long scroll.
// Tailwind classes must be static strings (no dynamic `bg-${x}-500` — the
// JIT compiler can't see those), hence the plain lookup table.
export const SECTION_COLORS: Record<string, { badge: string; icon: string }> = {
  "Booking Information": { badge: "bg-indigo-500/10", icon: "text-indigo-500" },
  "Document Selection": { badge: "bg-sky-500/10", icon: "text-sky-500" },
  "Amount & GST": { badge: "bg-emerald-500/10", icon: "text-emerald-500" },
  "GRN Items Summary": { badge: "bg-teal-500/10", icon: "text-teal-500" },
  "Expense Head": { badge: "bg-violet-500/10", icon: "text-violet-500" },
  "Billing Terms": { badge: "bg-amber-500/10", icon: "text-amber-500" },
  "EMI / Installment Options": { badge: "bg-fuchsia-500/10", icon: "text-fuchsia-500" },
  "Approval Workflow": { badge: "bg-cyan-500/10", icon: "text-cyan-500" },
  "Terms & Conditions": { badge: "bg-sky-500/10", icon: "text-sky-500" },
  Remarks: { badge: "bg-slate-500/10", icon: "text-slate-500" },
};
export const DEFAULT_SECTION_COLOR = { badge: "bg-emerald-500/10", icon: "text-emerald-500" };

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
