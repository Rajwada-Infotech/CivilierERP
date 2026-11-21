// Every CRM list the app shows, in one place: its name and group as the web's CRM menu has them
// (src/components/layout/sidebars/CrmSidebar.ts), the page rights that show it (the same keys the server route
// checks), the route the web page reads, and how one row reads on a card. CrmRegisterScreen draws any of them;
// CrmHubScreen lists the ones the signed-in person may open. Add a list here and it appears in both.
import type { Row } from "@/api/crmApi";
import { fmtDate, joinDot, money } from "./ui";

export type CrmGroup = "Buyers & Bookings" | "Finance" | "Legal & Possession" | "After-Sales";
export const CRM_GROUPS: CrmGroup[] = ["Buyers & Bookings", "Finance", "Legal & Possession", "After-Sales"];

/** Where a card goes when tapped. */
export type CrmOpen =
  | { to: "booking"; bookingId: number; title: string }
  | { to: "customer"; customerId: number; title: string }
  | { to: "document"; path: string; name: string };

export interface CrmRegister {
  key: string;
  label: string;
  group: CrmGroup;
  /** Shown to anyone with a right on any of these pages (the server route's own rule). */
  pages: string[];
  path: string;
  /** The server pages this list: the search goes to the server (?search=) and the first 200 rows come back. */
  serverSearch?: boolean;
  rows: (body: any) => Row[];
  id: (r: Row) => string;
  title: (r: Row) => string;
  sub: (r: Row) => string;
  status?: (r: Row) => string | null | undefined;
  amount?: (r: Row) => { label: string; value: string } | null;
  lines?: (r: Row) => (string | null | undefined | false)[];
  /** Searched on the phone, for lists the server sends whole. */
  searchIn?: (r: Row) => unknown[];
  open?: (r: Row) => CrmOpen | null;
  empty: string;
}

const list = (b: any): Row[] => (Array.isArray(b) ? b : []);
const unitOf = (r: Row) => joinDot(r.ProjectName, [r.BlockName, r.UnitNo].filter(Boolean).join(" / "));
const toBooking = (r: Row): CrmOpen | null =>
  r.BookingId ? { to: "booking", bookingId: Number(r.BookingId), title: r.BookingNo || "Booking" } : null;
const buyerSearch = (r: Row) => [r.ApplicantName, r.CustomerName, r.Mobile, r.BookingNo, r.UnitNo, r.ProjectName];
const plural = (n: unknown, word: string) => `${Number(n) || 0} ${word}${Number(n) === 1 ? "" : "s"}`;
const stepName = (s: any) => (s == null ? "" : typeof s === "string" ? s : s.label ?? s.name ?? s.title ?? "");

export const CRM_REGISTERS: CrmRegister[] = [
  // ── Buyers & Bookings ──────────────────────────────────────────────────────
  {
    key: "leads", label: "Leads", group: "Buyers & Bookings", pages: ["crm-leads"], path: "/api/crm/leads",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName || r.LeadUid, sub: (r) => joinDot(r.LeadUid, r.Mobile),
    lines: (r) => [
      joinDot(r.PropertyType, r.BhkPreference, r.PreferredLocation),
      r.SalespersonName && `Salesperson: ${r.SalespersonName}`,
      r.CustomerNo && `Customer ${r.CustomerNo}`,
    ],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.LeadUid, r.CustomerNo],
    open: (r) => (r.CustomerId ? { to: "customer", customerId: Number(r.CustomerId), title: r.CustomerName } : null),
    empty: "No leads handed over to the CRM.",
  },
  {
    key: "customers", label: "Customers", group: "Buyers & Bookings", pages: ["crm-customers"], path: "/api/crm/customers",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.CustomerNo, r.Mobile),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    lines: (r) => [String(r.ProjectNames ?? "").split("|").filter(Boolean).join(", "), joinDot(r.PermanentCity, r.Email)],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.CustomerNo, r.Email, r.PanNo, r.ProjectNames],
    open: (r) => ({ to: "customer", customerId: Number(r.Id), title: r.CustomerName }),
    empty: "No customers yet.",
  },
  {
    key: "applications", label: "Applications", group: "Buyers & Bookings", pages: ["crm-applications"], path: "/api/crm/applications",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.ApplicationNo, r.Mobile),
    status: (r) => r.Status,
    amount: (r) => (r.BookingAmount ? { label: "Booking amount", value: money(r.BookingAmount) } : null),
    lines: (r) => [
      joinDot(r.InterestedProject, r.InterestedUnit || r.PlotNames),
      joinDot(r.PropertyType, r.BhkPreference, r.DateOfApply && `Applied ${fmtDate(r.DateOfApply)}`),
    ],
    searchIn: (r) => [r.ApplicantName, r.Mobile, r.ApplicationNo, r.InterestedProject, r.InterestedUnit, r.Status],
    open: (r) => (r.CustomerId ? { to: "customer", customerId: Number(r.CustomerId), title: r.ApplicantName } : null),
    empty: "No applications yet.",
  },
  {
    key: "bookings", label: "Bookings", group: "Buyers & Bookings", pages: ["crm-bookings"], path: "/api/crm/bookings",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.BookingNo, sub: unitOf,
    status: (r) => r.Status,
    amount: (r) => ({ label: "Total", value: money(r.GrandTotal ?? r.TotalValue) }),
    lines: (r) => [joinDot(r.UnitType, r.AreaSqFt && `${r.AreaSqFt} sq ft`, r.BookingDate && `Booked ${fmtDate(r.BookingDate)}`)],
    searchIn: (r) => [r.BookingNo, r.UnitNo, r.BlockName, r.ProjectName, r.Status],
    open: (r) => ({ to: "booking", bookingId: Number(r.Id), title: r.BookingNo }),
    empty: "No bookings yet.",
  },
  {
    key: "welcome-calls", label: "Welcome Calls", group: "Buyers & Bookings", pages: ["crm-welcome-calls"], path: "/api/crm/welcome-calls",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, r.UnitNo),
    status: (r) => r.Outcome,
    lines: (r) => [
      joinDot(`Called ${fmtDate(r.CallDate)}`, r.CalledByName),
      r.NextCallDate && `Next call ${fmtDate(r.NextCallDate)}`,
      r.Notes,
    ],
    searchIn: (r) => [...buyerSearch(r), r.Outcome, r.CalledByName],
    open: toBooking, empty: "No welcome calls logged.",
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    key: "demands", label: "Demands", group: "Finance", pages: ["crm-payments"], path: "/api/crm/payments/demands",
    rows: (b) => list(b?.demands), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, r.UnitNo),
    status: (r) => (r.IsOverdue && r.DemandStatus !== "Paid" ? "Overdue" : r.DemandStatus),
    amount: (r) => ({ label: "Demand", value: money(r.AmountDue) }),
    lines: (r) => [
      joinDot(`${r.MilestoneNo}. ${r.MilestoneName}`, r.Percent && `${r.Percent}%`),
      joinDot(r.DueDate && `Due ${fmtDate(r.DueDate)}`, r.DemandNo, r.IsOverdue && r.DaysOverdue && `${r.DaysOverdue} days late`),
      r.DemandStatus !== "Paid" && Number(r.Missing) > 0 && `Still to collect ${money(r.Missing)}`,
    ],
    searchIn: (r) => [...buyerSearch(r), r.MilestoneName, r.DemandNo, r.DemandStatus],
    open: toBooking, empty: "No demands.",
  },
  {
    key: "money-receipts", label: "Money Receipts", group: "Finance", pages: ["crm-money-receipts"], path: "/api/crm/money-receipts", serverSearch: true,
    rows: (b) => list(b?.rows), id: (r) => String(r.Id),
    title: (r) => r.ReceiptNo, sub: (r) => joinDot(r.ApplicantName, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: "Amount", value: money(r.Amount) }),
    lines: (r) => [
      joinDot(fmtDate(r.ReceivedDate), r.PaymentMode, r.ChequeNo || r.TransactionRef),
      r.BouncedReason ? `Bounced: ${r.BouncedReason}` : r.RPRejectionNote && `Sent back: ${r.RPRejectionNote}`,
    ],
    open: (r) => ({ to: "document", path: `/api/crm/money-receipts/${r.Id}/pdf`, name: r.ReceiptNo || "Money Receipt" }),
    empty: "No money receipts.",
  },
  {
    key: "on-account", label: "On Account", group: "Finance", pages: ["crm-payments"], path: "/api/crm/payments/on-account", serverSearch: true,
    rows: (b) => list(b?.deposits), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.ReceiptNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: "Available", value: money(r.AvailableBalance) }),
    lines: (r) => [
      joinDot(`Received ${money(r.Amount)}`, `Applied ${money(r.AppliedAmount)}`),
      joinDot(fmtDate(r.ReceivedDate), r.PaymentMode, r.DepositBankName),
    ],
    open: toBooking, empty: "Nothing held on account.",
  },
  // ── Legal & Possession ─────────────────────────────────────────────────────
  {
    key: "possession", label: "Possession & Handover", group: "Legal & Possession",
    pages: ["crm-pre-possession", "crm-possession-notice", "crm-handover"], path: "/api/crm/pre-possession/board", serverSearch: true,
    rows: (b) => list(b?.rows), id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, [r.BlockName, r.UnitNo].filter(Boolean).join(" / ")),
    status: (r) => r.Stage,
    amount: (r) => (Number(r.Balance) > 0 ? { label: "Balance due", value: money(r.Balance) } : null),
    lines: (r) => [
      joinDot(r.CheckStatus && `Checklist ${r.CheckStatus}`, r.NoticeStatus && `Notice ${r.NoticeStatus}`, r.HandoverStatus && `Handover ${r.HandoverStatus}`),
      Number(r.OpenSnags) > 0 && `${plural(r.OpenSnags, "open snag")}`,
    ],
    open: toBooking, empty: "No bookings on the possession board.",
  },
  // ── After-Sales ────────────────────────────────────────────────────────────
  {
    key: "customer-360", label: "Customer 360", group: "After-Sales", pages: ["crm-customer-360"], path: "/api/crm/customer-360",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.CustomerNo, r.Mobile),
    amount: (r) => (Number(r.TotalOutstanding) > 0 ? { label: "Outstanding", value: money(r.TotalOutstanding) } : null),
    lines: (r) => [r.Units, joinDot(plural(r.ActiveBookingCount, "active booking"), `Paid ${money(r.TotalPaid)}`)],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.CustomerNo, r.Units, r.City],
    open: (r) => ({ to: "customer", customerId: Number(r.Id), title: r.CustomerName }),
    empty: "No customers yet.",
  },
  {
    key: "service-tickets", label: "Service Tickets", group: "After-Sales", pages: ["crm-service-tickets"], path: "/api/crm/service-tickets",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.Subject || r.TicketNo, sub: (r) => joinDot(r.TicketNo, r.ApplicantName, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.Category, r.Priority && `${r.Priority} priority`, r.AssigneeName && `With ${r.AssigneeName}`),
      joinDot(`Raised ${fmtDate(r.CreatedAt)}`, r.SlaDueDate && `Due ${fmtDate(r.SlaDueDate)}`, r.RaisedByCustomer && "By customer"),
    ],
    searchIn: (r) => [...buyerSearch(r), r.TicketNo, r.Subject, r.Category, r.Status],
    open: toBooking, empty: "No service tickets.",
  },
  {
    key: "construction-updates", label: "Construction Updates", group: "After-Sales", pages: ["crm-construction-updates"], path: "/api/crm/construction-updates/progress",
    rows: (b) => list(b?.projects), id: (r) => String(r.projectId),
    title: (r) => r.projectName,
    sub: (r) => (r.hasDpr ? `${r.done ?? 0} of ${r.steps ?? 0} steps done` : "No site progress recorded yet"),
    amount: (r) => (r.hasDpr ? { label: "Complete", value: `${Math.round(Number(r.pct) || 0)}%` } : null),
    lines: (r) => [
      stepName(r.now) && `Now: ${stepName(r.now)}`,
      stepName(r.next) && `Next: ${stepName(r.next)}`,
      Number(r.late) > 0 && `${r.late} running late`,
    ],
    searchIn: (r) => [r.projectName], empty: "No projects.",
  },
];

export const registerByKey = (key: string) => CRM_REGISTERS.find((r) => r.key === key);
