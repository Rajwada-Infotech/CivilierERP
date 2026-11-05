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

// Legal & registry roles allowed to confirm the government payment and complete / cancel the registry.
export const CRM_REGISTRY_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "legal_head"];
export const roleKey = (role: unknown) => String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

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
  Submitted: "Resubmitted",
  SendToCustomer: "Sent to customer",
  CustomerApprove: "Customer approved",
  CustomerRecheck: "Recheck requested",
  DirectorApprove: "Director approved",
  DirectorReject: "Director rejected",
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
export function deedStepStates(d: any, documents: any[] | undefined, context: any): { label: string; state: StepState; tab: DeedTab }[] {
  const docs = deedDocumentProgress(documents);
  const raw: { label: string; done: boolean; tab: DeedTab }[] = [
    { label: "Draft Setup", done: true, tab: "Overview" },
    { label: "Legal Assigned", done: !!d?.LegalExecutiveId, tab: "Legal & Approval" },
    { label: `Draft Docs${docs.required > 0 ? ` (${docs.percent}%)` : ""}`, done: docs.required > 0 && docs.percent === 100, tab: "Documents" },
    { label: "Senior Approve", done: d?.SeniorApprovalStatus === "Approved", tab: "Legal & Approval" },
    { label: "Customer Review", done: d?.CustomerApprovalStatus === "Approved", tab: "Legal & Approval" },
    { label: "Director Approve", done: d?.DirectorApprovalStatus === "Approved", tab: "Legal & Approval" },
    { label: "Stamp Duty", done: context?.queryPaymentStatus === "Confirmed", tab: "Query Payment" },
    { label: "Execution", done: !!d?.ExecutedBy || d?.Status === "Executed" || d?.Status === "Registered", tab: "Legal & Approval" },
    { label: "Registered", done: !!d?.RegistrationNo || d?.Status === "Registered", tab: "Registry" },
  ];
  let blocked = false;
  return raw.map((s) => {
    let state: StepState;
    if (!blocked && s.done) state = "done";
    else if (!blocked) { state = "current"; blocked = true; }
    else state = "upcoming";
    return { label: s.label, state, tab: s.tab };
  });
}

export const EMPTY_FORM = {
  BookingId: "", DeedValue: "", StampDuty: "", RegistrationFee: "",
  StampDutyCredit: "", SubRegistrarOffice: "", DeedDate: "", RegistrationDeadline: "",
};

export const PAGE_SIZE = 20;
export interface DeedListFilters { search: string; status: string; companyId: string; projectId: string; blockId: string }

export async function fetchDeedsList(filters: DeedListFilters, page: number): Promise<{ rows: any[]; total: number; statusCounts: Record<string, number> }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  // A failed load used to read as "No deeds found".
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the sale deeds (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0, statusCounts: data.statusCounts || {} };
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
