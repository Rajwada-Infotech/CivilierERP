// Styles, types and small helpers shared by the Quotation page and its parts.
import React from "react";
import { type ExportColumn } from "@/lib/export";
import { printStatusLabel } from "@/utils/printStatus";

// ─── Shared styles ──────────────────────────────────────────────────────────────

export const inputCls =
  "w-full text-sm border border-foreground/40 px-3 py-2.5 bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground transition-colors [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer";

export const selectCls =
  "w-full text-sm border border-foreground/40 px-3 py-2.5 pr-8 bg-card text-foreground focus:outline-none focus:border-foreground transition-colors appearance-none disabled:opacity-60";

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors disabled:opacity-40";
export const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

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

// A section's ruled heading on the sheet (the icon is kept in the signature but not drawn).
/** "PartiallyQuoted" -> "Partially quoted" for display. */
export const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/ (\w)/g, (_m, c: string) => " " + c.toLowerCase());

export const SectionHeader = ({ title, sub }: { icon?: React.ElementType; title: string; sub?: string }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2.5 mb-4 border-b border-foreground/30">
    <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</p>
    {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
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
