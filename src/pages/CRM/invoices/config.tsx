// CRM Invoices — shared pieces: endpoints, types, formatting, fetchers, and the one rule for whether a
// milestone can be invoiced.
import React from "react";
import { Link } from "react-router-dom";
import type { useQueryClient } from "@tanstack/react-query";
import { CrmStatus } from "@/constants/crmStatuses";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { GridToneMark } from "@/components/crm/CrmDataTable";
import { cn } from "@/lib/utils";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";

// Same approver set the backend's INVOICE_VOID_ROLES enforces
// (crmBookings.js PUT /:id/invoices/:invoiceId/void) — this only controls
// button visibility, the server re-checks independently.
export const INVOICE_VOID_ROLES = ["admin", "super_admin", "dba", "accounts_head"];

export const API = "/api/crm/invoices";
export const BKG_API = "/api/crm/bookings";
export const PAY_API = "/api/crm/payments";
export const DIALOG = "p-5 gap-4";
/** An invoice type as words: TransferFee reads "Transfer fee". */
export const typeLabel = (t?: string | null) => String(t || "").replace(/([a-z])([A-Z])/g, (_m, a, b) => `${a} ${String(b).toLowerCase()}`);

export interface InvoiceRow {
  Id: number;
  InvoiceNo: string;
  InvoiceType: string;
  Amount: number;
  InvoiceDate: string;
  Description?: string | null;
  Status: string;
  VoidReason: string | null;
  CreatedAt: string;
  // Credit notes against it (Finance -> Credit Notes).
  CreditedAmount?: number;
  CreditNoteId?: number | null;
  CreditNoteNos?: string | null;
  // The GST split its PDF prints; what came in against it (booking page only).
  TaxableValue?: number;
  GstAmount?: number;
  Received?: number | null;
  Balance?: number | null;
  BookingId: number;
  MilestoneId?: number | null;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedByName: string | null;
}
/** One booking's billing, as the server works it out (crmInvoices.js ledgerSelect). */
export interface LedgerRow {
  BookingId: number; ApplicationId: number; BookingNo: string; BookingStatus: string; Closed: number; NonInvoice: number; FinalDue: number; StatementDue: number; Waived: number; GrandTotal: number; ExcessOnAccount: number; ReadyMilestoneIds?: number[];
  ProjectName: string | null; UnitNo: string; ApplicantName: string; Mobile: string | null; AssignedToName: string | null;
  PlanDue: number; PlanInvoiced: number; OtherInvoiced: number; Invoiced: number; Credited: number; NetInvoiced: number;
  MilestoneTotal: number; MilestoneInvoiced: number; ReadyAmount: number; ReadyCount: number; NotInvoiced: number;
  Approved: number; ReceivedNotInvoiced: number; LiveCount: number; VoidCount: number; HasFinal: number; LastInvoiceDate: string | null;
}
export interface InvoiceSummary { liveCount: number; liveAmount: number; voidCount: number; credited: number }
export interface LedgerSummary {
  counts: Record<"everything" | "ready" | "final" | "uninvoiced" | "none" | "partial" | "full" | "closed", number>;
  planDue: number; planInvoiced: number; otherInvoiced: number; invoiced: number; credited: number; netInvoiced: number;
  ready: number; readyCount: number; notInvoiced: number; receivedNotInvoiced: number;
  invoices: InvoiceSummary; types: string[];
}
export interface BookingBilling { booking: LedgerRow; invoices: InvoiceRow[]; milestones: any[]; creditNotes: any[]; waivers: any[] }

export const fmtMoney = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
export function fmtDate(v?: string | null) {
  if (!v) return "—";
  // Bare date strings (YYYY-MM-DD) parsed as UTC shift by one day in IST.
  // Force local midnight by appending T00:00:00 before parsing.
  const iso = String(v).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function getJson(url: string, failure: string) {
  const res = await fetchWithAuth(url);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || failure);
  return data;
}
export const fetchLedger = (p: URLSearchParams): Promise<{ rows: LedgerRow[]; total: number }> => getJson(`${API}/ledger?${p}`, "Could not load the bookings");
export const fetchLedgerExport = (p: URLSearchParams): Promise<LedgerRow[]> => getJson(`${API}/ledger?${p}`, "Could not export the bookings");
export const fetchLedgerSummary = (p: URLSearchParams): Promise<LedgerSummary> => getJson(`${API}/ledger/summary?${p}`, "Could not load the figures");
export const fetchInvoiceRows = (p: URLSearchParams): Promise<{ rows: InvoiceRow[]; total: number }> => getJson(`${API}?${p}`, "Could not load invoices");
export const fetchInvoiceExport = (p: URLSearchParams): Promise<InvoiceRow[]> => getJson(`${API}?${p}`, "Could not export invoices");
async function postJson(url: string, body?: unknown) {
  const res = await fetchWithAuth(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
/** Generates milestone invoices through the one bulk route: each is checked on its own, and what could not be is reported. */
export const generateMilestoneInvoices = (items: { bookingId: number; milestoneId: number }[]): Promise<{ succeeded: any[]; skipped: { reason: string }[] }> => postJson(`${BKG_API}/invoices/bulk-generate`, { items });
export const generateFinalInvoice = (bookingId: number) => postJson(`${BKG_API}/${bookingId}/invoices/final`);
export const raiseDemand = (milestoneId: number) => postJson(`${PAY_API}/${milestoneId}/demand`, {});
export async function downloadFinalStatement(r: { BookingId: number; BookingNo: string }) {
  const res = await fetchWithAuth(`${API}/booking/${r.BookingId}/statement`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Could not download the final statement.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `Final-Statement-${r.BookingNo}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
export async function downloadInvoicePdf(inv: Pick<InvoiceRow, "BookingId" | "Id" | "InvoiceNo">) {
  const res = await fetchWithAuth(`${BKG_API}/${inv.BookingId}/invoices/${inv.Id}/pdf`);
  if (!res.ok) throw new Error("Could not download the invoice PDF.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `${inv.InvoiceNo}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
export const fetchBookingBilling = (id: string): Promise<BookingBilling> => getJson(`${API}/booking/${encodeURIComponent(id)}`, "Could not load the booking");

export async function fetchInvoice(id: string): Promise<InvoiceRow> {
  const res = await fetchWithAuth(`${API}/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Invoice not found");
  return data;
}
/** The newest 25 live bookings under the search and filters: the server finds them, however many there are. */
export async function fetchBookingsForPicker(f: { search: string; companyId: string; projectId: string; blockId: string }): Promise<any[]> {
  const p = new URLSearchParams({ page: "1", pageSize: "25" });
  for (const k of ["search", "companyId", "projectId", "blockId"] as const) if (f[k]) p.set(k, f[k]);
  const res = await fetchWithAuth(`${BKG_API}?${p}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.rows || [];
}
export async function fetchBookingDetail(id: number): Promise<any> {
  const res = await fetchWithAuth(`${BKG_API}/${id}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Could not load the booking.");
  return data;
}
export async function fetchOnAccount(id: number): Promise<any | null> {
  const res = await fetchWithAuth(`${PAY_API}/booking/${id}/on-account`);
  return res.ok ? res.json() : null;
}

// Every query that a booking's invoice/milestone state feeds — invalidated together on generate/void so the
// list, the dialog and a bulk-generate result can never disagree or go stale independently.
export function invalidateInvoiceRelatedQueries(qc: ReturnType<typeof useQueryClient>, bookingId?: number) {
  qc.invalidateQueries({ queryKey: ["crm-invoices"] });
  for (const k of ["crm-invoice-gen-existing", "crm-invoice-gen-booking-detail", "crm-invoice-gen-on-account"]) {
    qc.invalidateQueries({ queryKey: bookingId != null ? [k, bookingId] : [k] });
  }
}

export type MilestoneTone = "ready" | "invoiced" | "demand";
// One place that decides "can this milestone be invoiced, and why/why not" — the dialog's default type and
// each row's message read off this one function. This is BILLING (a demand raised, not yet invoiced), a
// separate question from PAYMENT (paid / partial / pending), which is why both are labelled where they show.
export function getMilestoneInsight(m: any, existingInvoices: any[]): { tone: MilestoneTone; message: string } {
  // A Void invoice frees its milestone slot (migration 325) — a corrected invoice can be raised for it.
  const existingInv = existingInvoices.find((inv: any) => inv.MilestoneId === m.Id && inv.Status !== "Void");
  if (existingInv) return { tone: "invoiced", message: `Already invoiced — ${existingInv.InvoiceNo}` };
  // Invoice is generated from the demand (billing doc for AmountDue), before On Account Adjustment settles
  // the milestone. Only gate: the demand must exist — the Booking Amount (Milestone #1) included.
  if (m.DemandStatus === CrmStatus.PENDING) return { tone: "demand", message: "Raise the demand first" };
  return { tone: "ready", message: "Due for invoicing" };
}

/** A milestone's billing state: the one rule above, with what only the whole booking knows (a Final invoice, a waiver). */
export const BILLING_MARK = {
  invoiced: { label: "Invoiced", tone: "done" },
  final: { label: "On final invoice", tone: "done" },
  ready: { label: "Due for invoicing", tone: "waiting" },
  demand: { label: "Awaiting demand", tone: "draft" },
  later: { label: "Final invoice on full payment", tone: "draft" },
  finalDue: { label: "Final invoice due", tone: "waiting" },
  waived: { label: "Waived", tone: "draft" },
  waiverPending: { label: "Waiver awaiting approval", tone: "waiting" },
} as const;
export function billingStateOf(m: any, invoices: InvoiceRow[], nonInvoice = false, finalDue = false): keyof typeof BILLING_MARK {
  if (m.Status === "Waived") return "waived";
  if (finalDue) return "finalDue";
  if (nonInvoice && !invoices.some((i) => i.InvoiceType === "Final" && i.Status !== "Void")) return "later";
  const insight = getMilestoneInsight(m, invoices).tone;
  if (insight === "invoiced") return "invoiced";
  if (invoices.some((i) => i.InvoiceType === "Final" && i.Status !== "Void")) return "final";
  return insight;
}

/** What is invoiced against all that is billable, then what is ready to invoice; the rest of the line awaits a demand. */
export function InvoiceBar({ due, invoiced, ready, onDark, title }: { due: number; invoiced: number; ready: number; onDark?: boolean; title?: string }) {
  const w = (n: number) => `${due > 0 ? Math.min(100, (n / due) * 100) : 0}%`;
  return (
    <span className={cn("flex w-full gap-px rounded-full overflow-hidden", onDark ? "h-2.5 bg-white/15" : "h-1.5 bg-slate-200 dark:bg-slate-700")} title={title}>
      {invoiced > 0 && <span className={onDark ? "bg-emerald-400" : "bg-emerald-500"} style={{ width: w(invoiced), minWidth: 3 }} />}
      {ready > 0 && <span className={onDark ? "bg-amber-300" : "bg-amber-400"} style={{ width: w(ready), minWidth: 3 }} />}
    </span>
  );
}

export function InvoiceMark({ inv }: { inv: { Status: string } }) {
  return inv.Status === "Void" ? <GridToneMark text="Void" tone="stopped" /> : <GridToneMark text="Issued" tone="done" />;
}

/** "−₹x credited · CRN-…" under an invoice's amount, opening its credit note. */
export function CreditedNote({ inv }: { inv: { CreditedAmount?: number; CreditNoteId?: number | null; CreditNoteNos?: string | null } }) {
  if (!(Number(inv.CreditedAmount) > 0)) return null;
  return (
    <Link to={`/crm/credit-notes?id=${inv.CreditNoteId}`} onClick={(e) => e.stopPropagation()}
      className="block text-xs text-primary hover:underline tabular-nums" title="Credit notes against this invoice">
      −{fmtMoney(inv.CreditedAmount)} credited{inv.CreditNoteNos ? ` · ${inv.CreditNoteNos}` : ""}
    </Link>
  );
}
