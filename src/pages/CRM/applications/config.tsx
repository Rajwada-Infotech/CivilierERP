// Shared by CRM Applications and its wizard steps: the APIs, the empty forms, the list and master-data fetches,
// status colours and the form styles.
import { CrmStatus } from "@/constants/crmStatuses";
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { statusTone } from "@/components/sheet/Sheet";
import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const API = "/api/crm/applications";
export const CUSTOMER_API = "/api/crm/customers";
export const COMPANY_API = "/api/business/dropdown";
export const CRM_LEADS_API = "/api/crm/leads";
export const UNIT_API = "/api/unit-master";
export const BANK_DETAIL_API = "/api/crm/customer-bank-details";
export const DOC_API = "/api/crm/booking-documents";
export const PARKING_API = "/api/crm/parking";
export const EXTRA_CHARGE_API = "/api/crm/extra-charges";
export const CO_APPLICANT_API = "/api/crm/co-applicants";
export const PROJECT_BANK_API = "/api/crm/project-banks";
export const BANK_MASTER_API = "/api/bank-master";
export const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];

export const STATUSES = ["Draft", "Pending", "Approved", "Rejected", "Cancelled", "Expired"];
export const DOC_TYPES = ["IdentityProof", "AddressProof", "PhotoID", "IncomeProof", "Other"];
// Applications no longer have their own verification checklist or approval
// cycle at all — that logic merged into the Booking's own "Review" workflow
// stage (see CrmBookingDetail.tsx / crmBookingStageService.js).

// "Booked" is not a real DB status: an application stays Pending once a live booking exists (Stage "Converted"),
// and showing "Pending" there misled staff into thinking it still needed action. Expired has stopped like a
// rejection. Booking statuses read the same way.
export const appTone = (status: string): "done" | "waiting" | "stopped" =>
  status === "Booked" ? "done" : status === "Expired" ? "stopped" : statusTone(status);

export const EMPTY_FORM = {
  CustomerId: "", CompanyId: "",
  ProjectId: "", BlockId: "", FloorNo: "", PreferredUnitIds: [] as string[], PreferredPlotIds: [] as string[], PaymentPlanId: "",
  RatePerSqFt: "", DateOfApply: new Date().toISOString().slice(0, 10),
  Source: "", PlatformId: "", CampaignId: "", AdId: "", ChannelPartnerId: "",
  // ViaBroker is UI-only (never sent to the backend) — it just toggles the
  // broker sub-block; BrokerId being set is what actually matters server-side.
  ViaBroker: false, BrokerId: "", BrokerageRatePercent: "", BrokeragePaymentPlan: "OneTime",
  Notes: "",
  // Payment Details (Step 6/Details) — these columns already existed on
  // CrmApplication and were already read by handleCreateBooking's retry
  // payload, but nothing in the wizard ever captured them until now.
  TokenType: "Percentage", TokenValue: "", PaymentMode: "", DepositBankId: "",
  // Payment instrument reference — only meaningful once PaymentMode is
  // anything other than Cash (see the Payment Details block's dynamic
  // fields). Stored on CrmCustomerBankDetail, not CrmApplication itself.
  ChequeNo: "", ChequeDate: "", TransactionRef: "",
};

export const EMPTY_BANK = {
  BankName: "", BranchName: "", AccountNo: "", IfscCode: "", AccountHolderName: "",
  PanNo: "", AadhaarNo: "", Occupation: "", AnnualIncome: "",
};

// Which real company bank account the token payment lands in — scoped to
// the selected Project (falls back to the open bank list if the project has
// none tagged), same "Deposited To" pattern CrmBooking.tsx, CrmBookingDetail.tsx
// and CrmPaymentMilestones.tsx all already use for this exact decision.
export async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (projectId == null) return [];
  try { const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchAllBanks(): Promise<any[]> {
  try { const r = await fetchWithAuth(BANK_MASTER_API); return r.ok ? r.json() : []; } catch { return []; }
}

export const PAGE_SIZE = 20;

export interface ApplicationListFilters {
  search: string; status: string; displayStage: string;
  companyId: string; projectId: string; blockId: string;
}

// The management page's own paginated list — server-side filtered on
// exactly the same terms the page's UI exposes (search/status/stage/
// Company/Project/Block), unlike every other page's application-selector
// dropdown (New Booking, Unit/Parking Matrix, Communication Log), which
// still calls GET / with no ?page= at all and keeps getting the original
// bare-array/Converted-excluded-by-default behavior untouched.
export async function fetchApplicationsList(filters: ApplicationListFilters, page: number, pageSize: number = PAGE_SIZE): Promise<{ rows: any[]; total: number }> {
  const q = new URLSearchParams();
  q.set("page", String(page));
  q.set("pageSize", String(pageSize));
  if (filters.search) q.set("search", filters.search);
  if (filters.status && filters.status !== "All") q.set("status", filters.status);
  if (filters.displayStage) q.set("displayStage", filters.displayStage);
  if (filters.companyId) q.set("companyId", filters.companyId);
  if (filters.projectId) q.set("projectId", filters.projectId);
  if (filters.blockId) q.set("blockId", filters.blockId);
  // Throws, so a failed load shows as one instead of an empty list.
  const res = await fetchWithAuth(`${API}?${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not load the applications (${res.status}).`);
  return { rows: data.rows || [], total: data.total || 0 };
}

// Same filter set as the list above, minus stage itself — for the tab
// badges, which must reflect the true total under the current
// search/status/Company/Project/Block filters regardless of which page or
// stage is currently selected (a page's own row count stopped being usable
// as "the total" the moment the list became paginated).
export async function fetchStageCounts(filters: Omit<ApplicationListFilters, "displayStage">): Promise<Record<Stage, number>> {
  const q = new URLSearchParams();
  if (filters.search) q.set("search", filters.search);
  if (filters.status && filters.status !== "All") q.set("status", filters.status);
  if (filters.companyId) q.set("companyId", filters.companyId);
  if (filters.projectId) q.set("projectId", filters.projectId);
  if (filters.blockId) q.set("blockId", filters.blockId);
  try {
    const res = await fetchWithAuth(`${API}/stage-counts?${q}`);
    if (!res.ok) return { InProcess: 0, Converted: 0, NotConverted: 0 };
    return res.json();
  } catch { return { InProcess: 0, Converted: 0, NotConverted: 0 }; }
}
export async function fetchAppDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  return r.ok ? r.json() : null;
}

export const STAGES = ["InProcess", "Converted", "NotConverted"] as const;
export type Stage = typeof STAGES[number];
export const stageLabel: Record<Stage, string> = { InProcess: "In Process", Converted: "Converted", NotConverted: "Not Converted" };
export const stageIcon: Record<Stage, any> = { InProcess: Clock, Converted: CheckCircle2, NotConverted: XCircle };
export const normalizeRole = (role?: string) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
export async function fetchCustomers(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(CUSTOMER_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
// Used only to auto-fetch a selected customer's original lead interest/
// source-chain data (property type, source chain) onto this application —
// Lead selection itself now happens once, on the Customer record
// (CrmCustomers.tsx's "From a converted lead" picker on New Customer). Reads CRM's own leads route: Sales
// Automation's list needs that module's right, without which nothing carried over.
export async function fetchLeadOptions(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(CRM_LEADS_API);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
export async function fetchCompanies(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(COMPANY_API);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.companies || []).map((c: any) => ({ Id: c.id, Name: c.name }));
  } catch { return []; }
}
export async function fetchProjects(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}/projects`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchPlots(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/plot-master?available=1"); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchBrokers(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/account-head?type=BR"); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/crm/payment-plans"); return r.ok ? r.json() : []; } catch { return []; }
}
// Blocks' own tagged PaymentPlanIds — the middle tier of the Project ->
// Block -> Unit cascade (see crmEntityCreation.js's getApplicablePaymentPlans).
export async function fetchBlockPlanTags(): Promise<any[]> {
  try { const r = await fetchWithAuth("/api/block-master"); return r.ok ? r.json() : []; } catch { return []; }
}

// Admin-editable commission tiers (dbo.CrmBrokerageRateTier, see
// crmBrokerageRateTiers.js / CrmBrokerageRateTiers.tsx) — this is only a
// staff-facing preview of the same fallback rate the server itself applies
// (tierBrokeragePercent in crmWorkflowGuards.js) when no explicit override
// is typed; it's never used to compute what actually gets saved.
export type RateTier = { MinDealValue: number; MaxDealValue: number | null; RatePercent: number; IsActive: boolean };
export async function fetchBrokerageRateTiers(): Promise<RateTier[]> {
  try { const r = await fetchWithAuth("/api/crm/brokerage-rate-tiers"); return r.ok ? r.json() : []; } catch { return []; }
}

// Same shape CrmPaymentPlans.tsx already parses off the list endpoint's
// MilestonesJson column — reused here so the brief plan-preview card below
// can compute real ₹ figures instead of just repeating raw %s.
export type MilestoneRow = { name: string; pct: number };
export function parseMilestones(json: string | null | undefined): MilestoneRow[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json);
    return (raw as any[]).map((r) => ({ name: r.name, pct: Number(r.pct) || 0 }));
  } catch { return []; }
}

export const inputCls = "w-full h-9 text-sm border border-foreground/40 focus:border-foreground bg-card px-2.5 text-foreground outline-none transition-colors disabled:bg-muted/30 disabled:border-foreground/20 disabled:cursor-not-allowed";
export const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5";

export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED } from "../customers/config";
