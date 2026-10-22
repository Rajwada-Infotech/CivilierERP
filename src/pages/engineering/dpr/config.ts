// Types and formatters shared by the Daily Progress Report and its parts.

export interface BOQRow {
  BoqID: number;
  DocNo: string;
  BoqNo: string;
  BoqDate: string | null;
  CompanyName: string;
  ProjectName: string;
  Description: string;
  TotalAmount: number;
  Status: string;
  Remarks: string | null;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
  DocTypeDescription: string | null;
}

export interface WOActivity {
  Id: number;
  WorkOrderHeaderId: number;
  ActivityGroupName: string | null;
  ActivityName: string | null;
  UOMName: string | null;
  Quantity: number | null;
  Rate: number | null;
  Amount: number | null;
  Remarks: string | null;
}

export interface WorkOrderRow {
  Id: number;
  DocNo: string;
  DocumentNumber: string;
  DocumentDate: string | null;
  TotalAmount: number;
  Status: string;
  CompanyName: string;
  ProjectName: string;
  ContractorName: string | null;
  SupplierName: string | null;
  Remarks: string | null;
  BoqDocNo: string | null;
  ActivityCount: number;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
  DocTypeDescription: string | null;
  activities: WOActivity[];
}

export interface WorkDoneRow {
  ID: number;
  DocNo: string;
  DocDate: string | null;
  CompanyName: string;
  ProjectName: string;
  SupplierName: string | null;
  ContractorName: string | null;
  WorkOrderNo: string | null;
  PeriodFrom: string | null;
  PeriodTo: string | null;
  DescriptionOfWork: string;
  QuantityDone: number | null;
  Unit: string | null;
  RatePerUnit: number | null;
  GrossAmount: number | null;
  Deductions: number | null;
  CertifiedAmount: number;
  Status: string;
  Remarks: string | null;
  CreatedBy: string;
  CreatedAt: string;
  DocTypePrefix: string | null;
}

/** Totals leave rejected / cancelled documents out (the server does the same). */
export interface DPRSummary {
  boqCount: number;
  boqTotal: number;
  woCount: number;
  woTotal: number;
  wdCount: number;
  wdTotal: number;
}

export interface DPRResponse {
  date: string;
  summary: DPRSummary;
  boq: BOQRow[];
  workOrders: WorkOrderRow[];
  workDone: WorkDoneRow[];
}

export const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n ?? 0);

export const fmtNum = (n: number | null | undefined) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n ?? 0);

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—";

export const fmtDateTime = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : "—";

/** Today in India — toISOString() would give yesterday's date before 5:30 in the morning. */
export const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const counted = (status: string) => !["Rejected", "Cancelled", "Deleted"].includes(status);

export const RULE = "1px solid hsl(var(--foreground))";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
