// Credit Notes — the GST document for money given back to a CRM customer
// (backend services/crmGstNotes.js, issued when a refund's payout is approved):
//   on invoices   — reduces an invoice (s.34), declare by 30 Nov after its FY
//   on advances   — money never invoiced (the legal form: refund voucher, Rule 51)
//   past deadline — no credit note possible; the buyer's GST-paid certificate
// Raised without a refund too: an invoice reduced (discount, area change, price
// correction) and the money kept — approved, it lowers the booking and moves
// anything already paid above the new amount to the customer's account.
// Cancelling goes through its own approval; the number is kept. "To issue" lists paid
// refunds that carried GST but have none yet.
import React from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { GridToneMark } from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";

export const API = "/api/crm/refunds";
export const inr = (n: any) => fmtRupees(Number(n || 0));
export const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
export const formatSac = (hsn: any) => {
  if (!hsn) return "9954";
  const s = String(hsn).trim();
  const m = s.match(/^(\d{4,6})/);
  return m ? m[1] : s;
};
export const DIALOG = "rounded-none p-5 gap-4";

export async function getJson(url: string, init?: RequestInit) {
  const r = await fetchWithAuth(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "The request could not be completed. Please try again.");
  return j;
}

export type Kind = "invoice" | "advance" | "barred" | "cancelled" | "request";
export const kindOf = (n: any): Kind =>
  ["Draft", "Pending", "Rejected"].includes(n.Status)
    ? "request"
    : n.Status === "Cancelled"
    ? "cancelled"
    : n.Status === "TimeBarred"
    ? "barred"
    : n.DocType === "CreditNote"
    ? "invoice"
    : "advance";

export const REASON_LABEL: Record<string, string> = {
  Discount: "Discount",
  AreaChange: "Area change",
  PriceCorrection: "Price correction",
  Other: "Other",
};
export const REQ_LABEL: Record<string, string> = {
  Draft: "Being prepared",
  Pending: "Waiting for approval",
  Rejected: "Sent back",
};
export const KIND: Record<Kind, { label: string; short: string }> = {
  invoice: { label: "Credit note — on invoice", short: "On invoice" },
  advance: { label: "Credit note — on advance (refund voucher)", short: "On advance" },
  barred: { label: "Past deadline — GST paid certificate", short: "Past deadline" },
  cancelled: { label: "Cancelled", short: "Cancelled" },
  request: { label: "Credit note — invoice reduced (pending)", short: "Awaiting approval" },
};
export const TABS = [
  ["all", "All"],
  ["request", "Awaiting approval"],
  ["invoice", "On invoices"],
  ["advance", "On advances"],
  ["barred", "Past deadline"],
  ["cancelled", "Cancelled"],
  ["pending", "To issue"],
] as const;
export type Tab = (typeof TABS)[number][0];
export type KindCounts = Partial<Record<Kind, { count: number; gst: number; amount: number; dueSoon: number }>>;

/** A document's state as a mark: issued done, waiting / past deadline waiting, sent back or cancelled stopped. */
export function NoteMark({ n }: { n: any }) {
  const s = n.Status;
  if (s === "Issued") return <GridToneMark text="Issued" tone="done" />;
  if (s === "Cancelled") return <GridToneMark text="Cancelled" tone="stopped" />;
  if (s === "Rejected") return <GridToneMark text="Sent back" tone="stopped" />;
  if (s === "TimeBarred") return <GridToneMark text="Past deadline" tone="waiting" />;
  return <GridToneMark text={REQ_LABEL[s] || s} tone="waiting" />;
}

/** Days to the declare-by date of a credit note on an invoice. */
export function DeadlineNote({ n }: { n: any }) {
  if (kindOf(n) !== "invoice" || !n.DeadlineDate) return null;
  const days = Math.ceil((new Date(n.DeadlineDate).getTime() - Date.now()) / 864e5);
  return (
    <div className={`mt-1 text-[0.6875rem] tabular-nums ${days < 0 ? "text-destructive font-semibold" : days <= 30 ? "font-semibold" : "text-muted-foreground"}`}>
      {days < 0 ? `Passed ${day(n.DeadlineDate)}` : `Declare by ${day(n.DeadlineDate)} · ${days}d`}
    </div>
  );
}
