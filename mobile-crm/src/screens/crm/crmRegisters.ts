// Every CRM list the app shows, in one place: its name and group as the web's CRM menu has them
// (src/components/layout/sidebars/CrmSidebar.ts), the page rights that show it (the same keys the server route
// checks), the route the web page reads, and how one row reads on a card. CrmRegisterScreen draws any of them;
// CrmHubScreen lists the ones the signed-in person may open. Add a list here and it appears in both.
import type { Row } from "@/api/crmApi";
import { useAuth } from "@/auth/AuthContext";
import {
  ArrowRightLeft, Award, Ban, Building2, CalendarClock, Car, ClipboardList, FileCheck2, FileMinus, FilePenLine, FileText,
  Flag, Grid3x3, Handshake, HardHat, Hash, KeyRound, Layers, LayoutGrid, ListChecks, Map, Percent, PhoneCall, PhoneIncoming, PlusCircle,
  Receipt, ReceiptIndianRupee, Repeat2, Ruler, ScrollText, ShieldCheck, Ticket, Undo2, UserCog, UserRound, Users, Wallet, Wand2, type LucideIcon,
} from "lucide-react-native";
import { formatCompactINR } from "@/utils/formatCurrency";
import { fmtDate, joinDot, money } from "./ui";

export type CrmGroup = "Buyers & Bookings" | "Units & Parking" | "Finance" | "Legal & Possession" | "Brokerage" | "After-Sales" | "Resale" | "Setup";
/** The CRM tab's groups (the web's CRM menu). "Setup" is the header's drawer (the web's Setup menu), not listed here. */
export const CRM_GROUPS: CrmGroup[] = ["Buyers & Bookings", "Units & Parking", "Finance", "Legal & Possession", "Brokerage", "After-Sales", "Resale"];

/** Where a card goes when tapped. */
export type CrmOpen =
  | { to: "afs-qp"; id: number; title: string }
  | { to: "oc-cc-cert"; cert: Row }
  | { to: "booking"; bookingId: number; title: string }
  /** A booking's payment plan (the web's Payment Milestones record): the booking page showing its money only. */
  | { to: "payment-plan"; bookingId: number; title: string }
  | { to: "customer"; customerId: number; title: string }
  | { to: "ticket"; ticketId: number }
  | { to: "application"; applicationId: number }
  | { to: "document"; path: string; name: string }
  | { to: "construction-updates"; projectId: number; projectName: string }
  | { to: "oc-cc-board" }
  | { to: "cancellation"; cancellationId: number; title: string }
  | { to: "refund"; refundId: number; title: string }
  | { to: "invoice"; invoiceId: number; title: string }
  | { to: "resale"; resaleId: number; title: string }
  | { to: "money-receipt"; receiptId: number; title: string }
  | { to: "brokerage"; brokerageId: number; title: string }
  | { to: "transfer-deed"; deedId: number; title: string }
  | { to: "ownership-change"; changeId: number; title: string }
  | { to: "agreement"; bookingId: number; title: string }
  | { to: "sale-deed"; bookingId: number; title: string }
  | { to: "noc"; bookingId: number; title: string }
  | { to: "mutation"; bookingId: number; title: string }
  | { to: "bank-details"; bookingId: number; row: Row }
  | { to: "possession"; bookingId: number; title: string }
  | { to: "parking-allotment"; allotment: Row }
  | { to: "welcome-call"; bookingId: number; title: string }
  | { to: "on-account"; deposit: Row }
  | { to: "credit-note"; creditNoteId: number; title: string }
  | { to: "unit-change"; changeId: number; title: string }
  | { to: "legal-milestone"; bookingId: number; title: string }
  | { to: "loan-tracking"; bookingId: number; title: string }
  | { to: "booking-amendment"; amendmentId: number; title: string; amendment?: Row }
  | { to: "demand-detail"; milestoneId: number; title: string; demand?: Row }
  | { to: "payment"; bookingId: number; milestoneId?: number; title?: string };

/** Welcome-call outcomes and their words — the web's (src/pages/CRM/welcomeCalls/config.tsx OUTCOMES / OUTCOME_LABEL),
 * the server's list (crmWelcomeCalls.js OUTCOMES). */
export const WELCOME_OUTCOMES = ["Welcomed", "NotReachable", "RequestedCallback", "VoiceMail", "Busy", "SwitchedOff"] as const;
export const OUTCOME_LABEL: Record<string, string> = {
  Welcomed: "Welcomed", NotReachable: "Not reachable", RequestedCallback: "Callback asked", VoiceMail: "Voicemail", Busy: "Busy", SwitchedOff: "Switched off",
};

/** A key on the card that starts a job there (Log call), for staff with that right on one of the pages. */
export interface CardAction {
  label: string; pages: string[]; right: "create" | "edit"; when?: (r: Row) => boolean;
  /** A quieter outline key (the web's line key), not the filled one; `danger` draws it red. */
  outline?: boolean;
  danger?: boolean;
  /** Only for approvers of this Approval Setup module (the web's useCanApprove). */
  approver?: string;
  /** Instead of opening a screen: the web page's own confirm dialog, then its server call and message. */
  dialog?: (r: Row) => ActionDialog;
  /** A server call made at once, no dialog (the web key that just acts), then its message. */
  call?: (r: Row) => { path: string; method: "POST" | "PUT" | "PATCH"; done: (res: any) => string };
  to?: (r: Row) => { screen: "CrmWelcomeCall"; params: { bookingId: number; title?: string } } | { screen: "CrmApplicationForm"; params: { applicationId: number } }
    | { screen: "CrmOnAccountAdjust"; params: { deposit: Row } }
    | { screen: "CrmCustomerForm"; params: { lead: { Id: number; LeadUid?: string; CustomerName?: string; Mobile?: string; AltMobile?: string; Email?: string } } }
    | { screen: "CrmBookingNew"; params: { applicationId: number } }
    | { screen: "CrmOcCcBoard"; params: Record<string, never> };
}

/** A web confirm dialog as a sheet: title, a line, label/value rows, a warning, an optional notes box, its two keys. */
export interface ActionDialog {
  title: string; note?: string; rows?: [string, string][]; warn?: string | null; body?: string;
  notes?: { label: string; placeholder: string; key: string; required?: boolean };
  /** A plain information line (not a warning). */
  info?: string;
  /** A date picker sent as `key` (YYYY-MM-DD). */
  date?: { label: string; key: string; required?: boolean };
  cancel: string; confirm: string; busy: string; danger?: boolean;
  path: string; method: "POST" | "PATCH" | "PUT";
  /** Sent with the notes box's value (Raise all: the project chosen on the list). */
  send?: Record<string, unknown>;
  done: (res: any) => string;
}

/** A key on the list itself (the web page's band key, e.g. Demands' Raise all), given the project the list is filtered to. */
export interface ListAction {
  label: string; pages: string[]; right: "create" | "edit";
  dialog?: (project: string | null) => ActionDialog;
  /** A key that opens a screen (Customers: Import). */
  screen?: "CrmCustomerImport";
  /** A key that acts at once (no dialog), its busy words and its message. */
  call?: { path: string; method: "POST" | "PUT"; busy: string; done: (res: any) => string };
}

/** The list's "new" key (the web list's own New button), for those with the right. */
export interface CreateAction { label: string; pages: string[]; screen: "CrmCustomerForm" | "CrmApplicationForm" | "CrmRefundNew" | "CrmParkingSale" | "CrmBookingNew" | "CrmCancellationNew" | "CrmNoc" | "CrmAgreement" | "CrmSaleDeed" | "CrmMutation" | "CrmOcCcCert" | "CrmResaleNew" | "CrmAfsStart"; params?: object }

/** A setup list's add / edit form (the web master's own dialog): POST `path` to add, PUT `path/:Id` to change. The server
 * checks every value, so the form sends what was typed and shows the server's message. */
export interface EditField {
  key: string; label: string; kind: "text" | "number" | "switch" | "date" | "choice"; hint?: string;
  /** For `choice`: the values and their words. */
  options?: { value: string; label: string }[];
}
export interface EditForm {
  pages: string[]; path: string; noun: string; fields: EditField[];
  /** Where a change is saved, when not `path/:Id` (PUT). */
  savePath?: (r: Row) => string;
  /** No "New" key: every row already exists (one per booking). */
  noAdd?: boolean;
  /** What the web sends with a change besides the fields (the record's own project, block, status…). */
  extra?: (r: Row) => Row;
  /** The web's message after saving, from the server's answer. */
  saved?: (res: any) => string;
  /** The web form's own check before saving: a message, or null to save. */
  check?: (vals: Record<string, unknown>) => string | null;
  /** The web page's Delete (DELETE `path/:Id`, the page's delete right): its confirm words, its message, and why it is
   * locked when the record is in use (the server refuses those). */
  del?: { ask: (r: Row) => string; done: string; locked?: (r: Row) => string | null };
}

export interface CrmRegister {
  createAction?: CreateAction;
  editForm?: EditForm;
  key: string;
  /** The web page's path, where it is not /crm/<key> — the server's sent-back counts are keyed by it. */
  webPath?: string;
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
  /** The card's key — or keys, the first whose `when` holds showing (Demands: Raise, or Undo). */
  cardAction?: CardAction | CardAction[];
  listAction?: ListAction;
  /** The web page's figures band: from the list's own response, or from `path` (a summary route) when given. */
  band?: {
    path?: string;
    figures: (body: any) => { label: string; value: string; note?: string; alert?: boolean }[];
    /** The band's lead figure and its split bar (Demands: balance to collect; overdue / raised / not raised). */
    lead?: (body: any) => { value: string; note: string; bar: { amount: number; tone: "danger" | "accent" | "muted" }[] };
  };
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
/** The web's certificate words (src/constants/crmStatuses.ts CERT_TYPE_LABEL / CERT_STATUS_LABEL). */
export const CERT_TYPE_LABEL: Record<string, string> = { OC: "Occupancy Certificate", CC: "Completion Certificate", "OC+CC": "Occupancy and Completion Certificate" };
export const CERT_STATUS_LABEL: Record<string, string> = { Applied: "Application filed", Received: "Issued" };
/** Who a refund waits on, in the web list's words (CrmRefunds.tsx waitingOn). */
const refundWaitingOn = (r: Row): string => {
  if (r.Status === "Paid") return "Paid";
  if (r.Status === "Withdrawn") return "Withdrawn";
  if (r.NeedsAccount && ["Draft", "Pending", "Rejected"].includes(r.Status)) return "Add the customer's account";
  switch (r.Status) {
    case "Draft": return "CRM: send for approval";
    case "Pending": return r.RejectionNote ? "CRM approver (sent back by Finance)" : "CRM approver";
    case "Rejected": return "CRM: correct and send again";
    case "Approved": case "FinancePending": return "Finance: raise the payout voucher";
    case "FinanceApproved": return "Finance: approve the voucher in Payments";
    default: return r.Status;
  }
};
/** A booking amendment's change and its proposed fields (the web's changeLabel / proposedEntries). */
const amendChange = (r: Row) => `${r.ChangeType === "ParkingAllotment" ? "Parking" : r.ChangeType === "ExtraCharge" ? "Extra charge" : r.ChangeType} · ${r.Action}`;
const amendProposed = (r: Row): [string, unknown][] => {
  try { return Object.entries(JSON.parse(r.ProposedChange || "{}") as Record<string, unknown>).filter(([k]) => k !== "Reason"); } catch { return []; }
};
/** What a demand still asks for (the web's balanceOf): due less paid. */
const demandBalance = (r: Row) => Math.max(0, Number(r.AmountDue || 0) - Number(r.AmountPaid || 0));
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
    status: (r) => (r.CustomerId ? "Converted" : "No customer yet"),
    // A lead no customer carries yet: make the customer from it (the server refuses a lead already used).
    cardAction: {
      label: "Create customer", pages: ["crm-customers"], right: "create", when: (r) => !r.CustomerId,
      to: (r) => ({ screen: "CrmCustomerForm", params: { lead: { Id: Number(r.Id), LeadUid: r.LeadUid, CustomerName: r.CustomerName, Mobile: r.Mobile, AltMobile: r.AltMobile, Email: r.Email } } }),
    },
    dateOf: (r) => r.DateGenerated, projectOf: () => null,
    empty: "No leads handed over to the CRM.",
  },
  {
    createAction: { label: "New customer", pages: ["crm-customers"], screen: "CrmCustomerForm" },
    // The web Customers page's Import (CrmCustomerImportDialog), from the converted leads.
    listAction: { label: "Import", pages: ["crm-customers"], right: "create", screen: "CrmCustomerImport" },
    key: "customers", about: "Everyone who has applied or booked", icon: Users, label: "Customers", group: "Buyers & Bookings", pages: ["crm-customers"], path: "/api/crm/customers",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.CustomerNo, r.Mobile),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    avatar: (r) => r.CustomerName,
    mobile: (r) => r.Mobile,
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
    avatar: (r) => r.ApplicantName,
    mobile: (r) => r.Mobile,
    status: (r) => r.Status,
    amount: (r) => (r.BookingAmount ? { label: "Booking amount", value: money(r.BookingAmount) } : null),
    lines: (r) => [
      joinDot(r.InterestedProject, r.InterestedUnit || r.PlotNames),
      joinDot(r.PropertyType, r.BhkPreference, r.DateOfApply && `Applied ${fmtDate(r.DateOfApply)}`),
    ],
    searchIn: (r) => [r.ApplicantName, r.Mobile, r.ApplicationNo, r.InterestedProject, r.InterestedUnit, r.Status],
    // An application opens itself (its steps); once it has a booking, the booking.
    // The web opens the application itself, also once it became a booking (its booking is a key inside).
    open: (r) => ({ to: "application", applicationId: Number(r.Id) }),
    dateOf: (r) => r.DateOfApply, amountOf: (r) => r.BookingAmount, projectOf: (r) => r.InterestedProject,
    cardAction: [
      {
        label: "Create Booking", pages: ["crm-bookings"], right: "create",
        when: (r) => (r.Status === "Approved" || r.Stage === "Approved") && !r.BookingId,
        to: (r) => ({ screen: "CrmBookingNew", params: { applicationId: Number(r.Id) } }),
      },
    ],
    empty: "No applications yet.",
  },
  {
    createAction: { label: "New booking", pages: ["crm-bookings"], screen: "CrmBookingNew" },
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
    open: (r) => (r.BookingId ? { to: "welcome-call" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || "Welcome Call" } : null),
    mobile: (r) => r.Mobile,
    cardAction: { label: "Log call", pages: ["crm-welcome-calls"], right: "create", to: (r) => ({ screen: "CrmWelcomeCall", params: { bookingId: Number(r.BookingId), title: r.ApplicantName } }) },
    pair: { key: "call-history", labels: ["To call", "History"] },
    empty: "No bookings waiting for a welcome call.",
  },
  {
    key: "customer-bank-details", about: "KYC and bank details per booking", icon: FileText, label: "Customer Bank Details", group: "Buyers & Bookings", pages: ["crm-customer-bank-details"], path: "/api/crm/customer-bank-details",
    // The web page's table (CrmCustomerBankDetails.tsx): KYC Complete / Pending, financing, welcome call; a row opens Bank and KYC.
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.ProjectName, r.UnitNo),
    status: (r) => (r.IsComplete ? "Complete" : "Pending"),
    lines: (r) => [
      r.Mobile,
      joinDot(`Financing: ${r.FinancingType === "LoanFinanced" ? "Loan" : r.FinancingType === "SelfFunded" ? "Self-funded" : "—"}`,
        `Welcome call: ${r.LastCallOutcome === "Welcomed" ? "Welcomed" : "Not yet"}`),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.ProjectName, r.Mobile],
    open: (r) => (r.BookingId ? { to: "bank-details", bookingId: Number(r.BookingId), row: r } : null),
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.CreatedAt,
    empty: "No bank details on file.",
  },
  {
    key: "booking-amendments", about: "Amendments to booking terms", icon: FilePenLine, label: "Booking Amendments", group: "Buyers & Bookings", pages: ["crm-bookings"], path: "/api/crm/booking-amendments",
    // The web page (CrmBookingAmendments.tsx): the change, what it proposes, the reason, who asked, the review; Approve /
    // Reject with its dialog for approvers (crm-booking-amendment) with the edit right — PUT /:id/approve | /:id/reject.
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.BookingNo, sub: (r) => joinDot(r.ApplicantName, r.ProjectName, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      amendChange(r),
      amendProposed(r).map(([k, v]) => `${k}: ${v}`).join(" · "),
      r.Reason && `Reason: ${r.Reason}`,
      joinDot(r.RequestedByName || "—", r.RequestedAt && fmtDate(r.RequestedAt)),
      r.ReviewedByName && `by ${r.ReviewedByName} · ${fmtDate(r.ReviewedAt)}`,
      r.ReviewNotes,
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.Status, r.UnitNo, r.ProjectName],
    open: (r) => ({
      to: "booking-amendment" as const,
      amendmentId: Number(r.Id),
      title: `${r.BookingNo || "Amendment"} · ${amendChange(r)}`,
      amendment: r,
    }),
    dateOf: (r) => r.RequestedAt,
    cardAction: ["approve", "reject"].map((action): CardAction => ({
      label: action === "approve" ? "Approve" : "Reject", pages: ["crm-bookings"], right: "edit", approver: "crm-booking-amendment",
      outline: action === "reject", danger: action === "reject", when: (r) => r.Status === "Pending",
      dialog: (r) => ({
        title: `${action === "approve" ? "Approve amendment" : "Reject amendment"} · ${r.BookingNo}`,
        rows: [["Change", amendChange(r)], ["Customer", r.ApplicantName], ["Unit", r.UnitNo || "—"],
          ...(amendProposed(r).length ? amendProposed(r).map(([k, v]) => [k, String(v ?? "—")] as [string, string]) : [["Proposed change", "No field details recorded."] as [string, string]])],
        body: r.Reason ? `Reason: ${r.Reason}` : undefined,
        info: action === "approve" ? "Approving applies the change to the booking at once; its payment milestones are recalculated." : undefined,
        notes: { label: `Review notes ${action === "approve" ? "(optional)" : "(required)"}`, placeholder: "Notes for this decision", key: "Notes", required: action === "reject" },
        cancel: "Cancel", confirm: action === "approve" ? "Approve and apply" : "Reject", busy: "Working…", danger: action === "reject",
        path: `/api/crm/booking-amendments/${r.Id}/${action}`, method: "PUT",
        done: () => (action === "approve" ? "Amendment approved and applied" : "Amendment rejected"),
      }),
    })),
    empty: "Nothing waiting for a decision.",
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
    open: (r) => ({ to: "unit-change" as const, changeId: Number(r.Id), title: r.CustomerName || r.RequestNo || "Unit Change" }),
    mobile: (r) => r.Mobile,
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
    open: (r) => (r.BookingId ? { to: "welcome-call" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || r.BookingNo || "Welcome Call" } : null),
    mobile: (r) => r.Mobile,
    empty: "No welcome calls logged.",
  },
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    key: "payment-milestones", webPath: "/crm/payments", about: "Each booking's plan: due, collected, to collect", icon: ClipboardList, label: "Payment Milestones", group: "Finance",
    pages: ["crm-payments"], path: "/api/crm/payments/ledger?focus=all",
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName || r.BookingNo, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => (r.Closed ? r.BookingStatus : Number(r.OverdueAmount) > 0 ? "Overdue" : Number(r.ToCollect) > 0 ? "Due" : "Paid"),
    amount: (r) => ({ label: "To collect", value: money(r.ToCollect) }),
    lines: (r) => [
      `${money(r.Collected)} collected of ${money(r.TotalDue)} (${Math.round(Number(r.CollectedPct) || 0)}%)`,
      Number(r.OverdueAmount) > 0 && `${money(r.OverdueAmount)} overdue · ${r.DaysLate} days late`,
      Number(r.WithFinance) > 0 && `${money(r.WithFinance)} with Finance`,
      r.AssignedToName && `Handled by ${r.AssignedToName}`,
    ],
    searchIn: buyerSearch, amountOf: (r) => Number(r.ToCollect),
    open: (r) => ({ to: "payment-plan" as const, bookingId: Number(r.BookingId), title: `Payments — ${r.BookingNo || r.ApplicantName || "Booking"}` }),
    mobile: (r) => r.Mobile,
    empty: "No bookings with a payment plan.",
  },
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
    mobile: (r) => r.Mobile,
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
    open: (r) => ({ to: "credit-note" as const, creditNoteId: Number(r.Id), title: r.NoteNo || r.ApplicantName || "Credit Note" }),
    dateOf: (r) => r.NoteDate, amountOf: (r) => r.Amount,
    empty: "No credit notes.",
  },
  {
    key: "refunds", about: "Refund requests and payouts", icon: Undo2, label: "Refunds", group: "Finance", pages: ["crm-refunds"], path: "/api/crm/refunds",
    // The web list's columns (CrmRefunds.tsx COLS): who it waits on, net payout, source, RERA due; New Refund for creators.
    createAction: { label: "New Refund", pages: ["crm-refunds"], screen: "CrmRefundNew" },
    rows: (b) => (Array.isArray(b) ? b : list(b?.rows)), id: (r) => String(r.Id),
    title: (r) => r.CustomerName ?? r.ApplicantName, sub: (r) => joinDot(r.RefundNo, r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => refundWaitingOn(r),
    amount: (r) => ({ label: "Net payout", value: money(r.NetAmount) }),
    lines: (r) => [
      Number(r.DeductionAmount) > 0 && `${money(r.GrossAmount)} less ${r.DeductionPercent}%`,
      joinDot({ CancellationHeldCredit: "Cancelled booking", OverpaymentOnAccount: "Overpayment", Manual: "Manual" }[r.SourceType as string] ?? r.SourceType, r.CancellationNo),
      r.RefundDueDate && r.Status !== "Paid" && `RERA due ${fmtDate(r.RefundDueDate)} · ${r.IsOverdue ? `${Math.abs(r.DaysRemaining)} days overdue` : `${r.DaysRemaining} days left`}`,
    ],
    searchIn: (r) => [r.RefundNo, r.CustomerName, r.ApplicantName, r.Mobile, r.BookingNo, r.UnitNo, r.Status],
    open: (r) => ({ to: "refund" as const, refundId: Number(r.Id), title: r.RefundNo || r.BookingNo || "Refund" }),
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.RequestedAt || r.CreatedAt, amountOf: (r) => r.NetAmount,
    empty: "No refunds yet. Cancelling a booking makes a draft refund; one can also be raised for an overpayment.",
  },
  {
    // The web Refunds page's "Re-booking credits" (RebookingCredits): held credit moved onto the customer's new booking.
    key: "rebooking-credits", about: "Held credit moved onto a new booking", icon: ArrowRightLeft, label: "Re-booking Credits", group: "Finance",
    pages: ["crm-refunds"], path: "/api/crm/refunds/rebooking-transfers", webPath: "/crm/refunds#rebooking",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.CustomerName, sub: (r) => joinDot(r.FromBookingNo, r.CancellationNo),
    status: (r) => (r.Status === "Applied" ? "Applied to the booking" : r.Status === "Rejected" ? "Not applied"
      : r.IsCrossCompany && r.FundTransferStatus === "Draft" ? "Fund transfer not sent" : r.IsCrossCompany ? `Fund transfer ${r.FundTransferStatus || "pending"}` : r.Status),
    amount: (r) => ({ label: "Amount", value: money(r.Amount) }),
    lines: (r) => [
      `Moved to ${joinDot(r.ToBookingNo, r.ToProjectName, r.ToUnitNo)}${r.IsCrossCompany ? " · another company" : ""}`,
      r.FundTransferNo,
      joinDot(fmtDate(r.CreatedAt), r.CreatedByName),
    ],
    searchIn: (r) => [r.CustomerName, r.FromBookingNo, r.ToBookingNo, r.CancellationNo, r.FundTransferNo],
    dateOf: (r) => r.CreatedAt, amountOf: (r) => r.Amount,
    cardAction: [
      { label: "Send Fund Transfer", pages: ["crm-refunds"], right: "edit",
        when: (r) => !!r.IsCrossCompany && r.Status === "PendingTransfer" && r.FundTransferStatus === "Draft",
        call: (r) => ({ path: `/api/crm/refunds/rebooking-transfer/${r.Id}/submit-fund-transfer`, method: "PUT", done: (d) => d?.message || "Fund transfer sent for approval" }) },
      { label: "Check Ledger", outline: true, pages: ["crm-refunds"], right: "edit", when: (r) => r.Status === "Applied",
        call: (r) => ({ path: `/api/crm/refunds/rebooking-transfer/${r.Id}/retry-ledger`, method: "PUT", done: (d) => d?.message || "Ledger entries are up to date" }) },
    ],
    empty: "None.",
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
    open: (r) => ({ to: "demand-detail" as const, milestoneId: Number(r.Id), demand: r, title: r.DemandNo ? `Demand #${r.DemandNo}` : r.MilestoneName || "Demand" }),
    dateOf: (r) => r.DueDate,
    amountOf: (r) => r.AmountDue,
    mobile: (r) => r.Mobile,
    // The web band (CrmDemands.tsx MoneyBand figures), from the list's summary.tabs.
    band: {
      lead: (b) => {
        const t = b?.summary?.tabs ?? {};
        const f = (k: string) => t[k] ?? { count: 0, amount: 0 };
        const all = f("overdue").count + f("pending").count + f("demanded").count + f("paid").count;
        return {
          value: `₹${formatCompactINR(f("overdue").amount + f("pending").amount + f("demanded").amount)}`,
          note: `balance to collect · ${all - f("paid").count} open milestones`,
          bar: [{ amount: f("overdue").amount, tone: "danger" }, { amount: f("demanded").amount, tone: "accent" }, { amount: f("pending").amount, tone: "muted" }],
        };
      },
      figures: (b) => {
      const t = b?.summary?.tabs ?? {};
      const f = (k: string) => t[k] ?? { count: 0, amount: 0 };
      const ms = (n: number) => `${n} milestone${n === 1 ? "" : "s"}`;
      return [
        { label: "Overdue", value: `₹${formatCompactINR(f("overdue").amount)}`, note: ms(f("overdue").count), alert: f("overdue").count > 0 },
        { label: "Raised, awaiting payment", value: `₹${formatCompactINR(f("demanded").amount)}`, note: ms(f("demanded").count) },
        { label: "Not raised", value: `₹${formatCompactINR(f("pending").amount)}`, note: ms(f("pending").count) },
        { label: "Paid", value: `₹${formatCompactINR(f("paid").amount)}`, note: ms(f("paid").count) },
      ];
    } },
    // The web Demands page's Raise all, Raise and Undo keys and dialogs (CrmDemands.tsx), the same routes (crmPayments.js).
    listAction: {
      label: "Raise all", pages: ["crm-payments"], right: "edit",
      dialog: (project) => ({
        title: "Raise all eligible demands",
        note: `Raises a demand for every milestone not yet raised that still has a balance, in the project chosen on the list${project ? "" : " (none chosen: every project you can see)"}. Raised or paid milestones are skipped.`,
        notes: { label: "Only this milestone (optional)", placeholder: "e.g. Slab completion", key: "milestoneName" },
        cancel: "Cancel", confirm: "Raise all", busy: "Raising…",
        path: "/api/crm/payments/demands/bulk", method: "POST", send: { projectName: project || undefined },
        done: (b) => `Raised ${b.raised} demand${b.raised !== 1 ? "s" : ""}${b.skipped ? ` · ${b.skipped} already raised` : ""}${b.errors?.length ? ` · ${b.errors.length} error(s)` : ""}`,
      }),
    },
    cardAction: [
      {
        label: "Raise", pages: ["crm-payments"], right: "edit", when: (r) => r.DemandStatus === "Pending" && demandBalance(r) > 0,
        dialog: (r) => ({
          title: "Raise payment demand", note: "Gives it a demand number and notifies the assigned staff.",
          rows: [
            ["Booking", `${r.BookingNo}${r.ProjectName ? ` · ${r.ProjectName}` : ""} · ${r.UnitNo}`],
            ["Customer", r.ApplicantName], ["Milestone", `#${r.MilestoneNo} ${r.MilestoneName}`],
            ["Amount", money(demandBalance(r))], ["Due date", fmtDate(r.DueDate)],
          ],
          warn: r.IsOverdue ? `This milestone is ${r.DaysOverdue} days overdue.` : null,
          notes: { label: "Notes (optional)", placeholder: "Any remarks for this demand…", key: "Notes" },
          cancel: "Cancel", confirm: "Raise demand", busy: "Raising…",
          path: `/api/crm/payments/${r.Id}/demand`, method: "POST", done: (res) => `Demand raised: ${res?.DemandNo}`,
        }),
      },
      {
        label: "Undo", pages: ["crm-payments"], right: "edit", outline: true, when: (r) => r.DemandStatus === "Demanded",
        dialog: (r) => ({
          title: `Undo demand ${r.DemandNo}?`,
          body: `It goes back to "Not raised" for ${r.ApplicantName} (${r.MilestoneName}) and its demand number is cleared.`,
          cancel: "Keep it", confirm: "Undo demand", busy: "Reverting…", danger: true,
          path: `/api/crm/payments/${r.Id}/demand/undo`, method: "PATCH", done: () => "Demand reverted",
        }),
      },
    ],
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
    open: (r) => ({ to: "money-receipt" as const, receiptId: Number(r.Id), title: r.ReceiptNo || "Money Receipt" }),
    // The web band key (CrmMoneyReceipts.tsx sendStuck): receipts of approved bookings that never reached Finance.
    listAction: { label: "Send stuck receipts to Finance", pages: ["crm-money-receipts"], right: "edit",
      call: { path: "/api/crm/money-receipts/sweep-pending", method: "POST", busy: "Sending…",
        done: (d) => (d.processed === 0 && d.failed === 0 ? "Nothing stuck: every approved booking's receipt is with Finance."
          : `Sent ${d.processed} receipt(s) to Finance.${d.failed ? ` ${d.failed} failed.` : ""}`) } },
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.ReceivedDate, amountOf: (r) => r.Amount,
    empty: "No money receipts.",
  },
  {
    key: "on-account", about: "Payments held before they are adjusted", icon: Wallet, label: "On Account", group: "Finance", pages: ["crm-payments"], path: "/api/crm/payments/on-account", serverSearch: true,
    rows: (b) => list(b?.deposits), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.ReceiptNo || "Pending", r.BookingNo, r.ProjectName, r.UnitNo),
    // The web's figures (CrmOnAccount.tsx), from GET /on-account/summary.
    band: { path: "/api/crm/payments/on-account/summary", figures: (s) => {
      const util = s && s.TotalReceived > 0 ? Math.round((s.TotalApplied / s.TotalReceived) * 100) : 0;
      return [
        { label: "Received", value: money(s?.TotalReceived), note: `${s?.TotalCount ?? 0} deposits${s?.BouncedCount ? ` · ${s.BouncedCount} bounced` : ""}` },
        { label: "Applied", value: money(s?.TotalApplied), note: `${s?.AppliedCount ?? 0} fully applied` },
        { label: "Available", value: money(s?.TotalAvailable), note: `${(s?.UnappliedCount ?? 0) + (s?.PartialCount ?? 0)} open · ${money(s?.UnappliedBalance ?? 0)} unapplied` },
        { label: "Utilisation", value: `${util}%`, note: `${money(s?.PartialBalance ?? 0)} left on partly applied` },
      ];
    } },
    // The web's marks (CrmOnAccount.tsx DepositMark).
    status: (r) => (r.Status === "PartiallyApplied" ? "Partly applied" : r.Status),
    // The web's Adjust key and dialog (AdjustDialog): open deposits with money left, for the edit right on Payments.
    cardAction: {
      label: "Adjust", outline: true, pages: ["crm-payments"], right: "edit",
      when: (r) => r.Status !== "Applied" && r.Status !== "Bounced" && Number(r.AvailableBalance) > 0,
      to: (r) => ({ screen: "CrmOnAccountAdjust", params: { deposit: r } }),
    },
    amount: (r) => ({ label: "Available", value: money(r.AvailableBalance) }),
    lines: (r) => [
      joinDot(`Received ${money(r.Amount)}`, `Applied ${money(r.AppliedAmount)}`),
      joinDot(fmtDate(r.ReceivedDate), r.PaymentMode, r.DepositBankName),
    ],
    open: (r) => ({ to: "on-account" as const, deposit: r }),
    dateOf: (r) => r.ReceivedDate, amountOf: (r) => r.AvailableBalance,
    mobile: (r) => r.Mobile,
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
    open: (r) => (r.BookingId ? { to: "legal-milestone" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || r.BookingNo || "Legal Milestones" } : null),
    dateOf: (r) => r.UpdatedAt || r.CreatedAt,
    empty: "No legal milestone records.",
  },
  {
    createAction: { label: "Draft Agreement", pages: ["crm-agreements"], screen: "CrmAgreement" },
    key: "agreements", about: "Agreement to sell records", icon: ScrollText, label: "Agreements", group: "Legal & Possession", pages: ["crm-agreements"], path: "/api/crm/agreements",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.AgreementNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    amount: (r) => (r.GrandTotal ? { label: "Total", value: money(r.GrandTotal) } : null),
    lines: (r) => [
      joinDot(r.AgreementDate && `Dated ${fmtDate(r.AgreementDate)}`, r.ProjectName),
    ],
    searchIn: (r) => [r.AgreementNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Status],
    open: (r) => (r.BookingId ? { to: "agreement" as const, bookingId: Number(r.BookingId), title: r.AgreementNo || r.ApplicantName || "Agreement" } : null),
    dateOf: (r) => r.AgreementDate, amountOf: (r) => r.GrandTotal,
    empty: "No agreements.",
  },
  {
    // The web's AFS Query Payment page (CrmAfsQueryPayment.tsx): stamp duty and registration fee tracker, Pending →
    // Info Sent (send paperwork) → Confirmed (payment received). Page right: crm-afs-query-payment.
    key: "afs-query-payment", about: "Stamp duty and registration fee tracker", icon: CalendarClock, label: "AFS Query Payment",
    group: "Legal & Possession", pages: ["crm-afs-query-payment"], path: "/api/crm/afs-query-payment",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.AfsQPNo, r.AgreementNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status === "InfoSent" ? "Info Sent" : r.Status,
    amount: (r) => (r.RequiredAmount ? { label: "Required", value: money(r.RequiredAmount) } : null),
    lines: (r) => [
      joinDot(r.ProjectName, r.UnitNo),
      Number(r.StampDuty) > 0 && `Stamp ${money(r.StampDuty)} + Reg. fee ${money(r.RegistrationFee)}`,
      r.InfoSentAt && `Info sent ${fmtDate(r.InfoSentAt)}`,
      r.ConfirmedAt && `Confirmed ${fmtDate(r.ConfirmedAt)}`,
    ],
    searchIn: (r) => [r.ApplicantName, r.AfsQPNo, r.BookingNo, r.AgreementNo, r.UnitNo, r.Mobile],
    // A row opens its record (the web's detail dialog: fees, Send to Customer, Confirm Payment Received).
    open: (r) => ({ to: "afs-qp" as const, id: Number(r.Id), title: r.AfsQPNo || "AFS Query Payment" }),
    createAction: { label: "Start Registration Fee Tracker", pages: ["crm-afs-query-payment"], screen: "CrmAfsStart", params: { kind: "qp" } },
    mobile: (r) => r.Mobile, dateOf: (r) => r.CreatedAt, amountOf: (r) => r.RequiredAmount,
    empty: "No AFS query payment records.",
  },
  {
    // The web's AFS Registry page (CrmAfsRegistry.tsx): sub-registrar appointment tracker, Pending →
    // Scheduled (set date) → Completed (mark done). Page right: crm-afs-registry.
    key: "afs-registry", about: "Sub-registrar appointment tracker", icon: CalendarClock, label: "AFS Registry",
    group: "Legal & Possession", pages: ["crm-afs-registry"], path: "/api/crm/afs-registry",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.AfsRegNo, r.AgreementNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.ProjectName, r.UnitNo),
      r.ScheduledDate && `Appointment ${fmtDate(r.ScheduledDate)}`,
      r.AfsRegistrationNo && `Reg. no. ${r.AfsRegistrationNo}`,
      r.CompletedDate && `Completed ${fmtDate(r.CompletedDate)}`,
    ],
    searchIn: (r) => [r.ApplicantName, r.AfsRegNo, r.BookingNo, r.AgreementNo, r.UnitNo, r.AfsRegistrationNo, r.Mobile],
    open: (r) => (r.BookingId ? { to: "agreement" as const, bookingId: Number(r.BookingId), title: r.AgreementNo || r.ApplicantName || "Agreement" } : null),
    mobile: (r) => r.Mobile, dateOf: (r) => r.ScheduledDate || r.CreatedAt,
    createAction: { label: "Start AFS Registry", pages: ["crm-afs-registry"], screen: "CrmAfsStart", params: { kind: "registry" } },
    // The web's row keys and dialogs (CrmAfsRegistry.tsx): Schedule (Pending) and Mark Completed (Scheduled).
    cardAction: [
      { label: "Schedule", pages: ["crm-afs-registry"], right: "edit", when: (r) => r.Status === "Pending",
        dialog: (r) => ({
          title: "Schedule Registry",
          date: { label: "Appointment Date *", key: "ScheduledDate", required: true },
          cancel: "Cancel", confirm: "Save", busy: "Saving…",
          path: `/api/crm/afs-registry/${r.Id}/schedule`, method: "PUT", done: () => "Scheduled",
        }),
      },
      { label: "Mark Completed", pages: ["crm-afs-registry"], right: "edit", when: (r) => r.Status === "Scheduled",
        dialog: (r) => ({
          title: "Mark Registry Completed",
          date: { label: "Completed Date", key: "CompletedDate" },
          info: "After confirming, switch to the Agreement tab and Mark as Registered.",
          cancel: "Cancel", confirm: "Confirm Completed", busy: "Saving…",
          path: `/api/crm/afs-registry/${r.Id}/complete`, method: "PUT",
          done: () => "Registry completed. Next: Mark Registered on the agreement, with the registration no. and date.",
        }),
      },
    ],
    empty: "No AFS registry records.",
  },
  {
    createAction: { label: "Request NOC", pages: ["crm-noc"], screen: "CrmNoc" },
    key: "noc", about: "No Objection Certificates", icon: ShieldCheck, label: "NOC", group: "Legal & Possession", pages: ["crm-noc"], path: "/api/crm/noc",
    rows: (b) => (Array.isArray(b) ? b : list(b?.rows)), id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.NocNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.NocType, r.ProjectName),
    ],
    searchIn: (r) => [r.NocNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.NocType, r.Status, r.ProjectName],
    open: (r) => (r.BookingId ? { to: "noc" as const, bookingId: Number(r.BookingId), title: r.NocNo || r.ApplicantName || "NOC" } : null),
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.CreatedAt,
    empty: "No NOC records.",
  },
  {
    createAction: { label: "New Sale Deed", pages: ["crm-sales-deed"], screen: "CrmSaleDeed" },
    key: "sales-deed", about: "Sale deed and registration records", icon: FileText, label: "Sale Deed", group: "Legal & Possession", pages: ["crm-sales-deed"], path: "/api/crm/sales-deed",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.DeedNo, r.BookingNo, r.UnitNo),
    status: (r) => r.Status,
    lines: (r) => [
      joinDot(r.ProjectName, r.CreatedAt && `Created ${fmtDate(r.CreatedAt)}`),
    ],
    searchIn: (r) => [r.DeedNo, r.ApplicantName, r.BookingNo, r.UnitNo, r.ProjectName, r.Status],
    open: (r) => (r.BookingId ? { to: "sale-deed" as const, bookingId: Number(r.BookingId), title: r.DeedNo || r.ApplicantName || "Sale Deed" } : null),
    dateOf: (r) => r.CreatedAt,
    empty: "No sale deed records.",
  },
  {
    createAction: { label: "New Mutation", pages: ["crm-mutation"], screen: "CrmMutation" },
    key: "mutation", about: "Property mutation after sale deed", icon: UserCog, label: "Property Mutation", group: "Legal & Possession", pages: ["crm-mutation"], path: "/api/crm/mutation",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.Status,
    lines: (r) => [
      r.DeedNo && `Deed ${r.DeedNo}`,
      joinDot(r.RegistrationNo && `Reg ${r.RegistrationNo}`, r.DocsRequired && `${r.DocsVerified ?? 0}/${r.DocsRequired} docs`),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.DeedNo, r.RegistrationNo, r.Status],
    open: (r) => (r.BookingId ? { to: "mutation" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || r.BookingNo || "Mutation" } : null),
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.CreatedAt,
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
    open: (r) => (r.BookingId ? { to: "possession" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || r.BookingNo || "Possession" } : null),
    amountOf: (r) => r.Balance,
    mobile: (r) => r.Mobile,
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
    createAction: { label: "New Parking Sale", pages: ["crm-parking-booking"], screen: "CrmParkingSale" },
    key: "parking-booking", about: "Parking allotted to bookings", icon: Car, label: "Parking Bookings", group: "Units & Parking", pages: ["crm-parking-booking"], path: "/api/crm/parking",
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.SlotNo, r.BookingNo, r.ProjectName),
    status: (r) => r.PaymentStatus,
    lines: (r) => [
      joinDot(r.ParkingType || r.CurrentParkingType, r.BlockName),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.SlotNo, r.ProjectName, r.PaymentStatus],
    open: (r) => ({ to: "parking-allotment" as const, allotment: r }),
    empty: "No parking allotments.",
  },
  {
    key: "oc-cc", about: "Occupancy and completion certificates by project", icon: Award, label: "OC / CC", group: "Units & Parking", pages: ["crm-oc-cc"], path: "/api/crm/oc-cc",
    // The web page (CrmOcCc.tsx): each certificate's type, scope, status and what it means for possession; a row opens
    // it (Edit / Mark as Issued), and File Application records a new one — the web's form, checks and messages.
    createAction: { label: "File Application", pages: ["crm-oc-cc"], screen: "CrmOcCcCert" },
    rows: list, id: (r) => String(r.Id),
    title: (r) => CERT_TYPE_LABEL[r.CertType] ?? r.CertType, sub: (r) => joinDot(r.ProjectName, r.BlockName ? `Block ${r.BlockName}` : "Entire project"),
    status: (r) => CERT_STATUS_LABEL[r.Status] ?? r.Status,
    lines: (r) => [
      r.Status === "Received" ? "Cleared for possession" : "Not cleared for possession",
      joinDot(r.ApplicationDate && `Applied ${fmtDate(r.ApplicationDate)}`, r.Status === "Received" && r.ReceivedDate && `Issued ${fmtDate(r.ReceivedDate)}`, r.CertificateNo),
      r.IssuedBy,
      Number(r.BookingsAwaitingPossession) > 0 && (r.Status === "Received" ? `${r.BookingsAwaitingPossession} can go on to the Pre-Possession check` : `${r.BookingsAwaitingPossession} on hold at Pre-Possession until this is issued`),
    ],
    searchIn: (r) => [r.ProjectName, r.BlockName, r.CertType, r.Status, r.CertificateNo, r.IssuedBy],
    mobile: () => null,
    open: (r) => ({ to: "oc-cc-cert" as const, cert: r }),
    dateOf: (r) => r.ApplicationDate,
    cardAction: [
      {
        label: "View Board", pages: ["crm-oc-cc"], right: "edit", outline: true,
        to: () => ({ screen: "CrmOcCcBoard", params: {} }),
      },
    ],
    empty: "No OC/CC records.",
  },
  // ── Finance (continued) ────────────────────────────────────────────────────
  {
    key: "loan-tracking", webPath: "/crm/loan-details", about: "Home loan and bank co-ordination", icon: Wallet, label: "Home Loan Tracking", group: "Finance", pages: ["crm-loan-details"], path: "/api/crm/loan-summary",
    rows: list, id: (r) => String(r.BookingId),
    title: (r) => r.ApplicantName, sub: (r) => joinDot(r.BookingNo, r.UnitNo, r.ProjectName),
    status: (r) => r.SanctionStatus,
    amount: (r) => (r.LoanAmount ? { label: "Loan amount", value: money(r.LoanAmount) } : null),
    lines: (r) => [
      joinDot(r.BankName, r.BranchName, r.RmName && `RM: ${r.RmName}`),
      joinDot(r.SanctionDate && `Sanctioned ${fmtDate(r.SanctionDate)}`, r.LoanAccountNo),
    ],
    searchIn: (r) => [r.ApplicantName, r.BookingNo, r.UnitNo, r.BankName, r.SanctionStatus, r.LoanAccountNo],
    open: (r) => (r.BookingId ? { to: "loan-tracking" as const, bookingId: Number(r.BookingId), title: r.ApplicantName || r.BookingNo || "Loan Tracking" } : null),
    mobile: (r) => r.Mobile,
    amountOf: (r) => r.LoanAmount,
    // The web Loan Tracking dialog (CrmLoanTracking.tsx): PUT /api/crm/bookings/:id/loan with the same fields; tap a row.
    editForm: { pages: ["crm-loan-details"], path: "/api/crm/bookings", noun: "loan details", noAdd: true,
      savePath: (r) => `/api/crm/bookings/${r.BookingId}/loan`,
      // The web dialog's own two checks, in its words.
      check: (v) => (["Sanctioned", "Disbursed"].includes(String(v.SanctionStatus)) && !(Number(v.LoanAmount) > 0) ? "Enter the sanctioned amount"
        : ["Applied", "Sanctioned", "Disbursed"].includes(String(v.SanctionStatus)) && !String(v.BankName ?? "").trim() ? "Enter the bank" : null),
      fields: [
        { key: "SanctionStatus", label: "Status", kind: "choice", options: [
          { value: "NotApplied", label: "Not applied" }, { value: "Applied", label: "Applied" }, { value: "Sanctioned", label: "Sanctioned" },
          { value: "Disbursed", label: "Disbursed" }, { value: "Rejected", label: "Rejected" },
        ] },
        { key: "BankName", label: "Bank", kind: "text" },
        { key: "BranchName", label: "Branch", kind: "text" },
        { key: "LoanAmount", label: "Loan amount (₹)", kind: "number" },
        { key: "SanctionDate", label: "Sanction date", kind: "date" },
        { key: "LoanAccountNo", label: "Loan account no.", kind: "text" },
        { key: "RmName", label: "Bank RM", kind: "text" },
        { key: "RmContact", label: "RM contact", kind: "text" },
        { key: "Notes", label: "Notes", kind: "text" },
      ] },
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
    open: (r) => ({ to: "brokerage" as const, brokerageId: Number(r.Id), title: r.BrokerName || r.BookingNo || "Brokerage" }),
    amountOf: (r) => r.ComputedAmount,
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
    open: (r) => (r.BrokerageId ? { to: "brokerage" as const, brokerageId: Number(r.BrokerageId), title: r.BrokerName || r.BookingNo || "Brokerage" } : null),
    dateOf: (r) => r.PaidDate, amountOf: (r) => r.Amount,
    // Web: retry the Finance hand-off when approval succeeded but Finance link failed
    cardAction: {
      label: "Retry Finance Handoff", pages: ["crm-brokerage"], right: "edit" as const,
      when: (r) => r.BrokerageStatus === "Approved" && !r.FinancePaymentId,
      call: (r) => ({ path: `/api/crm/brokerage/${r.BrokerageId}/retry-finance-handoff`, method: "PUT", done: () => "Finance handoff retried" }),
    },
    empty: "No broker payments.",
  },
  // ── After-Sales ────────────────────────────────────────────────────────────
  {
    createAction: { label: "New Cancellation", pages: ["crm-cancellations"], screen: "CrmCancellationNew" },
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
    mobile: (r) => r.Mobile,
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
    // The web page (CrmResales.tsx): status words, the step it is on, Cancel (with a reason) and New resale or buy-back.
    createAction: { label: "New resale or buy-back", pages: ["crm-resales"], screen: "CrmResaleNew" },
    rows: list, id: (r) => String(r.Id),
    title: (r) => r.FromCustomerName, sub: (r) => joinDot(r.Kind === "BuyBack" ? "Buy-back" : "Resale", r.FromBookingNo, r.Kind === "BuyBack" ? "back to us" : r.ToCustomerName),
    status: (r) => (r.Status === "Draft" ? "Being prepared" : r.Status === "Rejected" ? "Sent back" : r.Status === "Pending" ? "Awaiting approval"
      : r.Status === "Approved" && r.Kind === "BuyBack" && r.PayoutNewPaymentId ? "With Finance" : r.Status),
    amount: (r) => (r.AgreedValue ? { label: r.Kind === "BuyBack" ? "Buy-back price" : "Agreed price", value: money(r.AgreedValue) } : null),
    lines: (r) => [
      r.StageLabel && r.StageCount && `Step ${r.StageNo} of ${r.StageCount}: ${r.StageLabel}${r.StageTodo ? ` · ${r.StageTodo} thing${r.StageTodo === 1 ? "" : "s"} left` : ""}`,
      r.Status === "Rejected" && r.RejectionNote,
      r.ResaleDate && fmtDate(r.ResaleDate),
    ],
    searchIn: (r) => [r.FromBookingNo, r.ToBookingNo, r.FromCustomerName, r.ToCustomerName, r.Kind, r.Status],
    open: (r) => ({ to: "resale" as const, resaleId: Number(r.Id), title: r.FromCustomerName || r.FromBookingNo || "Resale" }),
    cardAction: {
      label: "Cancel", outline: true, danger: true, pages: ["crm-resales"], right: "edit",
      when: (r) => !["Completed", "Cancelled"].includes(r.Status) && !(r.Kind === "BuyBack" && r.PayoutNewPaymentId),
      dialog: (r) => ({
        title: `Cancel ${r.Kind === "BuyBack" ? "buy-back" : "resale"} case #${r.Id}?`,
        body: "The property stays with its current owner and the case stops. Its unsigned transfer deed is cancelled with it, and the buyer's draft application is closed. A signed or registered deed, a fee invoice or payment, or a payout with Finance has to be settled first — you'll be told which.",
        notes: { label: "Reason *", placeholder: "Why is it being cancelled?", key: "reason", required: true },
        cancel: "Keep it", confirm: "Cancel the case", busy: "Cancelling…", danger: true,
        path: `/api/crm/resales/${r.Id}/cancel`, method: "PUT", done: (d) => d?.message || "Cancelled",
      }),
    },
    mobile: (r) => r.Mobile,
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
    open: (r) => ({ to: "transfer-deed" as const, deedId: Number(r.Id), title: r.DeedNo || r.BookingNo || "Transfer Deed" }),
    dateOf: (r) => r.CreatedAt,
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
    open: (r) => ({ to: "ownership-change" as const, changeId: Number(r.Id), title: r.ChangeNo || r.BookingNo || "Ownership Change" }),
    mobile: (r) => r.Mobile,
    dateOf: (r) => r.CreatedAt,
    empty: "No ownership change records.",
  },

  {
    key: "sent-back", about: "Entries sent back for an update, or resubmitted for a recheck", icon: Undo2, label: "Sent back & rechecks", group: "Buyers & Bookings",
    pages: ["crm-dashboard", "crm-bookings", "crm-applications", "crm-payments"], path: "/api/crm/dashboard/sent-back",
    rows: (b) => (Array.isArray(b?.rows) ? b.rows : []), id: (r) => `${r.Kind}-${r.RecordId}-${r.State}`,
    title: (r) => joinDot(r.area, r.RecordNo), sub: (r) => joinDot(r.BookingNo !== r.RecordNo && r.BookingNo, r.Item, r.Stage),
    status: (r) => (r.State === "SentBack" ? "Sent back" : "To recheck"),
    lines: (r) => [r.Reason, joinDot(r.ByName && `By ${r.ByName}`, r.At && fmtDate(r.At))],
    searchIn: (r) => [r.RecordNo, r.BookingNo, r.Item, r.Reason, r.ByName, r.area],
    open: (r) => {
      if (r.Kind === "crm-brokerage" && r.RecordId) return { to: "brokerage" as const, brokerageId: Number(r.RecordId), title: r.RecordNo || "Brokerage" };
      if (r.Kind === "crm-transfer-deed-date" && r.RecordId) return { to: "transfer-deed" as const, deedId: Number(r.RecordId), title: r.RecordNo || "Transfer Deed" };
      if (r.Kind === "crm-noc" && r.BookingId) return { to: "noc" as const, bookingId: Number(r.BookingId), title: r.RecordNo || "NOC" };
      if ((r.Kind === "crm-sales-deed-senior" || r.Kind === "crm-sales-deed-director") && r.BookingId) return { to: "sale-deed" as const, bookingId: Number(r.BookingId), title: r.RecordNo || "Sale Deed" };
      if (r.Kind === "crm-refund" && r.RecordId) return { to: "refund" as const, refundId: Number(r.RecordId), title: r.RecordNo || "Refund" };
      if (r.Kind === "crm-cancellation" && r.RecordId) return { to: "cancellation" as const, cancellationId: Number(r.RecordId), title: r.RecordNo || "Cancellation" };
      // A payment or waiver sent back: its booking's payment plan, where it is corrected (not a new-payment form).
      if ((r.Kind === "payment" || r.Kind === "crm-milestone-waiver") && r.BookingId) return { to: "payment-plan" as const, bookingId: Number(r.BookingId), title: `Payments — ${r.BookingNo || "Booking"}` };
      if (r.Kind === "review" && r.ApplicationId) return { to: "application" as const, applicationId: Number(r.ApplicationId) };
      return toBooking(r);
    },
    dateOf: (r) => r.At, projectOf: () => null,
    empty: "Nothing sent back or waiting for a recheck.",
  },

  // ── Setup (the web's CRM Setup menu, src/components/layout/setupMenus.ts crmSetupItems) — read on the phone ──
  {
    key: "setup-project-types", about: "What each kind of project sells", icon: LayoutGrid, label: "Project Type", group: "Setup",
    pages: ["project-type-master"], path: "/api/project-type-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.Name, sub: (r) => joinDot(r.Code, plural(r.ProjectCount, "project"), plural(r.BlockCount, "block")),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    lines: (r) => [
      [r.SellsLand && "Land", r.SellsConstruction && "Construction", r.SellsResidential && "Residential", r.SellsCommercial && "Commercial", r.HasFloors && "Floors"].filter(Boolean).join(" · "),
      r.ProjectNames, r.Description,
    ],
    searchIn: (r) => [r.Name, r.Code, r.ProjectNames], projectOf: () => null, empty: "No project types.",
    editForm: {
      pages: ["project-type-master"], path: "/api/project-type-master", noun: "project type",
      del: { ask: (r) => `Delete project type ${r.Name}? This cannot be undone.`, done: "Project type deleted",
        locked: (r) => (Number(r.ProjectCount) > 0 ? `Used by ${r.ProjectCount} project(s) — deactivate it instead` : null) },
      fields: [
        { key: "Name", label: "Type Name", kind: "text" },
        { key: "Code", label: "Code", kind: "text", hint: "e.g. ROW_HOUSING" },
        { key: "Description", label: "Description", kind: "text" },
        { key: "HasFloors", label: "Units stack on floors (Towers)", kind: "switch" },
        { key: "SellsLand", label: "Sells land (Plots)", kind: "switch" },
        { key: "SellsConstruction", label: "Sells construction (Flats/Villas)", kind: "switch" },
        { key: "SellsResidential", label: "Sells residential", kind: "switch" },
        { key: "SellsCommercial", label: "Sells commercial", kind: "switch" },
        { key: "IsActive", label: "Active", kind: "switch" },
      ],
    },
  },
  {
    key: "setup-units", about: "Every unit with its area and rate", icon: Ruler, label: "Unit Master", group: "Setup",
    pages: ["followup-unit-master"], path: "/api/unit-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.UnitName, sub: (r) => joinDot(r.ProjectName, r.BlockName, r.FloorNo != null && `Floor ${r.FloorNo}`),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    amount: (r) => (Number(r.RatePerSqFt) ? { label: "Rate / sq ft", value: money(r.RatePerSqFt) } : null),
    lines: (r) => [joinDot(r.UnitType, r.UnitKind), Number(r.AreaSqFt) > 0 && `${Number(r.AreaSqFt)} sq ft`],
    searchIn: (r) => [r.UnitName, r.ProjectName, r.BlockName, r.UnitType], amountOf: (r) => Number(r.RatePerSqFt), empty: "No units.",
    editForm: {
      // The web's unit edit (autoSetup/UnitTree.tsx): name, floor, type, the areas and rate; it sends the unit's own
      // project, block, status, kind and plans with them; units are made by Auto Project Setup (no New here).
      pages: ["followup-unit-master"], path: "/api/unit-master", noun: "unit", noAdd: true,
      check: (v) => (!String(v.UnitName ?? "").trim() ? "Unit name is required" : null),
      extra: (r) => ({ ProjectId: r.ProjectId, BlockId: r.BlockId, IsActive: r.IsActive !== false, UnitKind: r.UnitKind || undefined,
        PaymentPlanIds: r.PaymentPlanIds ? String(r.PaymentPlanIds).split(",").map((x) => parseInt(x, 10)).filter(Number.isFinite) : [] }),
      saved: (d) => `${d?.message || "Unit updated"}${d?.roomSync?.added ? ` — ${d.roomSync.added} room(s) added from the ${d.roomSync.layout} layout` : ""}${d?.roomSync?.deactivated ? `, ${d.roomSync.deactivated} old room(s) deactivated` : ""}`,
      del: { ask: (r) => `Delete unit "${r.UnitName}"?`, done: "Unit deleted" },
      fields: [
        { key: "UnitName", label: "Unit name", kind: "text" },
        { key: "FloorNo", label: "Floor no.", kind: "number" },
        { key: "UnitType", label: "Unit type", kind: "text" },
        { key: "AreaSqFt", label: "Area (sq ft)", kind: "number" },
        { key: "CarpetAreaSqFt", label: "Carpet area (sq ft)", kind: "number" },
        { key: "BuiltUpAreaSqFt", label: "Built-up area (sq ft)", kind: "number" },
        { key: "SuperBuiltUpAreaSqFt", label: "Super built-up area (sq ft)", kind: "number" },
        { key: "OpenTerraceAreaSqFt", label: "Open terrace area (sq ft)", kind: "number" },
        { key: "RatePerSqFt", label: "Rate / sq ft (₹)", kind: "number" },
      ],
    },
  },
  {
    key: "setup-plots", about: "Plots with size, facing and rate", icon: Map, label: "Plot Master", group: "Setup",
    pages: ["crm-auto-project-setup"], path: "/api/plot-master",
    rows: (b) => (Array.isArray(b) ? b : b?.rows ?? []), id: (r) => String(r.Id), title: (r) => r.PlotName || r.PlotNo, sub: (r) => joinDot(r.ProjectName, r.BlockName, r.SurveyNo && `Survey ${r.SurveyNo}`),
    amount: (r) => (Number(r.RatePerSqFt) ? { label: "Rate / sq ft", value: money(r.RatePerSqFt) } : null),
    lines: (r) => [
      joinDot(Number(r.AreaSqFt) && `${Number(r.AreaSqFt)} sq ft`, r.PlotWidthFt && r.PlotDepthFt && `${r.PlotWidthFt} × ${r.PlotDepthFt} ft`, r.Facing && `${r.Facing} facing`, r.IsCornerPlot && "Corner"),
      r.PlannedVillaTypeName && `Planned villa: ${r.PlannedVillaTypeName}`, r.ConvertedUnitName && `Villa ${r.ConvertedUnitName}`,
    ],
    searchIn: (r) => [r.PlotName, r.PlotNo, r.ProjectName, r.BlockName, r.SurveyNo], amountOf: (r) => Number(r.RatePerSqFt), empty: "No plots.",
    editForm: {
      pages: ["crm-auto-project-setup"], path: "/api/plot-master", noun: "plot",
      del: { ask: (r) => `Delete plot ${r.PlotName || r.PlotNo}? This cannot be undone.`, done: "Plot deleted",
        locked: (r) => (r.ConvertedUnitId ? "Already converted to villa unit" : null) },
      fields: [
        { key: "PlotNo", label: "Plot No", kind: "text" },
        { key: "PlotName", label: "Plot Name", kind: "text" },
        { key: "AreaSqFt", label: "Area (sq ft)", kind: "number" },
        { key: "RatePerSqFt", label: "Rate / sq ft (₹)", kind: "number" },
        { key: "PlotWidthFt", label: "Width (ft)", kind: "number" },
        { key: "PlotDepthFt", label: "Depth (ft)", kind: "number" },
        { key: "Facing", label: "Facing (North, East...)", kind: "text" },
        { key: "IsCornerPlot", label: "Corner Plot", kind: "switch" },
        { key: "SurveyNo", label: "Survey No", kind: "text" },
      ],
    },
  },
  {
    key: "setup-blocks", about: "Blocks / towers of each project", icon: Layers, label: "Block Master", group: "Setup",
    pages: ["followup-block-master"], path: "/api/block-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.BlockName, sub: (r) => r.ProjectName,
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    lines: (r) => [r.PaymentPlanNames && `Plans: ${String(r.PaymentPlanNames).split("|").join(", ")}`, r.LockBookingNo && `Locked by ${r.LockBookingNo}`],
    searchIn: (r) => [r.BlockName, r.ProjectName], empty: "No blocks.",
    editForm: {
      pages: ["followup-block-master"], path: "/api/block-master", noun: "block",
      del: { ask: (r) => `Delete block ${r.BlockName}? This cannot be undone.`, done: "Block deleted",
        locked: (r) => (r.LockBookingNo ? `Locked by booking ${r.LockBookingNo} — cannot delete` : null) },
      fields: [
        { key: "BlockName", label: "Block Name", kind: "text" },
        { key: "IsActive", label: "Active", kind: "switch" },
      ],
    },
  },
  {
    key: "setup-payment-plans", about: "Plans and their milestone percentages", icon: ClipboardList, label: "Payment Plan Master", group: "Setup",
    pages: ["crm-payment-plans"], path: "/api/crm/payment-plans?showAll=true",
    rows: list, id: (r) => String(r.Id), title: (r) => r.PlanName, sub: (r) => joinDot(plural(r.ItemCount, "milestone"), r.TotalPercent != null && `${Number(r.TotalPercent)}%`),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    amount: (r) => (Number(r.BookingAmount) ? { label: "Booking amount", value: money(r.BookingAmount) } : null),
    lines: (r) => [r.Description], searchIn: (r) => [r.PlanName, r.Description], dateOf: (r) => r.CreatedAt, projectOf: () => null, empty: "No payment plans.",
    editForm: {
      pages: ["crm-payment-plans"], path: "/api/crm/payment-plans", noun: "payment plan",
      del: { ask: (r) => `Delete plan ${r.PlanName}? This cannot be undone.`, done: "Payment plan deleted",
        locked: (r) => (Number(r.ItemCount) > 0 ? "Has milestones attached" : null) },
      fields: [
        { key: "PlanName", label: "Plan Name", kind: "text" },
        { key: "Description", label: "Description", kind: "text" },
        { key: "BookingAmount", label: "Booking Amount (₹)", kind: "number" },
        { key: "IsActive", label: "Active", kind: "switch" },
      ],
    },
  },
  {
    key: "setup-milestones", about: "The milestone names plans are built from", icon: Flag, label: "Milestone Master", group: "Setup",
    pages: ["crm-milestone-master", "crm-payment-plans"], path: "/api/crm/milestone-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.Name, sub: (r) => joinDot(`Order ${r.SortOrder ?? "—"}`, `Used in ${plural(r.PlanCount, "plan")}`),
    status: (r) => (r.IsActive === false ? "Inactive" : null), searchIn: (r) => [r.Name], projectOf: () => null, empty: "No milestones.",
    editForm: { pages: ["crm-milestone-master"], path: "/api/crm/milestone-master", noun: "milestone",
      del: { ask: (r) => `Delete the milestone ${r.Name}? This cannot be undone.`, done: "Milestone deleted",
        locked: (r) => (Number(r.PlanCount) > 0 ? `Used by ${r.PlanCount} payment plan(s) — deactivate it instead` : null) },
      fields: [
      { key: "Name", label: "Name", kind: "text" },
      { key: "SortOrder", label: "Order", kind: "number" },
      { key: "IsActive", label: "Active", kind: "switch" },
    ] },
  },
  {
    key: "setup-brokerage-tiers", about: "Commission rate by deal value", icon: Percent, label: "Brokerage Rate Tiers", group: "Setup",
    pages: ["crm-brokerage-rate-tiers"], path: "/api/crm/brokerage-rate-tiers",
    rows: list, id: (r) => String(r.Id), title: (r) => `${Number(r.RatePercent)}% commission`,
    sub: (r) => (r.MaxDealValue != null ? `${money(r.MinDealValue)} to ${money(r.MaxDealValue)}` : `${money(r.MinDealValue)} and above`),
    status: (r) => (r.IsActive === false ? "Inactive" : null), projectOf: () => null, empty: "No rate tiers.",
    editForm: { pages: ["crm-brokerage-rate-tiers"], path: "/api/crm/brokerage-rate-tiers", noun: "tier",
      del: { ask: (r) => `Delete the ${r.RatePercent}% tier (${money(r.MinDealValue)} – ${r.MaxDealValue != null ? money(r.MaxDealValue) : "and above"})? This cannot be undone.`, done: "Tier deleted" },
      fields: [
      { key: "MinDealValue", label: "Min deal value (₹)", kind: "number" },
      { key: "MaxDealValue", label: "Max deal value (₹)", kind: "number", hint: "Leave blank for no upper limit" },
      { key: "RatePercent", label: "Rate %", kind: "number" },
      { key: "IsActive", label: "Active", kind: "switch" },
    ] },
  },
  {
    key: "setup-gst-rules", about: "Which GST rate applies to which sale", icon: Percent, label: "GST Rules", group: "Setup",
    pages: ["crm-gst-rule-master"], path: "/api/crm-gst-rule",
    rows: list, id: (r) => String(r.Id), title: (r) => r.Name, sub: (r) => joinDot(r.AppliesTo, r.HsnCode && `HSN ${r.HsnCode}`, r.HsnRate != null && `${Number(r.HsnRate)}%`),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    lines: (r) => [
      (r.MinValue != null || r.MaxValue != null) && `Value ${r.MinValue != null ? money(r.MinValue) : "any"} to ${r.MaxValue != null ? money(r.MaxValue) : "any"}`,
      joinDot(r.ForCommercial && "Commercial", r.LandOwnedByCustomer && "Land owned by customer", r.Priority != null && `Priority ${r.Priority}`),
      r.HsnDescription, r.Notes,
    ],
    searchIn: (r) => [r.Name, r.AppliesTo, r.HsnCode], projectOf: () => null, empty: "No GST rules.",
  },
  {
    key: "setup-extra-charges", about: "Extra charges added to bookings", icon: PlusCircle, label: "Extra Charge Master", group: "Setup",
    pages: ["followup-extra-charge-master"], path: "/api/extra-charge-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.ChargeName, sub: (r) => joinDot(r.GstRate != null && `GST ${Number(r.GstRate)}%`, `Used on ${plural(r.UseCount, "booking")}`),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    amount: (r) => (Number(r.DefaultAmount) ? { label: "Default", value: money(r.DefaultAmount) } : null),
    searchIn: (r) => [r.ChargeName], amountOf: (r) => Number(r.DefaultAmount), projectOf: () => null, empty: "No extra charges.",
    editForm: { pages: ["followup-extra-charge-master"], path: "/api/extra-charge-master", noun: "charge",
      del: { ask: (r) => `Delete ${r.ChargeName}? This cannot be undone.`, done: "Extra charge type deleted!",
        locked: (r) => (Number(r.UseCount) > 0 ? `Used on ${r.UseCount} booking charge(s) — deactivate it instead` : null) },
      fields: [
      { key: "ChargeName", label: "Charge name", kind: "text" },
      { key: "DefaultAmount", label: "Default amount (₹)", kind: "number" },
      { key: "GstRate", label: "GST %", kind: "number" },
      { key: "IsActive", label: "Active", kind: "switch" },
    ] },
  },
  {
    key: "setup-parking-rates", about: "Parking charge per type and block", icon: Car, label: "Parking Rate Master", group: "Setup",
    pages: ["followup-parking-master"], path: "/api/parking-master",
    rows: list, id: (r) => String(r.Id), title: (r) => r.ParkingType, sub: (r) => joinDot(r.ProjectName, r.BlockName),
    status: (r) => (r.IsActive === false ? "Inactive" : null),
    amount: (r) => ({ label: "Charge", value: money(r.Charge) }),
    lines: (r) => [joinDot(r.GstRate != null && `GST ${Number(r.GstRate)}%`, r.InUse && "In use")],
    searchIn: (r) => [r.ParkingType, r.ProjectName, r.BlockName], amountOf: (r) => Number(r.Charge), empty: "No parking rates.",
    editForm: {
      pages: ["followup-parking-master"], path: "/api/parking-master", noun: "parking rate",
      del: { ask: (r) => `Delete parking rate for ${r.ParkingType}? This cannot be undone.`, done: "Parking rate deleted",
        locked: (r) => (r.InUse ? "In use on existing bookings" : null) },
      fields: [
        { key: "ParkingType", label: "Parking Type", kind: "text" },
        { key: "Charge", label: "Charge (₹)", kind: "number" },
        { key: "GstRate", label: "GST %", kind: "number" },
        { key: "IsActive", label: "Active", kind: "switch" },
      ],
    },
  },
  {
    key: "setup-parking-slots", about: "Every parking slot and who holds it", icon: Hash, label: "Parking Slot Master", group: "Setup",
    pages: ["followup-parking-slot-master"], path: "/api/parking-slot-master",
    rows: list, id: (r) => String(r.Id), title: (r) => `Slot ${r.SlotNo}`, sub: (r) => joinDot(r.ParkingType, r.ProjectName, r.BlockName),
    status: (r) => (r.IsActive === false ? "Inactive" : r.LockBookingNo ? "Allotted" : r.LockHoldId ? "On hold" : "Available"),
    lines: (r) => [r.LockBookingNo && `Booking ${r.LockBookingNo}`],
    searchIn: (r) => [r.SlotNo, r.ParkingType, r.ProjectName, r.BlockName, r.LockBookingNo], empty: "No parking slots.",
    editForm: {
      // The web's slot edit (autoSetup/ParkingSetup.tsx): number and type, with the slot's project, block and status;
      // slots are generated by Auto Project Setup's parking template (no New here).
      pages: ["followup-parking-slot-master"], path: "/api/parking-slot-master", noun: "parking slot", noAdd: true,
      extra: (r) => ({ ProjectId: r.ProjectId, BlockId: r.BlockId, IsActive: r.IsActive !== false }),
      saved: (d) => d?.message || "Parking slot updated",
      del: { ask: (r) => `Delete parking slot "${r.SlotNo}"?`, done: "Parking slot deleted" },
      fields: [
        { key: "SlotNo", label: "Slot no.", kind: "text" },
        { key: "ParkingType", label: "Parking type", kind: "text" },
      ],
    },
  },
];

export const registerByKey = (key: string) => CRM_REGISTERS.find((r) => r.key === key);
/** The web page a list mirrors (its path in the web CRM menu). */
export const webPathOf = (r: CrmRegister) => r.webPath ?? `/crm/${r.key}`;

/** The header drawer's setup items on the CRM tab, in the web Setup menu's order, by section. `web` items are set up on
 * civiliererp.in (a wizard / an account-head form, not a list) and open there. */
export const SETUP_SECTIONS: { title: string; items: ({ register: string } | { web: string; label: string; about: string; icon: LucideIcon; pages: string[] })[] }[] = [
  { title: "Projects & units", items: [
    { web: "/crm/setup/auto-project-setup", label: "Auto Project Setup", about: "Create a project's blocks, units and plots", icon: Wand2, pages: ["crm-auto-project-setup"] },
    { register: "setup-project-types" }, { register: "setup-blocks" }, { register: "setup-units" }, { register: "setup-plots" },
  ] },
  { title: "Payments & tax", items: [{ register: "setup-payment-plans" }, { register: "setup-milestones" }, { register: "setup-gst-rules" }, { register: "setup-extra-charges" }] },
  { title: "Parking", items: [{ register: "setup-parking-rates" }, { register: "setup-parking-slots" }] },
  { title: "Brokers", items: [
    { web: "/masters/brokers", label: "Broker Master", about: "Brokers and their account details", icon: HardHat, pages: ["broker-master"] },
    { register: "setup-brokerage-tiers" },
  ] },
];

/** True when the person may open any CRM page (the web's CRM menu keys) — Home and the Menu show the CRM only then. */
export function useHasCrm() {
  const { canAccessPage } = useAuth();
  return canAccessPage("crm-dashboard") || CRM_REGISTERS.some((r) => r.group !== "Setup" && r.pages.some((p) => canAccessPage(p)));
}

/** The list a paired list belongs to (Call History → Welcome Calls), if any. */
export const pairParent = (key: string) => CRM_REGISTERS.find((r) => r.pair?.key === key);
/** The lists the CRM page shows on their own: not a paired list (it opens from its parent's switch). */
export const isListedRegister = (r: CrmRegister) => !pairParent(r.key);

/** The CRM lists the bottom bar's Menu also offers (TopHeader.tsx NavMenuSheet), in this order. */
export const MENU_LISTS = ["customer-360", "service-tickets", "construction-updates"];
