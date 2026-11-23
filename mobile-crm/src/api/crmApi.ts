// The CRM, read on the phone: every call is a route the web CRM pages already use (backend/routes/crm*.js), so the
// figures, the rules and who may see what (each route's page right) stay in one place — the server.
import { fetchWithAuth } from "@/services/fetchWithAuth";

/** A row as the server sends it: the screens read the same column names the web pages read. */
export type Row = Record<string, any>;

export async function crmGet<T = any>(path: string): Promise<T> {
  const res = await fetchWithAuth(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "Could not load this page.");
  }
  return res.json();
}

/** A CRM action (POST / PUT / PATCH / DELETE) on the web's own route: the server's message on failure. */
export async function crmSend<T = any>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: object): Promise<T> {
  const res = await fetchWithAuth(path, { method, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error || `The request could not be completed (${res.status}).`);
  return data as T;
}

/** One booking: unit, buyer, milestones, welcome calls, agreement, stage (crmBookings.js GET /:id). */
export const getBooking = (id: number) => crmGet<{
  booking: Row; milestones: Row[]; welcomeCalls: Row[]; agreement: Row | null; customer: Row | null; coApplicants?: Row[];
  paymentSummary: { totalDue: number; totalPaid: number; balance: number } | null; stageState: Row | null;
}>(`/api/crm/bookings/${id}`);

/** The booking's money, as the Payment Milestones page shows it (crmPayments.js GET /booking/:id). */
export const getBookingPayments = (id: number) => crmGet<{
  booking: Row; milestones: Row[];
  summary: { totalDue: number; totalPaid: number; balance: number; waivedDue: number; waivedCount: number; overdue: number };
  money: Row;
}>(`/api/crm/payments/booking/${id}`);

/** The booking's journey, step by step (crmBookings.js GET /:id/lifecycle). */
export const getBookingLifecycle = (id: number) => crmGet<{
  steps: { key: string; label: string; status: string; date: string | null; blockedBy?: string | null; todo?: string | null }[];
  current: string | null; closed: boolean;
}>(`/api/crm/bookings/${id}/lifecycle`);

/** Everything about one customer (crmCustomer360.js GET /:id). */
export const getCustomer360 = (id: number) => crmGet<{
  customer: Row; summary: Row; applications: Row[]; bookings: Row[]; calls: Row[]; serviceTickets: Row[]; cancellations: Row[];
}>(`/api/crm/customer-360/${id}`);
