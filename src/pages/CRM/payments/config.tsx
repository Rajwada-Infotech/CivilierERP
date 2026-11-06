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

/** Rupees as people read them at a glance: Cr and L; the exact figure goes on hover. */
export const fmtShort = (n: number | null | undefined) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1e7) return `\u20b9${(v / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `\u20b9${(v / 1e5).toFixed(2)} L`;
  return fmtRupees(Math.round(v));
};

export const fmtDate = (s: string | null | undefined) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 10);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const pct = (paid: number, due: number) => (due > 0 ? Math.min(100, Math.round((paid / due) * 100)) : 0);

/** Today in local time (toISOString gave yesterday before 05:30 IST). */
export const todayStr = () => localDay();

/**
 * A milestone's money stage, as the server decides it (crmPayments.js GET
 * /booking/:id, MoneyStage) — the one set of words the cards and rows use.
 */
export const MONEY_STAGE: Record<string, { label: string; tone: "done" | "waiting"; hint: string }> = {
  Adjusted: { label: "Paid", tone: "done", hint: "Adjusted to this milestone" },
  Verified: { label: "Covered on account", tone: "done", hint: "Approved by Finance and held On Account. It is adjusted to the milestones once the full booking amount is received" },
  InVerification: { label: "Pending with Finance", tone: "waiting", hint: "Payment entered and waiting for Finance approval" },
  Recorded: { label: "Not sent to Finance", tone: "waiting", hint: "Entered on the application or a Money Receipt. It is sent to Finance when the Director approves the booking" },
};

/** Whole days past its due date (a milestone due today is 0, not late). */
export const daysLate = (m: any) => {
  if (!m.DueDate) return 0;
  const due = new Date(`${String(m.DueDate).slice(0, 10)}T00:00:00`).getTime();
  const today = new Date(`${todayStr()}T00:00:00`).getTime();
  return Math.round((today - due) / 86_400_000);
};

/** Past its due date with no money for it, verified or entered. */
export const isOverdue = (m: any) => m.MoneyStage == null && m.Status === "Pending" && daysLate(m) > 0;

/** The funding ribbon's fills: one set of colours and words for the bars and their legend. */
export const RIBBON = {
  settled: { label: "Adjusted", cls: "bg-emerald-600 dark:bg-emerald-500" },
  held: { label: "On account", cls: "bg-teal-400 dark:bg-teal-400" },
  finance: { label: "Pending with Finance", cls: "bg-amber-300 dark:bg-amber-400/70" },
  recorded: { label: "Not sent to Finance", cls: "bg-sky-400" },
  overdue: { label: "Overdue", cls: "bg-rose-200 dark:bg-rose-500/30" },
  late: { label: "Overdue", cls: "bg-rose-500" },
  open: { label: "Upcoming", cls: "bg-slate-200 dark:bg-slate-600/60" },
  waived: { label: "Waived", cls: "bg-slate-300/60 dark:bg-slate-500/30" },
} as const;

/** What a milestone's amount is made of. The server worked out the money against it (crmOnAccountCoverage.js). */
export const milestoneFill = (m: any) => {
  const due = Number(m.AmountDue) || 0;
  const settled = Math.min(due, Number(m.AmountPaid) || 0);
  const held = Number(m.HeldOnAccount) || 0;
  const finance = Number(m.WithFinanceCover) || 0;
  const recorded = Number(m.RecordedCover) || 0;
  return { due, settled, held, finance, recorded, waived: m.Status === "Waived", missing: Math.max(0, Math.round((due - settled - held - finance - recorded) * 100) / 100) };
};

/** Where a payment's money is now, on the money trail: the server decides the stage (getBookingMoneyTrail). */
export const TRAIL_STAGE: Record<string, { label: string; tone: "done" | "waiting" | "stopped" | "moving"; hint: string }> = {
  recorded: { label: "Not sent to Finance", tone: "waiting", hint: MONEY_STAGE.Recorded.hint },
  finance: { label: "Pending with Finance", tone: "waiting", hint: MONEY_STAGE.InVerification.hint },
  held: { label: "On account", tone: "moving", hint: MONEY_STAGE.Verified.hint },
  settled: { label: "Adjusted", tone: "done", hint: MONEY_STAGE.Adjusted.hint },
  split: { label: "Part adjusted", tone: "moving", hint: "Part adjusted, part on account or part refunded: the figures on this line show how much" },
  out: { label: "Refunded / reserved", tone: "stopped", hint: "Refunded to the customer, or reserved for a refund or transfer" },
  adjustment: { label: "System entry", tone: "moving", hint: "A credit note or cancellation hold. It is not a customer payment, so it is not counted as received" },
  returned: { label: "Rejected by Finance", tone: "stopped", hint: "Rejected by Finance. It is not counted as received" },
  bounced: { label: "Bounced", tone: "stopped", hint: "This payment bounced. It is not counted as received" },
};

/** The first milestone money is still missing on, in plan order. */
export const nextOpenMilestone = (plan: any[]) => plan.find((m) => m.Status !== "Waived" && m.Status !== "Paid" && milestoneFill(m).missing > 0) ?? null;

export interface LedgerRow {
  BookingId: number; ApplicationId: number; BookingNo: string; BookingStatus: string; ApplicantName: string; Mobile: string | null;
  UnitNo: string | null; ProjectName: string | null; AssignedToName: string | null; Closed: number;
  TotalDue: number; Settled: number; Held: number; Collected: number; WithFinance: number; Recorded: number; ToCollect: number; CollectedPct: number;
  OverdueAmount: number; OverdueCount: number; DaysLate: number; PlanCount: number; plan?: any[];
  A_soon: number; A_d30: number; A_d60: number; A_d90: number; A_d90p: number;
}
export type DeskTab = "everything" | "all" | "attention" | "overdue" | "soon" | "finance" | "recorded" | "collected" | "closed";
export interface LedgerSummary {
  counts: Record<DeskTab, number>;
  totalDue: number; settled: number; held: number; withFinance: number; recorded: number; toCollect: number; overdue: number;
  ages: { key: string; label: string; amount: number; count: number }[];
}
export async function fetchLedger(params: URLSearchParams): Promise<{ rows: LedgerRow[]; total: number }> {
  const r = await fetchWithAuth(`${API}/ledger?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || `Could not load the bookings (${r.status}).`);
  return { rows: d?.rows || [], total: d?.total || 0 };
}
export async function fetchLedgerSummary(params: URLSearchParams): Promise<LedgerSummary> {
  const r = await fetchWithAuth(`${API}/ledger/summary?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || `Could not load the figures (${r.status}).`);
  return d;
}
/** Every row under the same search and filters, for the export. */
export async function fetchLedgerExport(params: URLSearchParams): Promise<LedgerRow[]> {
  const r = await fetchWithAuth(`${API}/ledger?${params}`);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || `Could not export the bookings (${r.status}).`);
  return Array.isArray(d) ? d : [];
}

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
