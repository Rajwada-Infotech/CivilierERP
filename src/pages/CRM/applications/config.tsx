// Shared by CRM Applications and its wizard steps: the APIs, the empty forms, the list and master-data fetches,
// status colours and the form styles.
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { statusTone } from "@/components/sheet/Sheet";
import { useSentBackFor, sinceLabel } from "@/components/crm/CrmListToolbar";
import { CheckCircle2, Clock, CornerUpLeft, RotateCcw, XCircle } from "lucide-react";

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

export const inputCls = "w-full h-9 text-sm border border-foreground/40 focus:border-foreground bg-card px-2.5 text-foreground outline-none transition-colors disabled:bg-muted/30 disabled:border-foreground/20 disabled:cursor-not-allowed";
export const labelCls = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1.5";

export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED } from "../customers/config";


// ── Correcting what Data Review flagged ────────────────────────────────────
// Which wizard step holds the data each Data Review checklist item checks
// (crmApplicationChecklist.js CHECKLIST_ITEMS), read from what each step
// saves. Step 2 (Parking) opens as Extra Charges on a plot sale — the wizard
// already maps that.
export const CHECKLIST_ITEM_STEP: Record<string, number> = {
  ProjectUnitRate: 1, PaymentPlanAmounts: 1, BrokerDetails: 1, SourceAssignment: 1,
  ParkingExtraCharges: 2,
  ApplicantKyc: 4,
  Documents: 6,
  BankDepositMode: 7,
};
export const checklistStep = (itemKey: string | null | undefined) => (itemKey && CHECKLIST_ITEM_STEP[itemKey]) || 1;

/** The application's open flags (Data Review items sent back to it). */
export function useCorrections(applicationId: number | null | undefined) {
  const sb = useSentBackFor({ applicationId });
  const rows = sb?.rows || [];
  return {
    flags: rows.filter((r: any) => r.Kind === "review" && r.State === "SentBack"),
    bounce: rows.find((r: any) => r.Kind === "booking" && r.State === "SentBack") || null,
    resent: rows.filter((r: any) => r.State === "Resubmitted"),
  };
}

/**
 * Shown on the wizard while the application has something sent back: what
 * was flagged on THIS step (reason, who, when) with the existing "send for
 * recheck" action beside it, and the flags on other steps as links to them.
 */
export function CorrectionBanner({ applicationId, step, stepLabels, onJump }: {
  applicationId: number | null; step: number; stepLabels: string[]; onJump: (step: number) => void;
}) {
  const qc = useQueryClient();
  const { flags, bounce, resent } = useCorrections(applicationId);
  const [busy, setBusy] = useState<string | null>(null);
  if (applicationId == null || (!flags.length && !bounce && !resent.length)) return null;

  const here = flags.filter((f) => checklistStep(f.ItemKey) === step);
  const elsewhere = flags.filter((f) => checklistStep(f.ItemKey) !== step);
  const resend = async (f: any) => {
    setBusy(f.ItemKey);
    try {
      // The booking's own resubmit action — the same one its Data Review checklist uses.
      const r = await fetchWithAuth(`/api/crm/bookings/${f.BookingId}/checklist/${f.ItemKey}/resubmit`, { method: "PUT" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not send it for recheck");
      toast.success(`${f.Item} sent back to the verifier for a recheck`);
      qc.invalidateQueries({ queryKey: ["crm-sent-back"] });
      window.dispatchEvent(new Event("approval-action"));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setBusy(null);
    }
  };

  if (!flags.length && !bounce) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs border border-foreground/30">
        <RotateCcw size={12} /> {resent.length} correction{resent.length === 1 ? "" : "s"} sent for recheck — waiting for the verifier.
      </div>
    );
  }
  return (
    <div className="bg-card text-sm border border-destructive/50" style={{ borderLeft: "3px solid hsl(var(--destructive))" }}>
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-destructive">
          <CornerUpLeft size={12} /> Sent back for correction
        </span>
        <span className="text-xs text-muted-foreground">
          {flags.length ? `${flags.length} item${flags.length === 1 ? "" : "s"} flagged in Data Review` : "Booking approval"}
          {" — fix it here, then send it for recheck."}
        </span>
      </div>

      {bounce && (
        <div className="px-4 pb-2 text-xs">
          <span className="font-semibold">Booking approval</span> · “{bounce.Reason || "no reason given"}”
          <span className="text-muted-foreground"> — {bounce.ByName || "—"}, {sinceLabel(bounce.At)}. Correct the application, then Submit Edits.</span>
        </div>
      )}

      {here.length > 0 && (
        <div className="border-t border-destructive/20">
          {here.map((f) => (
            <div key={f.ItemKey} className="px-4 py-2.5 flex flex-wrap items-start justify-between gap-3 border-b border-destructive/10 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="font-medium leading-snug">{f.Item}</div>
                <div className="text-xs mt-0.5">“{f.Reason || "no reason given"}” <span className="text-muted-foreground">— {f.ByName || "—"}, {sinceLabel(f.At)}</span></div>
              </div>
              <button type="button" onClick={() => resend(f)} disabled={busy === f.ItemKey}
                className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 border border-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] hover:bg-foreground hover:text-card transition-colors disabled:opacity-40">
                <CheckCircle2 size={11} /> {busy === f.ItemKey ? "Sending…" : "Corrected — send for recheck"}
              </button>
            </div>
          ))}
        </div>
      )}

      {elsewhere.length > 0 && (
        <div className="px-4 py-2 border-t border-destructive/20 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{here.length ? "Also flagged:" : "Flagged on:"}</span>
          {elsewhere.map((f) => (
            <button key={f.ItemKey} type="button" onClick={() => onJump(checklistStep(f.ItemKey))}
              className="inline-flex items-center gap-1 px-2 h-6 border border-destructive/40 text-destructive hover:bg-destructive/5">
              {stepLabels[checklistStep(f.ItemKey) - 1] || `Step ${checklistStep(f.ItemKey)}`} — {f.Item.split(/[(,]/)[0].trim()} ›
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
