// Constants, types and small helpers shared by the Material Request page and its parts.
import { generateUUID } from "@/utils/cryptoPolyfill";
import React from "react";
import { type ExportColumn } from "@/lib/export";

// ─── Template columns ─────────────────────────────────────────────────────────
export const MR_TEMPLATE_COLUMNS = [
  { header: "Document Type", accessor: "Document Type" },
  { header: "Company", accessor: "Company" },
  { header: "Project/Site", accessor: "Project/Site" },
  { header: "Financial Year", accessor: "Financial Year" },
  { header: "Priority (Normal/High/Critical/Low)", accessor: "Priority (Normal/High/Critical/Low)" },
  { header: "Required By Date (YYYY-MM-DD)", accessor: "Required By Date (YYYY-MM-DD)" },
  { header: "Reason", accessor: "Reason" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
  { header: "Item Remarks", accessor: "Item Remarks" },
];

// ─── Shared styles (matching PurchaseOrderMaster) ────────────────────────────

export const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CartItem {
  _key: string;
  ItemId: string;
  ItemName?: string;
  UOMCode: string;
  Quantity: string;
  Remarks: string;
  AvailableStock?: number;
  DefaultUOM?: string;
  // From the selected item's own Item Master tag (M_CostCenterId) — same
  // auto-fill convention Purchase Order's line items already use.
  CostCenterId?: string;
}

export interface FormHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  requestDate: string;
  requiredByDate: string;
  priority: string;
  reason: string;
  remarks: string;
  docTypeId: number | null;
  docNoPreview: string;
}

export const defaultHeader: FormHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  requestDate: new Date().toISOString().slice(0, 10),
  requiredByDate: "",
  priority: "Normal",
  reason: "",
  remarks: "",
  docTypeId: null,
  docNoPreview: "",
};

export const blankCartItem = (): CartItem => ({
  _key: generateUUID(),
  ItemId: "",
  UOMCode: "",
  Quantity: "",
  Remarks: "",
});

export const PRIORITY_OPTIONS = ["Low", "Normal", "High", "Urgent"];

export const PRIORITY_COLOR: Record<string, string> = {
  Low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  Normal:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  Urgent: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

export const Field = ({
  label,
  required,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </label>
    {children}
  </div>
);

export const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Priority", accessor: "Priority" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Item Count", accessor: (r) => Number(r.ItemCount) || 0 },
  { header: "Qty (by UOM)", accessor: (r) => (r.QtyByUom as string) || "—" },
  { header: "Requested", accessor: (r) => fmtDate(r.RequestDate as string) },
  { header: "Required By", accessor: (r) => fmtDate(r.RequiredByDate as string) },
  { header: "Status", accessor: "Status" },
];
