// Types, formatters, form conversions and the sheet styles shared by the Work Done page and its parts.
import React from "react";

export interface WorkDoneEntry {
  ID: number;
  DocNo: string;
  DocTypeId: number | null;
  DocDate: string;
  CompanyId: number | null;
  CompanyName: string;
  ProjectId: number | null;
  ProjectName: string;
  FinYear: string;
  SupplierId: number | null;
  SupplierName: string;
  WorkOrderID: number;
  WorkOrderNo: string;
  ContractorName: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: number;
  Unit: string;
  RatePerUnit: number;
  GrossAmount: number;
  Deductions: number;
  CertifiedAmount: number;
  Status: string;
  Remarks: string;
  CreatedAt: string;
  CreatedBy: string;
}

export interface DropdownOption {
  id: number;
  name: string;
  company_id?: number | null;
}

/** An approved work order Work Done can be recorded against. */
export interface WorkOrderOption {
  id: number;
  name: string;
  companyId: number | null;
  projectId: number | null;
}

/** One line of a work order, from /api/work-orders/:id/activities. */
export interface WoActivity {
  Id: number;
  ActivityGroupName: string | null;
  ActivityName: string | null;
  UOMName: string | null;
  Rate: number | null;
  Area: number | null;
  LabourAmount: number | null;
  MaterialAmount: number | null;
  GrandTotal: number | null;
  Remarks: string | null;
}

export interface WoSummary {
  ContractValue: number;
  totalCertified: number;
  totalBooked: number;
  totalPaid: number;
}

export interface FormState {
  companyId: string;
  projectId: string;
  finYear: string;
  docTypeId: number | null;
  docNo: string;
  docDate: string;
  supplierId: string;
  workOrderId: string;
  remarks: string;
  PeriodFrom: string;
  PeriodTo: string;
  DescriptionOfWork: string;
  QuantityDone: string;
  Unit: string;
  RatePerUnit: string;
  Deductions: string;
  Status: string;
}

export const EMPTY_FORM = (activeFinYear?: string): FormState => ({
  companyId: "",
  projectId: "",
  finYear: activeFinYear ?? "",
  docTypeId: null,
  docNo: "",
  docDate: new Date().toISOString().slice(0, 10),
  supplierId: "",
  workOrderId: "",
  remarks: "",
  PeriodFrom: "",
  PeriodTo: "",
  DescriptionOfWork: "",
  QuantityDone: "",
  Unit: "",
  RatePerUnit: "",
  Deductions: "0",
  Status: "Draft",
});

export const recordToForm = (r: WorkDoneEntry, activeFinYear: string): FormState => ({
  companyId: String(r.CompanyId ?? ""),
  projectId: String(r.ProjectId ?? ""),
  finYear: r.FinYear ?? activeFinYear,
  docTypeId: r.DocTypeId ?? null,
  docNo: r.DocNo ?? "",
  docDate: r.DocDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  supplierId: String(r.SupplierId ?? ""),
  workOrderId: String(r.WorkOrderID ?? ""),
  remarks: r.Remarks ?? "",
  PeriodFrom: r.PeriodFrom?.slice(0, 10) ?? "",
  PeriodTo: r.PeriodTo?.slice(0, 10) ?? "",
  DescriptionOfWork: r.DescriptionOfWork ?? "",
  QuantityDone: String(r.QuantityDone ?? ""),
  Unit: r.Unit ?? "",
  RatePerUnit: String(r.RatePerUnit ?? ""),
  Deductions: String(r.Deductions ?? "0"),
  Status: r.Status ?? "Draft",
});

/** Pending entries are with the approvers; everything else can be changed (an approved one goes back for approval). */
export const canEditWorkDone = (status?: string | null) => status !== "Pending";

export const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

// ── Sheet styles ──
export const RULE = "1px solid hsl(var(--foreground))";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const CHIP = (on: boolean) =>
  `font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] h-8 px-3 border transition-colors ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;
export const INP = "w-full h-10 border border-foreground/40 focus:border-foreground bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const TEXTAREA = "w-full border border-foreground/40 focus:border-foreground bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-none transition-colors";

export const Field: React.FC<{ label: string; required?: boolean; error?: boolean; note?: string; children: React.ReactNode }> = ({ label, required, error, note, children }) => (
  <div className="space-y-1.5">
    <label className={`block ${LBL}`}>
      {label} {required && <span className="text-destructive">*</span>}
    </label>
    {children}
    {error ? <p className="text-[0.6875rem] text-destructive">Required</p> : note ? <p className="text-[0.6875rem] text-muted-foreground">{note}</p> : null}
  </div>
);

/** A titled block of the form or the detail view. */
export const Block: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <div className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</span>
      {note && <span className="text-[0.6875rem] text-muted-foreground">{note}</span>}
    </div>
    <div className="p-5 space-y-5">{children}</div>
  </div>
);
