// Every CRM list the app shows, in one place: its name and group as the web's CRM menu has them
// (src/components/layout/sidebars/CrmSidebar.ts), the page rights that show it (the same keys the server route
// checks), the route the web page reads, and how one row reads on a card. CrmRegisterScreen draws any of them;
// CrmHubScreen lists the ones the signed-in person may open. Add a list here and it appears in both.
import type { Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import {
  ArrowRightLeft, Award, Ban, Building2, Car, ClipboardList, FileCheck2, FileMinus, FilePenLine, FileText,
  Grid3x3, Handshake, HardHat, KeyRound, ListChecks, PhoneCall, PhoneIncoming, Receipt, ReceiptIndianRupee,
  Repeat2, ScrollText, ShieldCheck, Ticket, Undo2, UserCog, UserRound, Users, Wallet, type LucideIcon,
} from "lucide-react-native";
import { fmtDate, joinDot, money } from "./ui";

export type CrmGroup = "Buyers & Bookings" | "Units & Parking" | "Finance" | "Legal & Possession" | "Brokerage" | "After-Sales" | "Resale";
export const CRM_GROUPS: CrmGroup[] = ["Buyers & Bookings", "Units & Parking", "Finance", "Legal & Possession", "Brokerage", "After-Sales", "Resale"];

/** Where a card goes when tapped. */
export type CrmOpen =
  | { to: "booking"; bookingId: number; title: string }
  | { to: "customer"; customerId: number; title: string }
  | { to: "ticket"; ticketId: number }
  | { to: "application"; applicationId: number }
  | { to: "document"; path: string; name: string }
  | { to: "construction-updates"; projectId: number; projectName: string }
  | { to: "oc-cc-board" }
  | { to: "cancellation"; cancellationId: number; title: string }
  | { to: "refund"; refundId: number; title: string }
  | { to: "invoice"; invoiceId: number; title: string };

/** Welcome-call outcomes and their words — the web's (src/pages/CRM/welcomeCalls/config.tsx OUTCOMES / OUTCOME_LABEL),
 * the server's list (crmWelcomeCalls.js OUTCOMES). */
export const WELCOME_OUTCOMES = ["Welcomed", "NotReachable", "RequestedCallback", "VoiceMail", "Busy", "SwitchedOff"] as const;
export const OUTCOME_LABEL: Record<string, string> = {
  Welcomed: "Welcomed", NotReachable: "Not reachable", RequestedCallback: "Callback asked", VoiceMail: "Voicemail", Busy: "Busy", SwitchedOff: "Switched off",
};

/** A key on the card that starts a job there (Log call), for staff with that right on one of the pages. */
export interface CardAction {
  label: string; pages: string[]; right: "create" | "edit"; when?: (r: Row) => boolean;
  to: (r: Row) => { screen: "CrmWelcomeCall"; params: { bookingId: number; title?: string } } | { screen: "CrmApplicationForm"; params: { applicationId: number } };
}

/** The list's "new" key (the web list's own New button), for those with the right. */
export interface CreateAction { label: string; pages: string[]; screen: "CrmCustomerForm" | "CrmApplicationForm" }

export interface CrmRegister {
  createAction?: CreateAction;
  key: string;
  label: string;
  /** What the list holds, in a line — under its name on the CRM tab and in the Menu. */
  about: string;
  /** Its icon on the CRM tab and in the Menu. */
  icon: LucideIcon;
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
  /** The buyer's mobile, for the card's Call / WhatsApp keys. Default: the row's Mobile. */
  mobile?: (r: Row) => string | null | undefined;
  /** Initials text for an avatar shown on the card, e.g. the customer's name. */
  avatar?: (r: Row) => string | null | undefined;
  /** The row's date, for the period filter and the date sort (newest first). */
  dateOf?: (r: Row) => string | null | undefined;
  /** The row's amount, for the amount sort. */
  amountOf?: (r: Row) => number | null | undefined;
  /** The row's project, for the project filter. Default: the row's ProjectName. */
  projectOf?: (r: Row) => string | null | undefined;
  cardAction?: CardAction;
  /** A second list shown on the same page behind a switch (Welcome Calls: "To call" / "History"), so the CRM page
   * lists one item for both. The paired list is not listed on its own. */
  pair?: { key: string; labels: [string, string] };
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
    key: "leads", about: "Handed over from Sales Automation", icon: UserRound, label: "Leads", group: "Buyers & Bookings", pages: ["crm-leads"], path: "/api/crm/leads",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName || r.LeadUid, sub: (r) => joinDot(r.LeadUid, r.Mobile),
    lines: (r) => [
      joinDot(r.PropertyType, r.BhkPreference, r.PreferredLocation),
      r.SalespersonName && `Salesperson: ${r.SalespersonName}`,
      r.CustomerNo && `Customer ${r.CustomerNo}`,
    ],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.LeadUid, r.CustomerNo],
    open: (r) => (r.CustomerId ? { to: "customer", customerId: Number(r.CustomerId), title: r.CustomerName } : null),
    dateOf: (r) => r.DateGenerated, projectOf: () => null,
    empty: "No leads handed over to the CRM.",
  },
  {
    createAction: { label: "New customer", pages: ["crm-customers"], screen: "CrmCustomerForm" },
    key: "customers", about: "Everyone who has applied or booked", icon: Users, label: "Customers", group: "Buyers & Bookings", pages: ["crm-customers"], path: "/api/crm/customers",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.CustomerNo, r.Mobile),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    lines: (r) => [String(r.ProjectNames ?? "").split("|").filter(Boolean).join(", "), joinDot(r.PermanentCity, r.Email)],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.CustomerNo, r.Email, r.PanNo, r.ProjectNames],
    open: (r) => ({ to: "customer", customerId: Number(r.Id), title: r.CustomerName }),
    dateOf: (r) => r.CreatedAt, projectOf: () => null,
    empty: "No customers yet.",
  },
  {
    createAction: { label: "New application", pages: ["crm-applications"], screen: "CrmApplicationForm" },
    key: "applications", about: "Applications for a unit or plot", icon: FileCheck2, label: "Applications", group: "Buyers & Bookings", pages: ["crm-applications"], path: "/api/crm/applications?includeConverted=1",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.ApplicationNo, r.Mobile),
    status: (r) => r.Status,
    amount: (r) => (r.BookingAmount ? { label: "Booking amount", value: money(r.BookingAmount) } : null),
    lines: (r) => [
      joinDot(r.InterestedProject, r.InterestedUnit || r.PlotNames),
      joinDot(r.PropertyType, r.BhkPreference, r.DateOfApply && `Applied ${fmtDate(r.DateOfApply)}`),
    ],
    searchIn: (r) => [r.ApplicantName, r.Mobile, r.ApplicationNo, r.InterestedProject, r.InterestedUnit, r.Status],
    // An application opens itself (its steps); once it has a booking, the booking.
    open: (r) => (r.BookingId ? { to: "booking", bookingId: Number(r.BookingId), title: r.BookingNo || r.ApplicantName } : { to: "application", applicationId: Number(r.Id) }),
    dateOf: (r) => r.DateOfApply, amountOf: (r) => r.BookingAmount, projectOf: (r) => r.InterestedProject,
    empty: "No applications yet.",
  },
  {
    key: "bookings", about: "Booked units and plots", icon: ClipboardList, label: "Bookings", group: "Buyers & Bookings", pages: ["crm-bookings"], path: "/api/crm/bookings",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.BookingNo, sub: unitOf,
    status: (r) => r.Status,
    amount: (r) => ({ label: "Total", value: money(r.GrandTotal ?? r.TotalValue) }),
    lines: (r) => [joinDot(r.UnitType, r.AreaSqFt && `${r.AreaSqFt} sq ft`, r.BookingDate && `Booked ${fmtDate(r.BookingDate)}`)],
    searchIn: (r) => [r.BookingNo, r.UnitNo, r.BlockName, r.ProjectName, r.Status],
    open: (r) => ({ to: "booking", bookingId: Number(r.Id), title: r.BookingNo }),
    dateOf: (r) => r.BookingDate, amountOf: (r) => r.GrandTotal ?? r.TotalValue,
    empty: "No bookings yet.",
  },
  {
    // The web's call queue (crmWelcomeCalls.js GET /queue): approved bookings still waiting for their welcome call.
    key: "welcome-calls", about: "Approved bookings waiting for their call", icon: PhoneCall, label: "Welcome Calls", group: "Buyers & Bookings", pages: ["crm-welcome-calls"], path: "/api/crm/welcome-calls/queue",
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, r.UnitNo),
    status: (r) => (r.LastOutcome ? OUTCOME_LABEL[r.LastOutcome] ?? r.LastOutcome : "Not called"),
    lines: (r) => [
      r.LastCallDate ? `Last call ${fmtDate(r.LastCallDate)}` : r.BookingDate && `Booked ${fmtDate(r.BookingDate)}`,
      r.NextCallDate && `Next call ${fmtDate(r.NextCallDate)}`,
      Number(r.ConsecutiveNonReached) > 1 && `${r.ConsecutiveNonReached} calls in a row not reached`,
    ],
    dateOf: (r) => r.NextCallDate || r.BookingDate,
    searchIn: (r) => [...buyerSearch(r), r.LastOutcome],
    open: toBooking,
    cardAction: { label: "Log call", pages: ["crm-welcome-calls"], right: "create", to: (r) => ({ screen: "CrmWelcomeCall", params: { bookingId: Number(r.BookingId), title: r.ApplicantName } }) },
    pair: { key: "call-history", labels: ["To call", "History"] },
    empty: "No bookings waiting for a welcome call.",
  },
  {
    key: "customer-bank-details", about: "KYC and bank details per booking", icon: FileText, label: "Customer Bank Details", group: "Buyers & Bookings", pages: ["crm-customer-bank-details"], path: "/api/crm/customer-bank-details",
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.KycStatus || r.BookingStatus,
    lines: (r) => [
      r.Mobile,
      r.BankName && joinDot(r.BankName, r.BranchName),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Mobile, r.BankName],
    open: (r) => (r.BookingId ? { to: "booking", bookingId: Number(r.BookingId), title: r.BookingNo || "Booking" } : null),
    dateOf: (r) => r.CreatedAt,
    empty: "No bank details on file.",
  },
  {
    key: "booking-amendments", about: "Amendments to booking terms", icon: FilePenLine, label: "Booking Amendments", group: "Buyers & Bookings", pages: ["crm-bookings"], path: "/api/crm/booking-amendments",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.AmendmentNo || r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.Status,
    lines: (r) => [
      r.Reason && `Reason: ${r.Reason}`,
      r.CreatedAt && `Requested ${fmtDate(r.CreatedAt)}`,
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.AmendmentNo, r.Status, r.UnitNo, r.ProjectName],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No booking amendments.",
  },
  {
    key: "unit-changes", about: "Requests to swap to a different unit", icon: ArrowRightLeft, label: "Unit Changes", group: "Buyers & Bookings", pages: ["crm-bookings"], path: "/api/crm/bookings/unit-changes",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.RequestNo, r.Mobile),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.SourceUnitName || r.SourceBookingNo, "→", r.TargetUnitName || r.TargetBookingNo),
      r.Reason && `Reason: ${r.Reason}`,
      joinDot(r.SourceProjectName, r.CreatedAt && `Requested ${fmtDate(r.CreatedAt)}`),
    ],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.RequestNo, r.SourceBookingNo, r.TargetBookingNo, r.Status],
    open: (r) => (r.SourceBookingId ? { to: "booking", bookingId: Number(r.SourceBookingId), title: r.SourceBookingNo || "Booking" } : null),
    dateOf: (r) => r.CreatedAt,
    empty: "No unit change requests.",
  },
  {
    key: "call-history", about: "Welcome calls made", icon: PhoneIncoming, label: "Call History", group: "Buyers & Bookings", pages: ["crm-welcome-calls"], path: "/api/crm/welcome-calls",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, r.UnitNo),
    status: (r) => (r.Outcome ? OUTCOME_LABEL[r.Outcome] ?? r.Outcome : null),
    lines: (r) => [
      joinDot(`Called ${fmtDate(r.CallDate)}`, r.CalledByName),
      r.NextCallDate && `Next call ${fmtDate(r.NextCallDate)}`,
      r.Notes,
    ],
    dateOf: (r) => r.CallDate,
    searchIn: (r) => [...buyerSearch(r), r.Outcome, r.CalledByName],
    open: toBooking, empty: "No welcome calls logged.",
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    key: "invoices", about: "Tax invoices raised on bookings", icon: Receipt, label: "Invoices", group: "Finance", pages: ["crm-invoices"], path: "/api/crm/invoices",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.InvoiceNo, sub: (r) => joinDot(r.ApplicantName, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: r.InvoiceType || "Amount", value: money(r.Amount) }),
    lines: (r) => [
      joinDot(r.InvoiceType, r.InvoiceDate && fmtDate(r.InvoiceDate)),
      joinDot(r.ProjectName, r.BookingNo),
    ],
    searchIn: (r) => [r.InvoiceNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.InvoiceType, r.Status],
    open: (r) => ({ to: "invoice" as const, invoiceId: Number(r.Id), title: r.InvoiceNo || "Invoice" }),
    dateOf: (r) => r.InvoiceDate, amountOf: (r) => r.Amount,
    empty: "No invoices.",
  },
  {
    key: "credit-notes", about: "GST credit notes issued to buyers", icon: FileMinus, label: "Credit Notes", group: "Finance", pages: ["crm-refunds"], path: "/api/crm/refunds/gst-notes",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.NoteNo || r.ApplicantName, sub: (r) => joinDot(r.ApplicantName, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => (r.Amount ? { label: "Amount", value: money(r.Amount) } : null),
    lines: (r) => [
      r.NoteDate && `Issued ${fmtDate(r.NoteDate)}`,
      joinDot(r.ProjectName, r.BookingNo),
    ],
    searchIn: (r) => [r.NoteNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.Status],
    open: toBooking, dateOf: (r) => r.NoteDate, amountOf: (r) => r.Amount,
    empty: "No credit notes.",
  },
  {
    key: "refunds", about: "Refund requests and payouts", icon: Undo2, label: "Refunds", group: "Finance", pages: ["crm-refunds"], path: "/api/crm/refunds",
    rows: (b) => (Array.isArray(b) ? b : list(b?.rows)), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.RefundNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: "Net refund", value: money(r.NetAmount ?? r.GrossAmount) }),
    lines: (r) => [
      joinDot(r.GrossAmount && `Gross ${money(r.GrossAmount)}`, r.NetAmount && `Net ${money(r.NetAmount)}`),
      joinDot(r.ProjectName, r.RequestedDate && `Requested ${fmtDate(r.RequestedDate)}`),
    ],
    searchIn: (r) => [r.RefundNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.Status],
    open: (r) => ({ to: "refund" as const, refundId: Number(r.Id), title: r.RefundNo || r.BookingNo || "Refund" }),
    dateOf: (r) => r.RequestedDate, amountOf: (r) => r.NetAmount ?? r.GrossAmount,
    empty: "No refunds.",
  },
  {
    key: "demands", about: "Milestones demanded from buyers", icon: ReceiptIndianRupee, label: "Demands", group: "Finance", pages: ["crm-payments"], path: "/api/crm/payments/demands",
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
    open: toBooking, dateOf: (r) => r.DueDate, amountOf: (r) => r.AmountDue,
    empty: "No demands.",
  },
  {
    key: "money-receipts", about: "Receipts for money received", icon: ListChecks, label: "Money Receipts", group: "Finance", pages: ["crm-money-receipts"], path: "/api/crm/money-receipts", serverSearch: true,
    rows: (b) => list(b?.rows), id: (r) => String(r.Id),
    title: (r) => r.ReceiptNo, sub: (r) => joinDot(r.ApplicantName, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: "Amount", value: money(r.Amount) }),
    lines: (r) => [
      joinDot(fmtDate(r.ReceivedDate), r.PaymentMode, r.ChequeNo || r.TransactionRef),
      r.BouncedReason ? `Bounced: ${r.BouncedReason}` : r.RPRejectionNote && `Sent back: ${r.RPRejectionNote}`,
    ],
    open: (r) => ({ to: "document", path: `/api/crm/money-receipts/${r.Id}/pdf`, name: r.ReceiptNo || "Money Receipt" }),
    dateOf: (r) => r.ReceivedDate, amountOf: (r) => r.Amount,
    empty: "No money receipts.",
  },
  {
    key: "on-account", about: "Payments held before they are adjusted", icon: Wallet, label: "On Account", group: "Finance", pages: ["crm-payments"], path: "/api/crm/payments/on-account", serverSearch: true,
    rows: (b) => list(b?.deposits), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.ReceiptNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => ({ label: "Available", value: money(r.AvailableBalance) }),
    lines: (r) => [
      joinDot(`Received ${money(r.Amount)}`, `Applied ${money(r.AppliedAmount)}`),
      joinDot(fmtDate(r.ReceivedDate), r.PaymentMode, r.DepositBankName),
    ],
    open: toBooking, dateOf: (r) => r.ReceivedDate, amountOf: (r) => r.AvailableBalance,
    empty: "Nothing held on account.",
  },
  // ── Legal & Possession ─────────────────────────────────────────────────────
  {
    key: "legal-milestones", about: "Legal step tracker per booking", icon: ListChecks, label: "Legal Milestones", group: "Legal & Possession", pages: ["crm-legal-milestones"], path: "/api/crm/legal-milestones",
    rows: (b) => (Array.isArray(b) ? b : list(b?.rows)), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.AgreementStatus || r.Status,
    lines: (r) => [
      r.AgreementNo && `Agreement ${r.AgreementNo}`,
      r.CurrentStep && `Step: ${r.CurrentStep}`,
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.AgreementNo, r.ProjectName],
    open: toBooking, dateOf: (r) => r.UpdatedAt || r.CreatedAt,
    empty: "No legal milestone records.",
  },
  {
    key: "agreements", about: "Agreement to sell records", icon: ScrollText, label: "Agreements", group: "Legal & Possession", pages: ["crm-agreements"], path: "/api/crm/agreements",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.AgreementNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => (r.GrandTotal ? { label: "Total", value: money(r.GrandTotal) } : null),
    lines: (r) => [
      joinDot(r.AgreementDate && `Dated ${fmtDate(r.AgreementDate)}`, r.ProjectName),
    ],
    searchIn: (r) => [r.AgreementNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Status],
    open: toBooking, dateOf: (r) => r.AgreementDate, amountOf: (r) => r.GrandTotal,
    empty: "No agreements.",
  },
  {
    key: "noc", about: "No Objection Certificates", icon: ShieldCheck, label: "NOC", group: "Legal & Possession", pages: ["crm-noc"], path: "/api/crm/noc",
    rows: (b) => (Array.isArray(b) ? b : list(b?.rows)), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.NocNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.NocType, r.ProjectName),
    ],
    searchIn: (r) => [r.NocNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.NocType, r.Status, r.ProjectName],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No NOC records.",
  },
  {
    key: "sales-deed", about: "Sale deed and registration records", icon: FileText, label: "Sale Deed", group: "Legal & Possession", pages: ["crm-sales-deed"], path: "/api/crm/sales-deed",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.DeedNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.ProjectName, r.CreatedAt && `Created ${fmtDate(r.CreatedAt)}`),
    ],
    searchIn: (r) => [r.DeedNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Status],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No sale deed records.",
  },
  {
    key: "mutation", about: "Property mutation after sale deed", icon: UserCog, label: "Property Mutation", group: "Legal & Possession", pages: ["crm-mutation"], path: "/api/crm/mutation",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.Status,
    lines: (r) => [
      r.DeedNo && `Deed ${r.DeedNo}`,
      joinDot(r.RegistrationNo && `Reg ${r.RegistrationNo}`, r.DocsRequired && `${r.DocsVerified ?? 0}/${r.DocsRequired} docs`),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.DeedNo, r.RegistrationNo, r.Status],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No mutation records.",
  },
  {
    key: "possession", about: "Checklist, notice and handover", icon: KeyRound, label: "Possession & Handover", group: "Legal & Possession",
    pages: ["crm-pre-possession", "crm-possession-notice", "crm-handover"], path: "/api/crm/pre-possession/board", serverSearch: true,
    rows: (b) => list(b?.rows), id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, [r.BlockName, r.UnitNo].filter(Boolean).join(" / ")),
    status: (r) => r.Stage,
    amount: (r) => (Number(r.Balance) > 0 ? { label: "Balance due", value: money(r.Balance) } : null),
    lines: (r) => [
      joinDot(r.CheckStatus && `Checklist ${r.CheckStatus}`, r.NoticeStatus && `Notice ${r.NoticeStatus}`, r.HandoverStatus && `Handover ${r.HandoverStatus}`),
      Number(r.OpenSnags) > 0 && `${plural(r.OpenSnags, "open snag")}`,
    ],
    open: toBooking, amountOf: (r) => r.Balance,
    empty: "No bookings on the possession board.",
  },
  // ── Units & Parking ────────────────────────────────────────────────────────
  {
    // Opens UnitMatrixScreen (custom nav in CrmHubScreen), not CrmRegisterScreen.
    key: "unit-matrix", about: "All units with availability status", icon: Grid3x3, label: "Unit Matrix", group: "Units & Parking", pages: ["crm-unit-matrix"], path: "/api/unit-matrix",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.UnitName, sub: (r) => joinDot(r.ProjectName, r.BlockName, r.FloorNo != null && `Floor ${r.FloorNo}`),
    status: (r) => !r.IsActive ? "Blocked" : r.LockBookingNo ? "Booked" : r.LockHoldId ? "On Hold" : "Available",
    lines: (r) => [
      joinDot(r.UnitType, r.UnitKind, r.AreaSqFt && `${r.AreaSqFt} sq ft`),
      r.LockBookingNo && `Booking: ${r.LockBookingNo}`,
    ],
    searchIn: (r) => [r.UnitName, r.ProjectName, r.BlockName, r.UnitType, r.UnitKind, r.LockBookingNo],
    open: (r) => (r.LockBookingId ? { to: "booking", bookingId: Number(r.LockBookingId), title: r.LockBookingNo || "Booking" } : null),
    projectOf: (r) => r.ProjectName,
    empty: "No units found.",
  },
  {
    // Opens ParkingMatrixScreen (custom nav in CrmHubScreen), not CrmRegisterScreen.
    key: "parking-matrix", about: "Parking slots with availability status", icon: Car, label: "Parking Matrix", group: "Units & Parking", pages: ["crm-parking-matrix"], path: "/api/parking-matrix",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.SlotNo, sub: (r) => joinDot(r.ProjectName, r.BlockName, r.ParkingType),
    status: (r) => !r.IsActive ? "Blocked" : r.LockBookingNo ? "Booked" : r.LockHoldId ? "On Hold" : "Available",
    lines: (r) => [
      r.LockBookingNo && `Booking: ${r.LockBookingNo}`,
    ],
    searchIn: (r) => [r.SlotNo, r.ProjectName, r.BlockName, r.ParkingType, r.LockBookingNo],
    open: (r) => (r.LockAllotmentBookingId ? { to: "booking", bookingId: Number(r.LockAllotmentBookingId), title: r.LockBookingNo || "Booking" } : null),
    projectOf: (r) => r.ProjectName,
    empty: "No parking slots found.",
  },
  {
    key: "parking-booking", about: "Parking allotted to bookings", icon: Car, label: "Parking Bookings", group: "Units & Parking", pages: ["crm-parking-booking"], path: "/api/crm/parking",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.SlotNo, r.BookingNo, r.ProjectName),
    status: (r) => r.PaymentStatus,
    lines: (r) => [
      joinDot(r.ParkingType || r.CurrentParkingType, r.BlockName),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.SlotNo, r.ProjectName, r.PaymentStatus],
    open: toBooking,
    empty: "No parking allotments.",
  },
  {
    key: "oc-cc", about: "Occupancy and completion certificates by project", icon: Award, label: "OC / CC", group: "Units & Parking", pages: ["crm-oc-cc"], path: "/api/crm/oc-cc",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ProjectName, sub: (r) => joinDot(r.BlockName || "Whole project", r.CertType),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.IssuingAuthority, r.ReceivedDate && `Received ${fmtDate(r.ReceivedDate)}`),
      r.BookingCount && `${r.BookingCount} bookings`,
    ],
    searchIn: (r) => [r.ProjectName, r.BlockName, r.CertType, r.Status, r.IssuingAuthority],
    mobile: () => null,
    empty: "No OC/CC records.",
    open: () => ({ to: "oc-cc-board" as const }),
  },
  // ── Finance (continued) ────────────────────────────────────────────────────
  {
    key: "loan-tracking", about: "Home loan and bank co-ordination", icon: Wallet, label: "Home Loan Tracking", group: "Finance", pages: ["crm-loan-details"], path: "/api/crm/loan-summary",
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.SanctionStatus,
    amount: (r) => (r.LoanAmount ? { label: "Loan amount", value: money(r.LoanAmount) } : null),
    lines: (r) => [
      joinDot(r.BankName, r.BranchName, r.RmName && `RM: ${r.RmName}`),
      joinDot(r.SanctionDate && `Sanctioned ${fmtDate(r.SanctionDate)}`, r.LoanAccountNo),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.BankName, r.SanctionStatus, r.LoanAccountNo],
    open: (r) => (r.BookingId ? { to: "booking", bookingId: Number(r.BookingId), title: r.BookingNo || "Booking" } : null),
    amountOf: (r) => r.LoanAmount,
    empty: "No home loan records.",
  },
  // ── Brokerage ──────────────────────────────────────────────────────────────
  {
    key: "brokerage", about: "Broker commissions on bookings", icon: Handshake, label: "Brokerage", group: "Brokerage", pages: ["crm-brokerage"], path: "/api/crm/brokerage",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.BrokerName || r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.Status,
    amount: (r) => (r.ComputedAmount ? { label: "Commission", value: money(r.ComputedAmount) } : null),
    lines: (r) => [
      r.ApplicantName && `Buyer: ${r.ApplicantName}`,
      joinDot(r.ProjectName, r.BookingNo),
    ],
    searchIn: (r) => [r.BrokerName, r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Status],
    open: toBooking, amountOf: (r) => r.ComputedAmount,
    empty: "No brokerage records.",
  },
  {
    key: "broker-payments", about: "Payments made to brokers", icon: Handshake, label: "Broker Payments", group: "Brokerage", pages: ["crm-brokerage"], path: "/api/crm/brokerage/payments",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.BrokerName || r.BrokerFirm, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.BrokerageStatus,
    amount: (r) => ({ label: "Paid", value: money(r.Amount) }),
    lines: (r) => [
      joinDot(r.PaidDate && fmtDate(r.PaidDate), r.PaymentMode, r.TransactionRef),
      joinDot(r.BrokerFirm, r.ComputedAmount && `Total commission ${money(r.ComputedAmount)}`),
    ],
    searchIn: (r) => [r.BrokerName, r.BrokerFirm, r.BookingNo, r.PaymentMode, r.TransactionRef],
    open: (r) => (r.BookingId ? { to: "booking", bookingId: Number(r.BookingId), title: r.BookingNo || "Booking" } : null),
    dateOf: (r) => r.PaidDate, amountOf: (r) => r.Amount,
    empty: "No broker payments.",
  },
  // ── After-Sales ────────────────────────────────────────────────────────────
  {
    key: "cancellations", about: "Booking cancellation requests", icon: Ban, label: "Cancellations", group: "After-Sales", pages: ["crm-cancellations"], path: "/api/crm/cancellations",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.CancellationNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => (r.RefundAmount ? { label: "Refund amount", value: money(r.RefundAmount) } : null),
    lines: (r) => [
      joinDot(r.ProjectName, r.RequestedDate && `Requested ${fmtDate(r.RequestedDate)}`),
    ],
    searchIn: (r) => [r.CancellationNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.Status],
    open: (r) => ({ to: "cancellation" as const, cancellationId: Number(r.Id), title: r.CancellationNo || r.BookingNo || "Cancellation" }),
    dateOf: (r) => r.RequestedDate, amountOf: (r) => r.RefundAmount,
    empty: "No cancellations.",
  },
  {
    key: "customer-360", about: "One customer, everything", icon: Building2, label: "Customer 360", group: "After-Sales", pages: ["crm-customer-360"], path: "/api/crm/customer-360",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.CustomerNo, r.Mobile),
    avatar: (r) => r.CustomerName,
    amount: (r) => (Number(r.TotalOutstanding) > 0 ? { label: "Outstanding", value: money(r.TotalOutstanding) } : { label: "Paid", value: money(r.TotalPaid) }),
    lines: (r) => [r.Units, Number(r.ActiveBookingCount) > 0 ? plural(r.ActiveBookingCount, "active booking") : null],
    searchIn: (r) => [r.CustomerName, r.Mobile, r.CustomerNo, r.Units, r.City],
    open: (r) => ({ to: "customer", customerId: Number(r.Id), title: r.CustomerName }),
    dateOf: (r) => r.CreatedAt, amountOf: (r) => r.TotalOutstanding, projectOf: () => null,
    empty: "No customers yet.",
  },
  {
    key: "service-tickets", about: "Buyers' service requests", icon: Ticket, label: "Service Tickets", group: "After-Sales", pages: ["crm-service-tickets"], path: "/api/crm/service-tickets",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.Subject || r.TicketNo, sub: (r) => joinDot(r.TicketNo, r.ApplicantName, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.Category, r.Priority && `${r.Priority} priority`, r.AssigneeName && `With ${r.AssigneeName}`),
      joinDot(`Raised ${fmtDate(r.CreatedAt)}`, r.SlaDueDate && `Due ${fmtDate(r.SlaDueDate)}`, r.RaisedByCustomer && "By customer"),
    ],
    searchIn: (r) => [...buyerSearch(r), r.TicketNo, r.Subject, r.Category, r.Status],
    open: (r) => ({ to: "ticket", ticketId: Number(r.Id) }), dateOf: (r) => r.CreatedAt,
    empty: "No service tickets.",
  },
  {
    key: "construction-updates", about: "Site progress by project", icon: HardHat, label: "Construction Updates", group: "After-Sales", pages: ["crm-construction-updates"], path: "/api/crm/construction-updates/progress",
    rows: (b) => list(b?.projects), id: (r) => String(r.projectId),
    title: (r) => r.projectName,
    sub: (r) => (r.hasDpr ? `${r.done ?? 0} of ${r.steps ?? 0} steps done` : "No site progress recorded yet"),
    amount: (r) => (r.hasDpr ? { label: "Complete", value: `${Math.round(Number(r.pct) || 0)}%` } : null),
    lines: (r) => [
      stepName(r.now) && `Now: ${stepName(r.now)}`,
      stepName(r.next) && `Next: ${stepName(r.next)}`,
      Number(r.late) > 0 && `${r.late} running late`,
    ],
    searchIn: (r) => [r.projectName], amountOf: (r) => r.pct, projectOf: (r) => r.projectName, mobile: () => null,
    open: (r) => ({ to: "construction-updates" as const, projectId: Number(r.projectId), projectName: String(r.projectName) }),
    empty: "No projects.",
  },
  // ── Resale ─────────────────────────────────────────────────────────────────
  {
    key: "resales", about: "Property resale and buy-back cases", icon: Repeat2, label: "Resales", group: "Resale", pages: ["crm-resales"], path: "/api/crm/resales",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.FromCustomerName, sub: (r) => joinDot(r.FromBookingNo, "→", r.ToBookingNo || r.ToCustomerName),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.Kind, r.DeveloperFeeAmount && `Fee ${money(r.DeveloperFeeAmount)}`),
      r.CreatedAt && fmtDate(r.CreatedAt),
    ],
    searchIn: (r) => [r.FromBookingNo, r.ToBookingNo, r.FromCustomerName, r.ToCustomerName, r.Kind, r.Status],
    open: (r) => (r.FromBookingId ? { to: "booking", bookingId: Number(r.FromBookingId), title: r.FromBookingNo || "Booking" } : null),
    dateOf: (r) => r.CreatedAt, amountOf: (r) => r.DeveloperFeeAmount,
    empty: "No resale cases.",
  },
  {
    key: "transfer-deeds", about: "Transfer deeds for resale cases", icon: ScrollText, label: "Transfer Deeds", group: "Resale", pages: ["crm-transfer-deeds"], path: "/api/crm/transfer-deeds",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName || r.BookingNo, sub: (r) => joinDot(r.DeedNo, r.BookingNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.ProjectName, r.UnitNo),
      r.CreatedAt && fmtDate(r.CreatedAt),
    ],
    searchIn: (r) => [r.DeedNo, r.ApplicantName, r.BookingNo, r.Status],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No transfer deeds.",
  },
  {
    key: "ownership-changes", about: "Co-owner and nominee changes", icon: UserCog, label: "Ownership Changes", group: "Resale", pages: ["crm-ownership-changes"], path: "/api/crm/ownership-changes",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.ProjectName, r.CreatedAt && fmtDate(r.CreatedAt)),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.Status],
    open: toBooking, dateOf: (r) => r.CreatedAt,
    empty: "No ownership change records.",
  },
];

export const registerByKey = (key: string) => CRM_REGISTERS.find((r) => r.key === key);

/** True when the person may open any CRM page (the web's CRM menu keys) — Home and the Menu show the CRM only then. */
export function useHasCrm() {
  const { canAccessPage } = useAuth();
  return canAccessPage("crm-dashboard") || CRM_REGISTERS.some((r) => r.pages.some((p) => canAccessPage(p)));
}

/** The list a paired list belongs to (Call History → Welcome Calls), if any. */
export const pairParent = (key: string) => CRM_REGISTERS.find((r) => r.pair?.key === key);
/** The lists the CRM page shows on their own: not a paired list (it opens from its parent's switch). */
export const isListedRegister = (r: CrmRegister) => !pairParent(r.key);

/** The CRM lists the bottom bar's Menu also offers (TopHeader.tsx NavMenuSheet), in this order. */
export const MENU_LISTS = ["customer-360", "service-tickets", "construction-updates"];
