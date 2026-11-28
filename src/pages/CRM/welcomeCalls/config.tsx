// Shared by Welcome Calls and its parts: the APIs, call outcomes, the call form, the queue / history / checklist fetches
// and small formatters.
import { CrmStatus } from "@/constants/crmStatuses";
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { GRID_SHEET_KEYS } from "@/components/crm/CrmDataTable";
import { FileCheck, FileImage, File as FileIcon, FileSpreadsheet } from "lucide-react";

export const API = "/api/crm/welcome-calls";
export const CO_API = "/api/crm/co-applicants";
export const DOC_API = "/api/crm/booking-documents";
export const BKG_API = "/api/crm/bookings";
export const SA_LEADS_API = "/api/sa/leads";
export const PARKING_API = "/api/crm/parking";
export const EXTRA_CHARGE_API = "/api/crm/extra-charges";
export const VC_API = "/api/crm/welcome-checklist"; // per-item verification checklist: checkbox + remarks + recheck + submit


export const OUTCOMES = ["Welcomed", "NotReachable", "RequestedCallback", "VoiceMail", "Busy", "SwitchedOff"];
// Welcomed is done; a callback, voicemail or busy line is still in hand; not reachable or switched off has stopped.
export const outcomeTone = (o: string): "done" | "waiting" | "stopped" =>
  o === "Welcomed" ? "done" : o === "NotReachable" || o === "SwitchedOff" ? "stopped" : "waiting";
export const OUTCOME_LABEL: Record<string, string> = {
  Welcomed: "Welcomed", NotReachable: "Not reachable", RequestedCallback: "Callback asked", VoiceMail: "Voicemail", Busy: "Busy", SwitchedOff: "Switched off",
};
export const VC_ITEM_SHORT_LABEL: Record<string, string> = {
  project_name: "Project name",
  unit_no: "Unit / Plot details",
  booking_date: "Booking date",
  total_value: "Total booking value",
  plan_structure: "Payment plan & schedule",
  outstanding_balance: "Outstanding balance",
  applicant_name: "Applicant name",
  mobile_number: "Mobile number",
  email: "Email address",
  address: "Communication address",
  documents_uploaded: "Documents uploaded",
  documents_verified: "Documents verified",
  co_applicant_details: "Co-applicant details",
  parking_selection: "Parking allotment",
  extra_charges: "Extra charges",
};

export const BOARD_TABS = ["queue", "checklist", "recheck", "verified"] as const;
export type BoardTab = typeof BOARD_TABS[number];
export const WELCOME_VIEWS = ["queue", "checklist", "recheck", "verified", "history"] as const;
export type WelcomeView = typeof WELCOME_VIEWS[number];

export interface BoardRow {
  BookingId: number;
  BookingNo: string;
  ApplicationId: number;
  ApplicationNo: string | null;
  BookingDate: string | null;
  GrandTotal: number | null;
  TotalValue: number | null;
  FinancingType: string | null;
  AssignedTo: number | null;
  AssignedToName: string | null;
  ApplicantName: string;
  Mobile: string | null;
  Email: string | null;
  UnitNo: string | null;
  ProjectName: string | null;
  BlockName: string | null;
  IsPlotSale: boolean;
  LastCallId: number | null;
  LastOutcome: string | null;
  LastCallDate: string | null;
  NextCallDate: string | null;
  LastCalledBy: number | null;
  LastCalledByName: string | null;
  AttemptCount: number;
  ConsecutiveNonReached: number;
  HasWelcomedCall: boolean;
  PaymentPlanConfirmed: boolean | null;
  PaymentPlanDisputeReason: string | null;
  PreferredAgreementDate: string | null;
  ChecklistTotal: number;
  CheckedCount: number;
  OpenRecheckCount: number;
  OldestFlaggedAt: string | null;
  IsLocked: boolean;
  SubmittedAt: string | null;
  SubmittedByName: string | null;
  FlaggedItemKey: string | null;
  FlaggedReason: string | null;
  RequestedByName: string | null;
  DocsTotal: number | null;
  DocsVerified: number | null;
  BankPrefNames: string | null;
  AgreementId: number | null;
  AgreementNo: string | null;
  AgreementStatus: string | null;
}

export interface BoardFilters {
  tab: BoardTab;
  page: number;
  pageSize: number;
  search: string;
  cpb: WelcomeCpbFilters;
  assignedTo?: string;
  calledBy?: string;
  outcome?: string;
  focus?: string;
  sortKey?: string;
  sortDir?: "asc" | "desc";
}

export interface BoardCounts {
  tabs: Record<WelcomeView, number>;
  focus: {
    queue: { neverCalled: number; overdue: number; dueToday: number; unreachable3: number; scheduled: number };
    checklist: { incomplete: number; readyToSubmit: number; hasRecheck: number; missingFinancing: number; planDisputed: number };
    recheck: { aging: number; multi: number };
  };
}

export interface HistoryCounts {
  total: number;
  welcomed: number;
  callback: number;
  notReached: number;
  planDisputed: number;
  submitted: number;
}

export const EMPTY_FORM = {
  CalledBy: "", CallDate: "", DurationSeconds: "",
  Outcome: "", NextCallDate: "", Notes: "", PreferredAgreementDate: "",
};
export const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
// datetime-local input value for "right now" — pre-filling this is the
// common case (logging the call as it happens); staff can still change it
// for a call being logged after the fact.
export const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export interface WelcomeCpbFilters { companyId: string; projectId: string; blockId: string }
export function cpbParams(f: WelcomeCpbFilters): URLSearchParams {
  const q = new URLSearchParams();
  if (f.companyId) q.set("companyId", f.companyId);
  if (f.projectId) q.set("projectId", f.projectId);
  if (f.blockId) q.set("blockId", f.blockId);
  return q;
}
// Queue is naturally bounded to "still needs a call" bookings, not the full
// historical volume — Company/Project/Block narrows it, no pagination needed.
// The three lists throw, so a failed load shows as one instead of an empty queue.
async function getList(url: string, what: string): Promise<any> {
  const r = await fetchWithAuth(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load ${what} (${r.status}).`);
  return data;
}
export async function fetchQueue(cpb: WelcomeCpbFilters): Promise<any[]> {
  const d = await getList(`${API}/queue?${cpbParams(cpb)}`, "the call queue");
  return Array.isArray(d) ? d : [];
}

export const PAGE_SIZE = 20;
export async function fetchCallsList(
  cpb: WelcomeCpbFilters,
  search: string,
  page: number,
  opts?: {
    pageSize?: number;
    sortKey?: string;
    sortDir?: "asc" | "desc";
    outcome?: string;
    calledBy?: string;
    assignedTo?: string;
    focus?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<{ rows: any[]; total: number }> {
  const q = cpbParams(cpb);
  q.set("page", String(page));
  q.set("pageSize", String(opts?.pageSize ?? PAGE_SIZE));
  if (search) q.set("search", search);
  if (opts?.sortKey) { q.set("sortKey", opts.sortKey); q.set("sortDir", opts.sortDir || "desc"); }
  if (opts?.outcome && opts.outcome !== "All") q.set("outcome", opts.outcome);
  if (opts?.calledBy) q.set("calledBy", opts.calledBy);
  if (opts?.assignedTo) q.set("assignedTo", opts.assignedTo);
  if (opts?.focus) q.set("focus", opts.focus);
  if (opts?.dateFrom) q.set("dateFrom", opts.dateFrom);
  if (opts?.dateTo) q.set("dateTo", opts.dateTo);
  const data = await getList(`${API}?${q}`, "the call history");
  return { rows: data.rows || [], total: data.total || 0 };
}

export function boardQueryParams(f: Omit<BoardFilters, "page" | "pageSize">): URLSearchParams {
  const q = cpbParams(f.cpb);
  q.set("tab", f.tab);
  if (f.search) q.set("search", f.search);
  if (f.assignedTo) q.set("assignedTo", f.assignedTo);
  if (f.calledBy) q.set("calledBy", f.calledBy);
  if (f.outcome && f.outcome !== "All") q.set("outcome", f.outcome);
  if (f.focus) q.set("focus", f.focus);
  if (f.sortKey) { q.set("sortKey", f.sortKey); q.set("sortDir", f.sortDir || "asc"); }
  return q;
}

export async function fetchBoard(f: BoardFilters): Promise<{ rows: BoardRow[]; total: number }> {
  const q = boardQueryParams(f);
  q.set("page", String(f.page));
  q.set("pageSize", String(f.pageSize));
  const data = await getList(`${API}/board?${q}`, "the welcome call list");
  return { rows: data.rows || [], total: data.total || 0 };
}

export async function fetchBoardCounts(f: {
  cpb: WelcomeCpbFilters;
  search: string;
  assignedTo?: string;
}): Promise<BoardCounts> {
  const q = cpbParams(f.cpb);
  if (f.search) q.set("search", f.search);
  if (f.assignedTo) q.set("assignedTo", f.assignedTo);
  return getList(`${API}/board/counts?${q}`, "welcome call counts");
}

export async function fetchHistoryCounts(f: {
  cpb: WelcomeCpbFilters;
  search: string;
  assignedTo?: string;
  calledBy?: string;
  outcome?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<HistoryCounts> {
  const q = cpbParams(f.cpb);
  if (f.search) q.set("search", f.search);
  if (f.assignedTo) q.set("assignedTo", f.assignedTo);
  if (f.calledBy) q.set("calledBy", f.calledBy);
  if (f.outcome && f.outcome !== "All") q.set("outcome", f.outcome);
  if (f.dateFrom) q.set("dateFrom", f.dateFrom);
  if (f.dateTo) q.set("dateTo", f.dateTo);
  return getList(`${API}/history-counts?${q}`, "call history counts");
}
export async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}
export async function fetchChecklist(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/checklist`); return r.ok ? r.json() : null; } catch { return null; }
}
export async function fetchDocs(bookingId: number): Promise<any> {
  try { const r = await fetchWithAuth(`${DOC_API}/booking/${bookingId}`); return r.ok ? r.json() : { documents: [], standardTypes: [] }; } catch { return { documents: [], standardTypes: [] }; }
}
export async function fetchCoApplicants(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${CO_API}/booking/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
// Reads Welcome Calls' own call-context route: it read Bookings' (the Bookings right), so a caller without that right
// opening ?bookingId= got nothing.
export async function fetchBookingById(bookingId: number): Promise<any | null> {
  try {
    const r = await fetchWithAuth(`${API}/${bookingId}/call-context`);
    if (!r.ok) return null;
    const { booking: d } = await r.json();
    if (!d) return null;
    return {
      BookingId: d.Id,
      BookingNo: d.BookingNo,
      ApplicationId: d.ApplicationId,
      ApplicantName: d.ApplicantName,
      Mobile: d.Mobile,
      ProjectName: d.ProjectName,
      BlockName: d.BlockName,
      UnitNo: d.UnitNo,
      BookingDate: d.BookingDate,
    };
  } catch { return null; }
}
export async function fetchCallContext(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/call-context`); return r.ok ? r.json() : null; } catch { return null; }
}
// Full loan/bank-preference record — the call-context endpoint only carries
// a trimmed subset (BankName/LoanAmount/SanctionStatus/LoanAccountNo); this
// is the same GET the Home Loan Tracking page itself uses, so the expanded
// Bank Preference card can show Branch/RM name/contact/disbursed amount too
// without a second bespoke endpoint.
export async function fetchLoanDetail(bookingId: number): Promise<any | null> {
  try { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/loan`); return r.ok ? r.json() : null; } catch { return null; }
}
// Real milestone schedule for the expandable Payment Plan card — same
// endpoint CrmBookingDetail.tsx's own "Payment Plan" tab reads .milestones
// off of.
export async function fetchBookingMilestones(bookingId: number): Promise<any[]> {
  try {
    const r = await fetchWithAuth(`${BKG_API}/${bookingId}`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.milestones || [];
  } catch { return []; }
}
// Full invoice rows (Description/Status/CreatedByName included) — richer
// than call-context's trimmed InvoiceNo/InvoiceType/Amount/InvoiceDate-only
// projection, so the click-to-detail dialog doesn't need its own endpoint.
export async function fetchBookingInvoices(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${BKG_API}/${bookingId}/invoices`); return r.ok ? r.json() : []; } catch { return []; }
}
// Read-only reference data for the new Parking / Extra Charges checklist
// items — staff need to actually see what was sold before they can confirm
// it with the customer. Neither of these was fetched anywhere on this page
// before; both fail soft to an empty list (e.g. a role without crm-bookings
// view rights) rather than blocking the rest of the dossier from loading.
export async function fetchParkingAllotments(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${PARKING_API}/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchExtraCharges(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${EXTRA_CHARGE_API}/${bookingId}`); return r.ok ? r.json() : []; } catch { return []; }
}
// Preferred banks the customer expressed during the welcome call — separate
// from CrmLoanDetail (the actual sanctioned loan) and CrmCustomerBankDetail
// (KYC/refund account). Multiple entries per booking are expected.
export async function fetchBankPreferences(bookingId: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${bookingId}/bank-preferences`); return r.ok ? r.json() : []; } catch { return []; }
}
// ─── Verification checklist (per-item checkbox + remarks + recheck) ────────
export type VcItem = {
  Section: string; SectionLabel: string; ItemKey: string; Label: string;
  IsChecked: boolean; Remarks: string;
  RecheckStatus: typeof CrmStatus.OPEN | typeof CrmStatus.RESOLVED | null; RecheckReason: string | null;
  RecheckRequestedAt: string | null; ResolvedAt: string | null;
};
export type VcSection = { section: string; label: string; items: VcItem[]; complete: boolean; hasOpenRecheck: boolean };
export type VcState = {
  items: VcItem[]; sections: VcSection[]; totalCount: number; checkedCount: number; openRecheckCount: number; canSubmit: boolean;
  submission: { IsLocked: boolean; SubmittedBy: number | null; SubmittedAt: string | null } | null;
  // Whether a call with Outcome "Welcomed" has actually been logged for this
  // booking — the checklist can't be legitimately submitted without one,
  // since it's staff sign-off on facts confirmed DURING that call.
  hasWelcomedCall: boolean;
};
export async function fetchVerificationChecklist(bookingId: number): Promise<VcState | null> {
  try { const r = await fetchWithAuth(`${VC_API}/${bookingId}`); return r.ok ? r.json() : null; } catch { return null; }
}
export async function fetchRecheckQueue(cpb: WelcomeCpbFilters): Promise<any[]> {
  const d = await getList(`${VC_API}/recheck/queue?${cpbParams(cpb)}`, "the recheck queue");
  return Array.isArray(d) ? d : [];
}

export function mimeIcon(mime: string | null | undefined) {
  if (!mime) return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-foreground shrink-0" />;
  if (mime === "application/pdf") return <FileCheck size={16} className="text-destructive shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-foreground shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Enterprise Grid sheet keys (matches CrmBookingDetail / CrmPaymentMilestones) ──
export const { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT, INP, TEXTAREA } = GRID_SHEET_KEYS;

// Theme-safe semantic tone helpers: default `:root` is dark theme (no `[data-theme]` attribute),
// whereas every light theme (`light`, `sage`, `glass`, `bw`) sets `[data-theme]`. Using this selector
// guarantees crisp WCAG contrast on dark AND all light themes without requiring a `.dark` class.
export const TONE_EMERALD_TEXT = "text-emerald-400 [[data-theme]_&]:text-emerald-700";
export const TONE_EMERALD_PILL = "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 [[data-theme]_&]:bg-emerald-500/10 [[data-theme]_&]:border-emerald-500/25 [[data-theme]_&]:text-emerald-700";
export const TONE_AMBER_TEXT = "text-amber-300 [[data-theme]_&]:text-amber-700";
export const TONE_ROSE_PILL = "border-rose-500/40 bg-rose-500/15 text-rose-300 [[data-theme]_&]:bg-rose-500/10 [[data-theme]_&]:border-rose-500/35 [[data-theme]_&]:text-rose-700";
