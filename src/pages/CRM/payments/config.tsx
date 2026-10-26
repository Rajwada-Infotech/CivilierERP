// Shared by Payment Milestones and its parts: the APIs, payment modes, money / date formats, and the fetches.
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { localDay } from "../salesDeed/config";

export const API = "/api/crm/payments";
export const BKG_API = "/api/crm/bookings";
export const CUSTOMER_BANK_API = "/api/crm/customer-bank-details";
export const PROJECT_BANK_API = "/api/crm/project-banks";

export const PAY_MODES = ["Cash", "Cheque", "NEFT", "RTGS", "UPI", "Home Loan", "Other"];
// Modes where the money demonstrably came out of a bank account, so asking which one is meaningful. Mirrors
// ReceivedPayment.tsx's `needsBankRef`.
const MODES_WITH_BANK = ["Cheque", "NEFT", "RTGS", "UPI", "Home Loan"];
export const modeHasBank = (mode: string) => MODES_WITH_BANK.includes(mode);

/** Rupees with paise when there are any; "—" for none. */
export const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const pct = (paid: number, due: number) => (due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0);

/** Today in local time (toISOString gave yesterday before 05:30 IST). */
export const todayStr = () => localDay();

/** Is this milestone past its due date and still pending? */
export const isOverdue = (m: any) => m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < new Date();

export async function fetchMilestones(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  // Unlike the supporting fetches below, this one drives the page's main content: a failure must not read as
  // "no milestones" on a money-tracking page, so it throws and React Query shows the error.
  const r = await fetchWithAuth(`${API}/booking/${bookingId}`);
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || `Failed to load milestones (${r.status})`);
  }
  return r.json();
}

// The booking picker is scoped server-side (company / project / block and a booking-no search) so it only ever
// renders a workable subset.
export interface BookingPickerScope { companyId: string; projectId: string; blockId: string; search: string }
export async function fetchBookings(scope?: BookingPickerScope): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    if (scope?.companyId) params.set("companyId", scope.companyId);
    if (scope?.projectId) params.set("projectId", scope.projectId);
    if (scope?.blockId) params.set("blockId", scope.blockId);
    if (scope?.search) params.set("search", scope.search);
    const qs = params.toString();
    const r = await fetchWithAuth(`${BKG_API}${qs ? `?${qs}` : ""}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
// The booking's Money Receipts: a token captured at intake shows here before Finance approves it (Collected would
// otherwise read ₹0 and the whole balance red).
export async function fetchMoneyReceipts(bookingId: string): Promise<any[]> {
  if (!bookingId) return [];
  try {
    const r = await fetchWithAuth(`/api/crm/money-receipts?bookingId=${bookingId}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
export async function fetchOnAccount(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${API}/booking/${bookingId}/on-account`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
export async function fetchProjectBanks(projectId?: number | null): Promise<any[]> {
  if (projectId == null) return [];
  try {
    const r = await fetchWithAuth(`${PROJECT_BANK_API}/for-project/${projectId}`);
    return r.ok ? r.json() : [];
  } catch { return []; }
}
export async function fetchCustomerBank(bookingId: string): Promise<any> {
  if (!bookingId) return null;
  try {
    const r = await fetchWithAuth(`${CUSTOMER_BANK_API}/booking/${bookingId}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
