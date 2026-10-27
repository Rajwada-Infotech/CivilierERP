// Shared by CRM Bookings and its parts: the APIs, the New Booking form, the list and master-data fetches, the
// "next step" a booking is waiting on, and the sheet styles.
import { CrmStatus, bookingWorkflowStageLabel } from "@/constants/crmStatuses";
import { statusTone } from "@/components/sheet/Sheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const API = "/api/crm/bookings";
export const APP_API = "/api/crm/applications";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";
const PLOT_API = "/api/plot-master";
const PLAN_API = "/api/crm/payment-plans";

export const STATUSES = ["Pending", "Approved", "Rejected", "Cancelled", "Transferred"];
export const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];
export const TOKEN_TYPES = ["Percentage", "Amount"];

export const workflowStageLabel = bookingWorkflowStageLabel;

// Transferred (closed by a resale: the sale stands, the land / villa has a new owner) counts as settled.
export const bookingTone = (status: string): "done" | "waiting" | "stopped" =>
  status === "Transferred" ? "done" : statusTone(status);

// Manual/direct Booking creation: the fallback when an Application was approved without a booking being made
// (e.g. no unit preselected). Still requires picking a real Application.
export const EMPTY_FORM = {
  ApplicationId: "", UnitIds: [] as string[], PlotIds: [] as string[], ProjectName: "", UnitNo: "", BlockName: "",
  UnitType: "", AreaSqFt: "", RatePerSqFt: "", TotalValue: "",
  TokenType: "Percentage", TokenValue: "", PaymentPlanId: "",
  BookingDate: "", PaymentMode: "", AssignedTo: "", Notes: "",
  BookingAmount: "", BrokerId: "", BrokerageRatePercent: "", BrokeragePaymentPlan: "OneTime",
  BrokerageSplitEnabled: false,
};
export type BookingForm = typeof EMPTY_FORM;

export async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchPlots(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${PLOT_API}?available=1`); return r.ok ? r.json() : []; } catch { return []; }
}
// Needed to resolve a tagged plan's fixed Booking Amount: it is decided when the plan is made, not typed per booking.
export async function fetchPaymentPlans(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${PLAN_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}
// One Application -> at most one Booking. Only applications both Approved and not yet converted (the server's
// ?forBooking=1 filter).
export async function fetchApps(): Promise<any[]> {
  try {
    const res = await fetchWithAuth(`${APP_API}?forBooking=1`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
// Sales users for "Assigned To" (Sales Automation's list, readable with the Bookings right too).
export async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!res.ok) return [];
    const d: any[] = await res.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

// The booking(s) for one application (?applicationId= deep link), cancelled ones included.
export async function fetchBookings(applicationId: string): Promise<any[]> {
  const params = new URLSearchParams({ includeCancelled: "1", applicationId });
  const res = await fetchWithAuth(`${API}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not load the booking (${res.status}).`);
  return Array.isArray(data) ? data : [];
}

export const PAGE_SIZE = 20;
export interface BookingListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }
export interface BookingList { rows: any[]; total: number; statusCounts: Record<string, number>; frozen: number }

// Throws, so a failed load shows as one instead of an empty list. statusCounts covers every status under the other
// filters (the figures).
export async function fetchBookingsList(filters: BookingListFilters, page: number, pageSize: number = PAGE_SIZE): Promise<BookingList> {
  const params = new URLSearchParams({ includeCancelled: "1", page: String(page), pageSize: String(pageSize) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status !== "All") params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  const res = await fetchWithAuth(`${API}?${params}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Could not load the bookings (${res.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {}, frozen: data.frozen || 0 };
}

export const fmt = (n: number | null | undefined) => (n != null ? `₹${(n / 1e5).toFixed(2)}L` : "—");
export const normalizeRole = (role?: string) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

// The real workflow gate: Welcome Call -> Booking Amount paid -> Agreement (both approvals, date, date approval) ->
// Payments -> Registration -> NOC -> Handover -> Sale Deed -> Registry -> Mutation. Only the ONE step the booking is
// sitting at is surfaced, never a later one. Bank / KYC details are not a gate (business decision 2026-09-15,
// crmWorkflowGuards.js validateAgreementPreparationPrerequisites).
export type NextStep = { label: string; path: string } | null;
export function getNextStep(b: any): NextStep {
  if (b.Status !== CrmStatus.APPROVED) return null;
  // HasWelcomeCall means Outcome = 'Welcomed' (crmBookings.js BOOKING_SELECT).
  if (!b.HasWelcomeCall) return { label: "Welcome call", path: `/crm/welcome-calls?bookingId=${b.Id}` };
  // Milestone 1 (Booking Amount) must be paid before Agreement prep can succeed.
  if (!b.AgreementId && b.Milestone1Status !== CrmStatus.PAID && !b.Milestone1VirtuallyCovered) {
    return { label: "Payments", path: `/crm/payments?bookingId=${b.Id}` };
  }
  if (!b.AgreementId || b.SeniorApprovalStatus !== CrmStatus.APPROVED || b.CustomerApprovalStatus !== CrmStatus.APPROVED) {
    return { label: "Agreement", path: `/crm/agreements?bookingId=${b.Id}` };
  }
  if (!b.AgreementDate) return { label: "Agreement date", path: `/crm/agreements?bookingId=${b.Id}` };
  if (b.DateApprovalStatus !== CrmStatus.APPROVED) return { label: "Date approval", path: `/crm/agreements?bookingId=${b.Id}` };
  if (b.PendingMilestoneCount > 0) return { label: "Payments", path: `/crm/payments?bookingId=${b.Id}` };
  // Post-agreement lifecycle, in GET /:id/lifecycle's own order.
  if (!b.AgreementRegistered) return { label: "Agreement registration", path: `/crm/agreements?bookingId=${b.Id}` };
  if (!b.NocIssued) return { label: "NOC", path: `/crm/noc?bookingId=${b.Id}` };
  if (!b.HandoverDone) return { label: "Handover", path: `/crm/handover` };
  if (!b.SalesDeedDone) return { label: "Sale deed", path: `/crm/sales-deed?bookingId=${b.Id}` };
  if (!b.RegistryDone) return { label: "Registry", path: `/crm/sales-deed?bookingId=${b.Id}&tab=Registry` };
  if (!b.MutationDone) return { label: "Mutation", path: `/crm/mutation?bookingId=${b.Id}` };
  return null;
}

// ── Sheet styles ──
export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED } from "../customers/config";
export const inputCls = "w-full h-9 text-sm border border-foreground/40 focus:border-foreground bg-card px-2.5 text-foreground outline-none transition-colors";
export const inputClsDisabled = "w-full h-9 text-sm border border-foreground/20 bg-muted/30 px-2.5 text-muted-foreground cursor-not-allowed";
export const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5";
