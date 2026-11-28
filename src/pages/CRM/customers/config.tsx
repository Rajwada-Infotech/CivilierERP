// Shared by CRM Customers and its parts: the API, the empty form, the checks both forms run, the list fetch, the
// leads pool, and the sheet styles.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { GRID_SHEET_KEYS } from "@/components/crm/CrmDataTable";
import { isValidPhone, PHONE_HINT } from "@/lib/phone";

export const API = "/api/crm/customers";

export const EMPTY_FORM = {
  LeadId: "", CustomerName: "", Mobile: "", AltMobile: "", Email: "",
  PanNo: "", GstNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "", DateOfBirth: "",
  PermanentAddress: "", PermanentCity: "", PermanentState: "", PermanentPincode: "",
  IsCurrentSameAsPermanent: true,
  CurrentAddress: "", CurrentCity: "", CurrentState: "", CurrentPincode: "",
  CoApplicantName: "", CoApplicantMobile: "", CoApplicantPanNo: "", CoApplicantRelation: "",
  InvoiceMode: "NonInvoice" as "Invoice" | "NonInvoice",
  Notes: "",
};
export type CustomerForm = typeof EMPTY_FORM;

/** The fields both the new and the edit form show, in order. */
export const IDENTITY_FIELDS: { key: keyof CustomerForm; label: string; type: string; required?: boolean }[] = [
  { key: "CustomerName", label: "Customer name", type: "text", required: true },
  { key: "Mobile", label: "Mobile", type: "text" },
  { key: "AltMobile", label: "Alternate mobile", type: "text" },
  { key: "Email", label: "Email", type: "email" },
  { key: "PanNo", label: "PAN", type: "text" },
  { key: "GstNo", label: "GSTIN (if GST-registered)", type: "text" },
  { key: "AadhaarNo", label: "Aadhaar number", type: "text" },
  { key: "DateOfBirth", label: "Date of birth", type: "date" },
  { key: "Occupation", label: "Occupation", type: "text" },
  { key: "AnnualIncome", label: "Annual income", type: "number" },
];

/** The checks both forms run before saving; the first problem found, or null. The server checks again. */
export function checkCustomer(f: Partial<CustomerForm>): string | null {
  const s = (v: unknown) => String(v ?? "").trim();
  if (!s(f.CustomerName)) return "Enter the customer's name.";
  if (!isValidPhone(s(f.Mobile))) return `Mobile must be ${PHONE_HINT}.`;
  if (!isValidPhone(s(f.AltMobile))) return `Alternate mobile must be ${PHONE_HINT}.`;
  if (s(f.PanNo) && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s(f.PanNo).toUpperCase())) return "PAN must look like ABCDE1234F.";
  if (s(f.GstNo) && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/.test(s(f.GstNo).replace(/\s+/g, "").toUpperCase())) return "GSTIN must be 15 characters, like 27AAPFU0939F1ZV.";
  if (s(f.AadhaarNo) && !/^\d{12}$/.test(s(f.AadhaarNo))) return "Aadhaar must be exactly 12 digits.";
  if (s(f.Email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(f.Email))) return "Enter a valid email address.";
  if (s(f.PermanentPincode) && !/^\d{6}$/.test(s(f.PermanentPincode))) return "Pincode must be exactly 6 digits.";
  if (!f.IsCurrentSameAsPermanent && s(f.CurrentPincode) && !/^\d{6}$/.test(s(f.CurrentPincode))) return "Current pincode must be exactly 6 digits.";
  return null;
}

export const PAGE_SIZE = 25;
export type CustomerView = "all" | "withApps" | "missingKyc" | "invoice" | "noApps";
export interface CustomerListFilters {
  search: string;
  companyId: string;
  projectId: string;
  blockId: string;
  view?: CustomerView;
  invoiceMode?: string;
  focus?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
}
export interface CustomerCounts {
  all: number;
  withApps: number;
  noApps: number;
  missingKyc: number;
  invoice: number;
  nonInvoice: number;
  missingPan: number;
  missingEmail: number;
  missingAddress: number;
}

export async function fetchCustomersList(filters: CustomerListFilters, page: number, pageSize: number = PAGE_SIZE): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  if (filters.view && filters.view !== "all") params.set("view", filters.view);
  if (filters.invoiceMode && filters.invoiceMode !== "All") params.set("invoiceMode", filters.invoiceMode);
  if (filters.focus) params.set("focus", filters.focus);
  if (filters.sortKey) { params.set("sortKey", filters.sortKey); params.set("sortDir", filters.sortDir || "desc"); }
  const res = await fetchWithAuth(`${API}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not load the customers (${res.status}).`);
  return { rows: data.rows || [], total: data.total || 0 };
}

export async function fetchCustomerCounts(filters: Pick<CustomerListFilters, "search" | "companyId" | "projectId" | "blockId">): Promise<CustomerCounts> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const res = await fetchWithAuth(`${API}/counts?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not load customer counts (${res.status}).`);
  return data;
}

export interface PoolLead {
  Id: number; LeadUid: string; CustomerName: string; Mobile: string | null; AltMobile: string | null; Email: string | null;
  CustomerId: number | null;
}
/** Converted leads with the active customer made from each (CRM Leads' route). Only leads with no customer can be
 *  linked: the same rule the server refuses on. It used to read Sales Automation's list (its own right) and judge
 *  "used" from the 20 customers on the page in view. */
export async function fetchLeadPool(): Promise<PoolLead[]> {
  const res = await fetchWithAuth("/api/crm/leads");
  if (!res.ok) return [];
  const body = await res.json().catch(() => []);
  return Array.isArray(body) ? body : [];
}

// ── Sheet styles ──
export const RULE = "1px solid hsl(var(--foreground))";
export const RULE_SOFT = "1px solid hsl(var(--foreground) / 0.15)";
export const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
export const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
export const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
export const KEY_RED = `${KEY} bg-destructive text-white border border-destructive`;
export const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition-colors read-only:bg-muted/30 read-only:border-foreground/20 read-only:cursor-default";
export const TEXTAREA = "w-full border border-foreground/40 focus:border-foreground bg-card px-2.5 py-2 text-sm text-foreground outline-none resize-none read-only:bg-muted/30 read-only:border-foreground/20";

export const Field: React.FC<{ label: string; required?: boolean; className?: string; children: React.ReactNode }> = ({ label, required, className, children }) => (
  <label className={`block space-y-1 min-w-0 ${className ?? ""}`}>
    <span className={`block ${LBL}`}>{label}{required && <span className="text-destructive"> *</span>}</span>
    {children}
  </label>
);

export const Block: React.FC<{ title: string; note?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, note, className, children }) => (
  <section className={`bg-card ${className ?? ""}`} style={{ border: RULE }}>
    <div className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</span>
      {note && <span className="text-[0.6875rem] text-muted-foreground">{note}</span>}
    </div>
    <div className="p-4 space-y-3">{children}</div>
  </section>
);

// ── Enterprise Grid / Card styles for /crm/customers UI/UX ──
// Kept separate from legacy sheet tokens above so existing consumers of customers/config are untouched.
export const {
  KEY_INK: CUST_KEY_INK,
  KEY_LINE: CUST_KEY_LINE,
  KEY_RED: CUST_KEY_RED,
  LBL: CUST_LBL,
  INP: CUST_INP,
  TEXTAREA: CUST_TEXTAREA,
} = GRID_SHEET_KEYS;

export const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
export const TONE_AMBER_PILL = "bg-amber-500/15 border-amber-500/30 text-amber-300 [[data-theme]_&]:bg-amber-500/10 [[data-theme]_&]:border-amber-500/30 [[data-theme]_&]:text-amber-700";
export const TONE_ROSE_PILL = "border-rose-500/40 bg-rose-500/15 text-rose-300 [[data-theme]_&]:bg-rose-500/10 [[data-theme]_&]:border-rose-500/35 [[data-theme]_&]:text-rose-700";

export const CUST_CARD_SHELL = "rounded-xl border border-border bg-card overflow-hidden shadow-[0_1px_2px_0_hsl(var(--foreground)/0.04)]";
export const CUST_CARD_HEAD = "flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border bg-muted/30";

export const CustField: React.FC<{ label: string; required?: boolean; className?: string; children: React.ReactNode }> = ({ label, required, className, children }) => (
  <label className={`block space-y-1 min-w-0 ${className ?? ""}`}>
    <span className="block text-xs font-medium text-muted-foreground">
      {label}
      {required && <span className="text-destructive"> *</span>}
    </span>
    {children}
  </label>
);

export const CustBlock: React.FC<{ title: string; icon?: React.ReactNode; note?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, icon, note, className, children }) => (
  <section className={`${CUST_CARD_SHELL} ${className ?? ""}`}>
    <div className={CUST_CARD_HEAD}>
      <span className="text-sm font-semibold text-foreground inline-flex items-center gap-1.5">
        {icon}
        {title}
      </span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
    <div className="p-4 space-y-3">{children}</div>
  </section>
);
