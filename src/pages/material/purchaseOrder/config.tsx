// Constants, types and small helpers shared by the Purchase Order page and its parts.
import { generateUUID } from "../../../utils/cryptoPolyfill";
import { useEffect, useState } from "react";
import { printStatusLabel } from "@/utils/printStatus";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { FileText, BadgeCheck, Clock, XCircle, AlertCircle } from "lucide-react";
import { type ExportColumn } from "@/lib/export";

// ─── Template columns ─────────────────────────────────────────────────────────
export const PO_TEMPLATE_COLUMNS = [
  { header: "Document Type", accessor: "Document Type" },
  { header: "Supplier", accessor: "Supplier" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "PO Date (YYYY-MM-DD)", accessor: "PO Date (YYYY-MM-DD)" },
  {
    header: "Expected Delivery Date (YYYY-MM-DD)",
    accessor: "Expected Delivery Date (YYYY-MM-DD)",
  },
  { header: "Payment Terms", accessor: "Payment Terms" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
  { header: "Rate", accessor: "Rate" },
  { header: "GST %", accessor: "GST %" },
];

// ─── PO Chain Status Hook ─────────────────────────────────────────────────────

export interface ChainStatus {
  expenseCount: number;
  latestExpenseDocNo: string | null;
  latestExpenseStatus: string | null;
  latestExpenseAmount: number | null;
  paymentCount: number;
  latestPaymentAmount: number | null;
  isPaid: boolean;
}

export function usePOChainStatus(poId: string | null) {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!poId) {
      setStatus(null);
      return;
    }
    setLoading(true);
    fetchWithAuth(
      `/api/expense-booking/chain-status?sourceType=PO&sourceId=${poId}`,
    )
      .then((r) => r.json().catch(() => ({})))
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [poId]);

  return { status, loading };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface POLineItem {
  id: string;
  itemId: string;
  itemName: string;
  itemDescription: string;
  quantity: number;
  uomId: number | null;
  unit: string;
  rate: number;
  cgstRate: number; // from item master M_CGST
  sgstRate: number; // from item master M_SGST
  igstRate: number; // from item master M_IGST
  gstRate: number; // effective total GST % (igst if set, else cgst+sgst)
  taxAmount: number; // qty * rate * gstRate / 100
  amount: number; // qty * rate + taxAmount (inclusive of GST)
  uomLocked?: boolean; // true for quotation-sourced lines — UOM must match what was quoted
  mrItemId?: number | null; // source MaterialRequestItems row, when this line came from an MR
  mrPendingQty?: number | null; // cap for this line's quantity — remaining balance on that MR item
  costCenterId?: string; // from the selected item's own Item Master tag — persisted per-line (not per-PO), since one PO can mix e.g. a fixed-asset item with a consumption item
}

export interface POForm {
  poNumber: string;
  poDate: string;
  expectedDate: string;
  supplierId: string;
  companyId: string;
  projectId: string;
  paymentTerms: string;
  remarks: string;
  docTypeId: number | null;
  docNo: string;
  status: string;
  costCenterId: string;
  paymentTermId: string;
}

export interface DropdownOption {
  id: number | string;
  name: string;
}

export interface TCRecord {
  id: number;
  name: string;
  terms: string;
}

export interface POListItem {
  _id: string;
  poNumber: string;
  poDate: string;
  supplierName: string;
  companyName: string;
  projectName: string;
  totalAmount: number;
  status: string;
  docNo: string;
  remarks: string;
  poType: string;
  sourceWODocNo: string | null;
  /** MR this PO is tagged to — direct or, for a Quotation-sourced PO, the
   *  Quotation's own MR (see backend's EffectiveMRDocNo). */
  effectiveMRDocNo: string | null;
}

export const PO_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "docNo" },
  { header: "PO Number", accessor: "poNumber" },
  { header: "Date", accessor: (r) => r.poDate ? new Date(r.poDate as string).toLocaleDateString("en-IN") : "" },
  { header: "Supplier", accessor: "supplierName" },
  { header: "Company", accessor: "companyName" },
  { header: "Project", accessor: "projectName" },
  { header: "Total Amount", accessor: (r) => Number(r.totalAmount) || 0 },
  { header: "Status", accessor: (r) => printStatusLabel(r.status as string) },
  { header: "Type", accessor: "poType" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const uid = () => generateUUID();

export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

export const fmtDate = (d: string) => {
  const dt = new Date(d);
  return isNaN(dt.getTime())
    ? ""
    : dt.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

export function ensureArray<T>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.recordset)) return obj.recordset as T[];
  }
  return [];
}

export const EMPTY_LINE = (): POLineItem => ({
  id: uid(),
  itemId: "",
  itemName: "",
  itemDescription: "",
  quantity: 1,
  uomId: null,
  unit: "",
  rate: 0,
  cgstRate: 0,
  sgstRate: 0,
  igstRate: 0,
  gstRate: 0,
  taxAmount: 0,
  amount: 0,
});

export const EMPTY_FORM = (): POForm => ({
  poNumber: "",
  poDate: new Date().toISOString().slice(0, 10),
  expectedDate: "",
  supplierId: "",
  companyId: "",
  projectId: "",
  paymentTerms: "",
  remarks: "",
  docTypeId: null,
  docNo: "",
  status: "Draft",
  costCenterId: "",
  paymentTermId: "",
});

// ─── Shared styles (matching WorkOrderMaster) ─────────────────────────────────

export const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

export const cellInput =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition";

export const cellSelect =
  "w-full text-sm rounded-md border border-border px-2.5 py-1.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

export const FieldLabel: React.FC<{
  children: React.ReactNode;
  required?: boolean;
}> = ({ children, required }) => (
  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
    {children}
    {required && <span className="text-red-500 ml-0.5">*</span>}
  </label>
);

// ─── Status helpers ───────────────────────────────────────────────────────────

export const getStatusConfig = (status: string) => {
  const s = (status || "Draft").toLowerCase();
  if (s === "approved" || s === "received")
    return {
      icon: <BadgeCheck size={12} />,
      cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    };
  if (s === "pending" || s === "issued")
    return {
      icon: <Clock size={12} />,
      cls: "bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    };
  if (s === "rejected" || s === "closed")
    return {
      icon: <XCircle size={12} />,
      cls: "bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
    };
  if (s === "partially received")
    return {
      icon: <AlertCircle size={12} />,
      cls: "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    };
  if (s === "short closed")
    return {
      icon: <XCircle size={12} />,
      cls: "bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700",
    };
  return {
    icon: <FileText size={12} />,
    cls: "bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  };
};

export const StatusChip: React.FC<{ status: string }> = ({ status }) => {
  const cfg = getStatusConfig(status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.6875rem] font-semibold border ${cfg.cls}`}
    >
      {cfg.icon}
      {status}
    </span>
  );
};

// Items are tagged with CGST, SGST, and IGST rates all at once in Item
// Master — which one actually applies depends on whether the supplier and
// ordering company share a GST state. Shared by every line-item source
// (manual item pick, MR prefill, Quotation prefill) so a PO's GST split
// isn't at the mercy of whichever fields happen to be populated on the
// item master row — most items only ever have M_IGST filled in, which
// used to mean every prefilled line showed IGST regardless of whether the
// order was actually intrastate.
export function resolveLineGstSplit(
  cgst: number,
  sgst: number,
  igst: number,
  resolvedTotal: number,
  isIntraState: boolean,
): { cgstRate: number; sgstRate: number; igstRate: number; gstRate: number } {
  let cgstRate = 0;
  let sgstRate = 0;
  let igstRate = 0;
  if (isIntraState) {
    if (cgst > 0 || sgst > 0) {
      cgstRate = cgst;
      sgstRate = sgst;
    } else if (igst > 0) {
      // Only an IGST rate is on file — split it evenly for an intrastate order.
      cgstRate = igst / 2;
      sgstRate = igst / 2;
    } else if (resolvedTotal > 0) {
      cgstRate = resolvedTotal / 2;
      sgstRate = resolvedTotal / 2;
    }
  } else {
    if (igst > 0) {
      igstRate = igst;
    } else if (cgst > 0 || sgst > 0) {
      // Only a CGST/SGST split is on file — combine it for an interstate order.
      igstRate = cgst + sgst;
    } else if (resolvedTotal > 0) {
      igstRate = resolvedTotal;
    }
  }
  return { cgstRate, sgstRate, igstRate, gstRate: cgstRate + sgstRate + igstRate };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export type ViewMode = "list" | "create" | "edit" | "view";
