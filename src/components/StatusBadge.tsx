import { cn } from "../lib/utils";
import {
  CheckCircle2,
  Clock,
  FileEdit,
  SendHorizonal,
  XCircle,
  PackageCheck,
  PackageSearch,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────
// Add any new domain status here — nothing else needs to change.
const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; classes: string }
> = {
  // Generic approval states
  Draft: {
    label: "Draft",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Issued: {
    label: "Issued",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Pending: {
    label: "Pending",
    icon: Clock,
    classes:
      "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  },
  Approved: {
    label: "Approved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Rejected: {
    label: "Rejected",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // Expense booking domain statuses
  Booked: {
    label: "Booked",
    icon: CheckCircle2,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Hold: {
    label: "Hold",
    icon: Clock,
    classes:
      "bg-yellow-500/10 text-yellow-600 border-yellow-500/25 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/25",
  },
  Received: {
    label: "Received",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  // GoodsReceiptNotes domain statuses
  "Partially Received": {
    label: "Partial",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  "Fully Received": {
    label: "Received",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  // Material Request domain statuses
  Ordered: {
    label: "Ordered",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  Completed: {
    label: "Completed",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  "Partially Ordered": {
    label: "Partial PO",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  "Partially Fulfilled": {
    label: "Partially Fulfilled",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  // Quotation domain statuses
  Sent: {
    label: "Sent",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  PartiallyQuoted: {
    label: "Partially Quoted",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  Quoted: {
    label: "Quoted",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  Closed: {
    label: "Closed",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  // Year-end housekeeping: partially-fulfilled PO/MR permanently retired —
  // see src/pages/material/ShortClose.tsx.
  "Short Closed": {
    label: "Short Closed",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
};

// Unit Master / Unit Matrix domain statuses — mirrors unitMatrix.js's
// live-derived Status (Blocked/Booked/OnHold/Available) exactly.
// Kept in a separate constant to avoid static-analysis duplicate-property
// warnings (the amber/emerald classes appear on generic statuses above too).
const UNIT_STATUS_CONFIG: typeof STATUS_CONFIG = {
  "On Hold": {
    label: "On Hold",
    icon: Clock,
    classes:
      "bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/25",
  },
  Available: {
    label: "Available",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Blocked: {
    label: "Blocked",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
};

// Merged lookup — unit statuses override generics when keys collide.
const ALL_STATUS_CONFIG: typeof STATUS_CONFIG = {
  ...STATUS_CONFIG,
  ...UNIT_STATUS_CONFIG,
};


// Fallback for unknown statuses
const FALLBACK = {
  label: "Unknown",
  icon: FileEdit,
  classes: "bg-gray-100 text-gray-500 border-gray-200",
};

interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = (status && ALL_STATUS_CONFIG[status]) || FALLBACK;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium",
        config.classes,
        className,
      )}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {config.label}
    </span>
  );
}