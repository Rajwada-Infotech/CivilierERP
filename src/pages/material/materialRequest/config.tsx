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
  { header: "Priority (Low/Normal/High/Urgent)", accessor: "Priority (Low/Normal/High/Urgent)" },
  { header: "Required By Date (YYYY-MM-DD)", accessor: "Required By Date (YYYY-MM-DD)" },
  { header: "Reason", accessor: "Reason" },
  { header: "Remarks", accessor: "Remarks" },
  { header: "Item Name", accessor: "Item Name" },
  { header: "UOM", accessor: "UOM" },
  { header: "Quantity", accessor: "Quantity" },
  { header: "Item Remarks", accessor: "Item Remarks" },
];

// ─── Sheet styles ─────────────────────────────────────────────────────────────

export const inputCls =
  "w-full text-sm border border-foreground/40 px-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm border border-foreground/40 px-3 py-2.5 pr-8 bg-card text-foreground focus:outline-none focus:border-foreground transition-colors appearance-none";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors disabled:opacity-40";
export const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
export const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

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

// Priority in ink: Urgent is the one thing in red, High solid ink, Normal outlined, Low dashed.
export const PRIORITY_COLOR: Record<string, string> = {
  Low: "text-muted-foreground border-dashed border-foreground/50",
  Normal: "text-foreground border-foreground/50",
  High: "bg-foreground text-card border-foreground",
  Urgent: "text-destructive border-destructive",
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
    <label className="block font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">
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
