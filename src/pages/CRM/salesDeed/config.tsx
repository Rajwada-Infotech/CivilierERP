// Shared by Sale Deeds and its parts: the API, the tabs, status tones, document helpers, the step each deed has
// reached, and the list / booking fetches.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { File as FileIcon, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { statusTone } from "@/components/sheet/Sheet";

export const API = "/api/crm/sales-deed";
export const USERS_API = "/api/users";

export const DEED_TABS = ["Timeline", "Overview", "Documents", "Legal & Approval", "Query Payment", "Registry", "History"] as const;
export type DeedTab = typeof DEED_TABS[number];
export type StepState = "done" | "current" | "upcoming";

export const STATUSES = ["Draft", "Executed", "Registered", "Overdue", "Cancelled"] as const;

/** Sheet tone for a deed, Query Payment or Registry status. */
export const deedTone = (s: string): "done" | "waiting" | "stopped" =>
  s === "Registered" || s === "Completed" || s === "Confirmed" ? "done" : s === "Overdue" ? "stopped" : statusTone(s);

/** Today (or `o` days on) as YYYY-MM-DD in local time; toISOString gave yesterday before 05:30 IST. */
export const localDay = (o = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Plain-language description of what staff should do next for a given document row.
export function docNextStep(doc: any): string {
  if (doc.Status === "Verified") return "Checked and accepted.";
  if (doc.Status === "Rejected") return "Rejected — attach a corrected file.";
  if (doc.Status === "Uploaded") return "Uploaded — awaiting staff review.";
  return doc.IsMandatory ? "Required — attach a file to proceed." : "Requested — attach a file.";
}

export const LOG_ACTION_LABEL: Record<string, string> = {
  SeniorApprove: "Senior approved",
  SeniorReject: "Senior rejected",
  Submitted: "Submitted for senior approval",
  LegalAssigned: "Legal executive assigned",
  SendToCustomer: "Sent to customer",
  CustomerApprove: "Customer approved",
  CustomerRecheck: "Recheck requested",
  DirectorApprove: "Director approved",
  DirectorReject: "Director rejected: back to legal",
  SentBackToLegal: "Sent back to legal after the customer's recheck",
  Executed: "Executed",
  Cancelled: "Cancelled",
};

export function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function mimeIcon(mime: string | null | undefined) {
  if (mime?.startsWith("image/")) return <FileImage size={16} className="text-foreground shrink-0" />;
  if (mime === "application/pdf") return <FileText size={16} className="text-foreground shrink-0" />;
  if (mime && (mime.includes("sheet") || mime.includes("excel"))) return <FileSpreadsheet size={16} className="text-foreground shrink-0" />;
  return <FileIcon size={16} className="text-muted-foreground shrink-0" />;
}

export function fmtBytes(n: number | null | undefined) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function deedDocumentProgress(documents: any[] | undefined): { required: number; uploaded: number; percent: number } {
  const mandatory = (documents || []).filter((d) => d.IsMandatory);
  const required = mandatory.length;
  const uploaded = mandatory.filter((d) => d.HasFile).length;
  const percent = required > 0 ? Math.round((uploaded / required) * 100) : 0;
  return { required, uploaded, percent };
}

// A step is "done" only if its own flag is true AND every step before it is done; the first not-done step is the one
// "current" step; everything after it is "upcoming" (out-of-sequence legacy rows used to show two current steps).
/** The mandatory papers on a deed row (the server counts them: MandatoryDocCount / MandatoryUploadedCount). */
export function rowDeedProgress(d: any): { required: number; uploaded: number; percent: number } {
  const required = Number(d?.MandatoryDocCount) || 0;
  const uploaded = Number(d?.MandatoryUploadedCount) || 0;
  return { required, uploaded, percent: required > 0 ? Math.round((uploaded / required) * 100) : 0 };
}
// The deed's steps, in order. Whether each is done is decided on the server (routes/crmSalesDeed.js, DEED_STEPS) and
// comes on every deed row as D_<key>, with StepIndex the one it is on; this only names them and says which tab works each.
const DEED_STEP_VIEW: { key: string; label: string; tab: DeedTab }[] = [
  { key: "setup", label: "Draft Setup", tab: "Overview" },
  { key: "legal", label: "Legal Assigned", tab: "Legal & Approval" },
  { key: "docs", label: "Draft Docs", tab: "Documents" },
  { key: "senior", label: "Senior Approve", tab: "Legal & Approval" },
  { key: "customer", label: "Customer Review", tab: "Legal & Approval" },
  { key: "director", label: "Director Approve", tab: "Legal & Approval" },
  { key: "stampDuty", label: "Stamp Duty", tab: "Query Payment" },
  { key: "execution", label: "Execution", tab: "Legal & Approval" },
  { key: "registered", label: "Registered", tab: "Registry" },
];
export const DEED_STEP_NAMES = DEED_STEP_VIEW.map((s) => s.label);
/** Each step of a deed row and where it stands: done up to the step it is on, then that one, then the rest. */
export function deedStepStates(d: any): { label: string; state: StepState; tab: DeedTab }[] {
  const at = Number(d?.StepIndex ?? 0);
  const docs = rowDeedProgress(d);
  return DEED_STEP_VIEW.map((s, i) => ({
    label: s.key === "docs" && docs.required > 0 ? `${s.label} (${docs.percent}%)` : s.label,
    state: i < at ? "done" : i === at ? "current" : "upcoming",
    tab: s.tab,
  }));
}

export const EMPTY_FORM = {
  BookingId: "", DeedValue: "", StampDuty: "", RegistrationFee: "",
  StampDutyCredit: "", SubRegistrarOffice: "", DeedDate: "", RegistrationDeadline: "",
};

/** The step a deed is on now ("Complete" once registered, "—" when cancelled): the list's Stage column. */
export function deedCurrentStep(d: any): string {
  if (d?.Status === "Registered") return "Complete";
  if (d?.Status === "Cancelled") return "—";
  return deedStepStates(d).find((s) => s.state === "current")?.label ?? "Complete";
}

export type DeedAlertTone = "stopped" | "waiting" | "moving";
// What needs someone now. Which deeds it applies to is decided on the server (DEED_ALERTS) and comes on every deed row
// as A_<key>; this names each one and says who it waits on.
export const DEED_ALERTS: { key: string; label: string; tone: DeedAlertTone }[] = [
  { key: "overdue", label: "Overdue", tone: "stopped" },
  { key: "recheck", label: "Customer asked for a recheck", tone: "stopped" },
  { key: "noLegal", label: "No legal executive", tone: "waiting" },
  { key: "director", label: "Waiting for the director", tone: "waiting" },
  { key: "toSend", label: "Senior-approved, not sent", tone: "moving" },
  { key: "stampDuty", label: "Stamp duty to confirm", tone: "moving" },
  { key: "toRegister", label: "Executed, to register", tone: "moving" },
];
export const deedAlerts = (d: any) => DEED_ALERTS.filter((a) => d?.[`A_${a.key}`] === 1);

/** One page of the list for the given query (page, sort, status, search, filters), with the counts by status. */
export async function fetchDeedsList(params: URLSearchParams): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the sale deeds (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
}
/** Every deed matching the query, sorted (the Excel export). */
export async function fetchAllDeeds(params: URLSearchParams): Promise<any[]> {
  const p = new URLSearchParams(params);
  p.delete("page"); p.delete("pageSize");
  const r = await fetchWithAuth(`${API}?${p}`);
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error((data as any)?.error || `Could not export the sale deeds (${r.status}).`);
  return data;
}

export async function fetchEligible(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/eligible-bookings`); return r.ok ? r.json() : []; } catch { return []; }
}
export async function fetchBookingContext(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try { const r = await fetchWithAuth(`${API}/booking/${bookingId}/context`); return r.ok ? r.json() : null; } catch { return null; }
}
export async function fetchLegalExecutives(): Promise<{ value: string; label: string }[]> {
  try {
    const r = await fetchWithAuth(`${USERS_API}/legal-executives`);
    if (!r.ok) return [];
    const d: any[] = await r.json();
    return d.map((u) => ({ value: String(u.id), label: u.name }));
  } catch { return []; }
}

/** Fetches a stored file with the page's auth and either previews it (image / PDF) or saves it. */
export async function fetchFileBlob(url: string): Promise<Blob> {
  const res = await fetchWithAuth(url);
  if (!res.ok) throw new Error("Could not load file");
  return res.blob();
}
export async function downloadFile(url: string, name: string) {
  const blob = await fetchFileBlob(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(href);
}
