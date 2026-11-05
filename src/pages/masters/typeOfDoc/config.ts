import type { DocTypeRecord } from "@/api/documentTypeApi";

// ── Sheet styles ──────────────────────────────────────────────────────────────

export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
export const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
export const RULE = "1px solid hsl(var(--foreground))";
export const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
export const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors";
export const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
export const chip = (on: boolean) =>
  `${KEY} h-7 px-2.5 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Canonical module codes.
 * Values must match MODULE_LINKS keys in backend/routes/document-type.js.
 */
export const MODULE_CODE_OPTIONS = [
  { value: "WO", label: "WO — Work Order" },
  { value: "WO_PO", label: "WO_PO — Work Order for Materials" },
  { value: "PO", label: "PO — Purchase Order" },
  { value: "GRN", label: "GRN — Goods Received Note" },
  { value: "BOQ", label: "BOQ — Bill of Quantities" },
  { value: "ExB", label: "ExB — Expense Booking" },
  { value: "MIS", label: "MIS — Material Issue" },
  { value: "PAY", label: "PAY — Payment (Outgoing)" },
  { value: "RECP", label: "RECP — Received Payment" },
  { value: "DN", label: "DN — Debit Note" },
];

/**
 * Links-to toggle options.
 * Values must match the tag strings used in MODULE_LINKS in document-type.js.
 */
export const LINK_OPTIONS = [
  { value: "Work Order", label: "Work Order" },
  { value: "Work Order PO", label: "Work Order for Materials" },
  { value: "Purchase Order", label: "Purchase Order" },
  { value: "GRN", label: "GRN" },
  { value: "BOQ", label: "BOQ" },
  { value: "Expense Booking", label: "Expense Booking" },
  { value: "Material Request", label: "Material Request" },
  { value: "Material Issue", label: "Material Issue" },
  { value: "Payment", label: "Payment (Outgoing)" },
  { value: "Received Payment", label: "Received Payment" },
  { value: "Debit Note", label: "Debit Note" },
  { value: "Task", label: "Task" },
];

// ── Form state ────────────────────────────────────────────────────────────────

export interface FormState {
  Prefix: string;
  Description: string;
  CompanyId: string | number;
  ProjectId: string | number;
  EntryTypeId: string;
  StartingDocNo: string;
  links_to: string[];
  ModuleCode: string;
  DocNoPrefix: string;
  FinYearReset: boolean;
}

export const emptyForm: FormState = {
  Prefix: "",
  Description: "",
  CompanyId: "",
  ProjectId: "",
  EntryTypeId: "",
  StartingDocNo: "1",
  links_to: [],
  ModuleCode: "",
  DocNoPrefix: "",
  FinYearReset: true,
};

// ── Preview builder ───────────────────────────────────────────────────────────

/**
 * Build the live doc-number preview string shown in the drawer.
 *
 * Tier 1 (project-scoped): "GC-WO/0001/26-27"
 *   → requires projectCode + moduleCode
 * Tier 2 (dash):           "WO-2026-00001"
 *   → requires docNoPrefix, no projectCode
 * Tier 3 (legacy slash):   "CI/WO/000001"
 *   → fallback when only Prefix is set
 */
export function buildPreview(form: FormState, projectCode: string | null): string {
  const serial = String(parseInt(form.StartingDocNo) || 1).padStart(4, "0");

  // Tier 1: project-scoped new convention
  if (projectCode && form.ModuleCode) {
    const now = new Date();
    const yr = now.getFullYear();
    const month = now.getMonth() + 1;
    const startYear = month >= 4 ? yr : yr - 1;
    const finYear = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
    return `${projectCode}-${form.ModuleCode}/${serial}/${finYear}`;
  }

  // Tier 2: dash format — DocNoPrefix set, no project scope
  if (form.DocNoPrefix) {
    const paddedSerial = String(parseInt(form.StartingDocNo) || 1).padStart(5, "0");
    return `${form.DocNoPrefix}-${new Date().getFullYear()}-${paddedSerial}`;
  }

  // Tier 3: legacy slash
  if (form.Prefix) {
    const paddedSerial = String(parseInt(form.StartingDocNo) || 1).padStart(6, "0");
    return `${form.Prefix}/${paddedSerial}`;
  }

  return "";
}

/** Return a short label describing which numbering tier will apply. */
export function tierLabel(form: FormState, projectCode: string | null): string {
  if (projectCode && form.ModuleCode) return "New · project-scoped";
  if (form.DocNoPrefix) return "New · global dash format";
  return "Legacy · slash format";
}

/** The prefix that actually appears in a saved type's generated doc numbers. */
export const effectivePrefix = (r: DocTypeRecord) =>
  r.ProjectCode && r.ModuleCode ? `${r.ProjectCode}-${r.ModuleCode}` : r.DocNoPrefix || r.FullPrefix || r.Prefix || "—";

/** A saved type's numbering tier, drawn in ink: project solid, global outlined, legacy dashed. */
export const recordTier = (r: DocTypeRecord) =>
  r.ProjectCode && r.ModuleCode
    ? { short: "New · Project", long: "New · Project-scoped", cls: "bg-foreground text-card border-foreground" }
    : r.DocNoPrefix
      ? { short: "New · Global", long: "New · Global dash format", cls: "text-foreground border-foreground" }
      : { short: "Legacy", long: "Legacy · slash format", cls: "text-muted-foreground border-dashed border-foreground/50" };
