// Styles, types and small helpers shared by the Quotation page and its parts.
import React from "react";
import { type ExportColumn } from "@/lib/export";
import { printStatusLabel } from "@/utils/printStatus";

// ─── Shared styles ──────────────────────────────────────────────────────────────

export const inputCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm rounded-lg border border-border px-3 py-2.5 pr-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition appearance-none";

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

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN");
};

export const EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Doc No", accessor: "DocNo" },
  { header: "Company", accessor: "CompanyName" },
  { header: "Project", accessor: "ProjectName" },
  { header: "Date", accessor: (r) => fmtDate(r.DocDate as string) },
  { header: "Suppliers", accessor: (r) => Number(r.SupplierCount) || 0 },
  { header: "Items", accessor: (r) => Number(r.ItemCount) || 0 },
  { header: "Status", accessor: (r) => printStatusLabel(r.Status as string) },
];

export const SectionHeader = ({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) => (
  <div className="flex items-center gap-3 pb-3 border-b border-border mb-4">
    <div className="w-7 h-7 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0">
      <Icon size={13} className="text-emerald-600 dark:text-emerald-400" />
    </div>
    <div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  </div>
);

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface FormHeader {
  companyId: string;
  projectId: string;
  finYearId: string;
  sourceMRId: string;
  sourceMRDocNo: string;
  docDate: string;
  dueDate: string;
  remarks: string;
  docTypeId: number | null;
  docNoPreview: string;
}

export const defaultHeader: FormHeader = {
  companyId: "",
  projectId: "",
  finYearId: "",
  sourceMRId: "",
  sourceMRDocNo: "",
  docDate: new Date().toISOString().slice(0, 10),
  dueDate: "",
  remarks: "",
  docTypeId: null,
  docNoPreview: "",
};
