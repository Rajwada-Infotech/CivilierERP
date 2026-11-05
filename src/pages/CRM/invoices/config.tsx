// CRM Invoices — shared pieces: endpoints, types, formatting, fetchers, and the one rule for whether a
// milestone can be invoiced.
import React from "react";
import { Link } from "react-router-dom";
import type { useQueryClient } from "@tanstack/react-query";
import { CrmStatus } from "@/constants/crmStatuses";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";

// Same approver set the backend's INVOICE_VOID_ROLES enforces
// (crmBookings.js PUT /:id/invoices/:invoiceId/void) — this only controls
// button visibility, the server re-checks independently.
export const INVOICE_VOID_ROLES = ["admin", "super_admin", "dba", "accounts_head"];

export const API = "/api/crm/invoices";
export const BKG_API = "/api/crm/bookings";
export const PAY_API = "/api/crm/payments";
export const TYPES = ["Milestone", "Maintenance", "Other", "OnAccount", "Agreement", "Possession"];
export const PAGE_SIZE = 20;
export const DIALOG = "rounded-none p-5 gap-4";

export interface InvoiceRow {
  Id: number;
  InvoiceNo: string;
  InvoiceType: string;
  Amount: number;
  InvoiceDate: string;
  Status: string;
  VoidReason: string | null;
  CreatedAt: string;
  // Credit notes against it (Finance -> Credit Notes).
  CreditedAmount?: number;
  CreditNoteId?: number | null;
  CreditNoteNos?: string | null;
  BookingId: number;
  MilestoneId?: number | null;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  CreatedByName: string | null;
}
export interface BookingGroup {
  BookingId: number;
  BookingNo: string;
  ProjectName: string | null;
  UnitNo: string;
  ApplicantName: string;
  Mobile: string | null;
  MilestoneTotal: number;
  MilestoneInvoiced: number;
  Invoices: InvoiceRow[];
}
export interface InvoiceSummary {
  liveCount: number; liveAmount: number; voidCount: number; credited: number;
  bookings?: { all: number; full: number; partial: number; none: number };
}

export const fmtMoney = (v?: number | null) => (v == null ? "—" : fmtRupees(Number(v)));
export function fmtDate(v?: string | null) {
  if (!v) return "—";
  // Bare date strings (YYYY-MM-DD) parsed as UTC shift by one day in IST.
  // Force local midnight by appending T00:00:00 before parsing.
  const iso = String(v).slice(0, 10);
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// Shared filter shape for the main list — both the grouped and flat views
// read off the same committed filter set + page, so switching between them
// never shows disagreeing data.
export interface ListFilters {
  type: string; search: string; companyId: string; projectId: string; blockId: string;
  invoicedStatus: string; dateFrom: string; dateTo: string;
}

export async function fetchInvoiceList(view: "grouped" | "flat", filters: ListFilters, page: number, sortKey = "CreatedAt", sortDir: "asc" | "desc" = "desc"): Promise<any> {
  const q = new URLSearchParams();
  q.set("view", view);
  q.set("page", String(page));
  q.set("pageSize", String(PAGE_SIZE));
  for (const k of ["type", "search", "companyId", "projectId", "blockId", "dateFrom", "dateTo"] as const) if (filters[k]) q.set(k, filters[k]);
  if (view === "grouped" && filters.invoicedStatus) q.set("invoicedStatus", filters.invoicedStatus);
  if (view === "flat") { q.set("sortKey", sortKey); q.set("sortDir", sortDir); }
  const res = await fetchWithAuth(`${API}?${q}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Failed to load invoices");
  return data;
}
export async function fetchInvoice(id: string): Promise<InvoiceRow> {
  const res = await fetchWithAuth(`${API}/${encodeURIComponent(id)}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Invoice not found");
  return data;
}
export async function fetchBookingsForPicker(): Promise<any[]> {
  const res = await fetchWithAuth(BKG_API);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.bookings || [];
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
  if (m.DemandStatus === CrmStatus.PENDING) return { tone: "demand", message: "Raise a demand (Demands page) to unlock invoicing" };
  return { tone: "ready", message: "Ready to invoice" };
}

export function InvoiceMark({ inv }: { inv: { Status: string } }) {
  return inv.Status === "Void" ? <SheetMark text="Void" tone="stopped" /> : <SheetMark text="Issued" tone="done" />;
}

/** "−₹x credited · CRN-…" under an invoice's amount, opening its credit note. */
export function CreditedNote({ inv }: { inv: { CreditedAmount?: number; CreditNoteId?: number | null; CreditNoteNos?: string | null } }) {
  if (!(Number(inv.CreditedAmount) > 0)) return null;
  return (
    <Link to={`/crm/credit-notes?id=${inv.CreditNoteId}`} onClick={(e) => e.stopPropagation()}
      className="block mt-1 text-[0.6875rem] font-normal underline underline-offset-2 tabular-nums" title="Credit notes against this invoice">
      −{fmtMoney(inv.CreditedAmount)} credited{inv.CreditNoteNos ? ` · ${inv.CreditNoteNos}` : ""}
    </Link>
  );
}
