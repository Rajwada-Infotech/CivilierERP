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
    classes: "bg-slate-100 text-slate-600 border-slate-200",
  },
  Issued: {
    label: "Issued",
    icon: SendHorizonal,
    classes: "bg-blue-50 text-blue-700 border-blue-200",
  },
  Pending: {
    label: "Pending",
    icon: Clock,
    classes: "bg-amber-50 text-amber-700 border-amber-200",
  },
  Approved: {
    label: "Approved",
    icon: CheckCircle2,
    classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  Rejected: {
    label: "Rejected",
    icon: XCircle,
    classes: "bg-red-50 text-red-700 border-red-200",
  },
  // Expense booking domain statuses
  Booked: {
    label: "Booked",
    icon: CheckCircle2,
    classes: "bg-blue-50 text-blue-700 border-blue-200",
  },
  Hold: {
    label: "Hold",
    icon: Clock,
    classes: "bg-yellow-50 text-yellow-700 border-yellow-200",
  },
  Received: {
    label: "Received",
    icon: PackageCheck,
    classes: "bg-teal-50 text-teal-700 border-teal-200",
  },
  // GoodsReceiptNotes domain statuses
  "Partially Received": {
    label: "Partial",
    icon: PackageSearch,
    classes: "bg-orange-50 text-orange-700 border-orange-200",
  },
  "Fully Received": {
    label: "Received",
    icon: PackageCheck,
    classes: "bg-teal-50 text-teal-700 border-teal-200",
  },
  // Material Request domain statuses
  Ordered: {
    label: "Ordered",
    icon: PackageCheck,
    classes: "bg-teal-50 text-teal-700 border-teal-200",
  },
  "Partially Ordered": {
    label: "Partial PO",
    icon: PackageSearch,
    classes: "bg-orange-50 text-orange-700 border-orange-200",
  },
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
  const config = (status && STATUS_CONFIG[status]) || FALLBACK;
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
