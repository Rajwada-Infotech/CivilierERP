// Shared by Welcome Calls and its parts: the APIs, call outcomes, the call form, the queue / history / checklist fetches
// and small formatters.
import { CrmStatus } from "@/constants/crmStatuses";
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
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
// Call History is a genuine, ever-growing audit log — the one view here
// that actually needs pagination.
export async function fetchCallsList(cpb: WelcomeCpbFilters, search: string, page: number): Promise<{ rows: any[]; total: number }> {
  const q = cpbParams(cpb);
  q.set("page", String(page));
  q.set("pageSize", String(PAGE_SIZE));
  if (search) q.set("search", search);
  const data = await getList(`${API}?${q}`, "the call history");
  return { rows: data.rows || [], total: data.total || 0 };
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
    return { BookingId: d.Id, BookingNo: d.BookingNo, ApplicantName: d.ApplicantName, Mobile: d.Mobile, ProjectName: d.ProjectName, UnitNo: d.UnitNo };
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
  if (mime.startsWith("image/")) return <FileImage size={16} className="text-blue-500 shrink-0" />;
  if (mime === "application/pdf") return <FileCheck size={16} className="text-red-500 shrink-0" />;
  if (mime.includes("sheet") || mime.includes("excel")) return <FileSpreadsheet size={16} className="text-emerald-500 shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}
export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Sheet styles ──
export { RULE, RULE_SOFT, LBL, KEY_INK, KEY_LINE, KEY_RED } from "../customers/config";
