import { cn } from "../lib/utils";
import {
  CheckCircle2,
  Clock,
  FileEdit,
  SendHorizonal,
  XCircle,
  PackageCheck,
  PackageSearch,
} from "lucide-react";

// ─── Status config ────────────────────────────────────────────────────────────
// Add any new domain status here — nothing else needs to change.
const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; classes: string }
> = {
  // Generic approval states
  Draft: {
    label: "Draft",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Issued: {
    label: "Issued",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Pending: {
    label: "Pending",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Approved: {
    label: "Approved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Rejected: {
    label: "Rejected",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // A payment whose cheque was cancelled (see routes/chequeCancellation.js) —
  // distinct from "Rejected" (never approved) since this one was Approved
  // and posted to GL before being cancelled/reversed.
  Cancelled: {
    label: "Cancelled",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // Expense booking domain statuses
  Booked: {
    label: "Booked",
    icon: CheckCircle2,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Hold: {
    label: "Hold",
    icon: Clock,
    classes:
      "bg-yellow-500/10 text-yellow-600 border-yellow-500/25 dark:bg-yellow-500/10 dark:text-yellow-400 dark:border-yellow-500/25",
  },
  Received: {
    label: "Received",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  // GoodsReceiptNotes domain statuses
  "Partially Received": {
    label: "Partial",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  "Fully Received": {
    label: "Received",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  // Material Request domain statuses
  Ordered: {
    label: "Ordered",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  Completed: {
    label: "Completed",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  "Partially Ordered": {
    label: "Partial PO",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  "Partially Fulfilled": {
    label: "Partially Fulfilled",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  // Quotation domain statuses
  Sent: {
    label: "Sent",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  PartiallyQuoted: {
    label: "Partially Quoted",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  Quoted: {
    label: "Quoted",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  Closed: {
    label: "Closed",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  // Task Master domain statuses
  Active: {
    label: "Active",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Cancel: {
    label: "Cancelled",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // Task Master priority levels
  "Very Important": {
    label: "Very Important",
    icon: FileEdit,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  Important: {
    label: "Important",
    icon: FileEdit,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Normal: {
    label: "Normal",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  // Unit Master / Unit Matrix domain statuses — mirrors unitMatrix.js's
  // live-derived Status (Blocked/Booked/OnHold/Available) exactly.
  "On Hold": {
    label: "On Hold",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Available: {
    label: "Available",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Blocked: {
    label: "Blocked",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // Year-end housekeeping: partially-fulfilled PO/MR permanently retired —
  // see src/pages/material/ShortClose.tsx.
  "Short Closed": {
    label: "Short Closed",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },

  // ── CRM domain statuses (shared across every CRM page — see CrmStatus in
  // src/constants/crmStatuses.ts) — added so every CRM page can render the
  // same status word in the same color instead of each page's own
  // independently-invented status-color map. Colors follow the same
  // semantic convention already set above: emerald = done/good, amber =
  // waiting on someone, red = rejected/blocked/dead, blue = informational/
  // in-flight, slate = inactive/draft, orange = partial.
  Executed: {
    label: "Executed",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Registered: {
    label: "Registered",
    icon: PackageCheck,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  PendingCustomerReview: {
    label: "Awaiting Customer",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  FinancePending: {
    label: "Finance Pending",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Paid: {
    label: "Paid",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  "Partially Paid": {
    label: "Partially Paid",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  Voided: {
    label: "Voided",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Refunded: {
    label: "Refunded",
    icon: PackageCheck,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Demanded: {
    label: "Demanded",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  "Clawback Required": {
    label: "Clawback Required",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  Open: {
    label: "Open",
    icon: Clock,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  InProgress: {
    label: "In Progress",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Resolved: {
    label: "Resolved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Expired: {
    label: "Expired",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Transferred: {
    label: "Transferred",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  // Sale Deed / Transfer Deed legal sub-stages — distinct words from the
  // generic Pending/Approved pair above so a deed's own multi-step status
  // (not just a simple approval) still gets one consistent color.
  UnderReview: {
    label: "Under Review",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  LegalApproved: {
    label: "Legal Approved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  WithParties: {
    label: "With Parties",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  PartiesApproved: {
    label: "Parties Approved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  DateApproved: {
    label: "Date Approved",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },

  // ── Sales Automation (SA) domain statuses — added for the same reason as
  // the CRM block above: every SA page (lead management, inquiry dashboard,
  // follow-ups, site visits, lead transfers, ad/campaign masters) had
  // independently hand-rolled its own color map for these same words. See
  // backend/constants/saStatuses.js for the authoritative lead-status
  // transition table this mirrors.
  New: {
    label: "New",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Assigned: {
    label: "Assigned",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Contacted: {
    label: "Contacted",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  FollowUp: {
    label: "Follow-Up",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  VisitScheduled: {
    label: "Visit Scheduled",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Visited: {
    label: "Visited",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  Booking: {
    label: "Booking",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Lost: {
    label: "Lost",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  Converted: {
    label: "Converted",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  // Lead classification (Hot/Warm/Cold/NotInterested/CallBackLater) — same
  // "color by word" idea as a status, just a different field on the lead.
  Hot: {
    label: "Hot",
    icon: CheckCircle2,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  Warm: {
    label: "Warm",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Cold: {
    label: "Cold",
    icon: Clock,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  NotInterested: {
    label: "Not Interested",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  CallBackLater: {
    label: "Call Back Later",
    icon: Clock,
    classes:
      "bg-violet-500/10 text-violet-600 border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/25",
  },
  // Ad/Campaign lifecycle — Active/Completed/Cancelled already exist above.
  Paused: {
    label: "Paused",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  // Social-media integration sync status — Pending already exists above.
  Synced: {
    label: "Synced",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Failed: {
    label: "Failed",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  // Site-visit status — Completed/Cancelled already exist above.
  Scheduled: {
    label: "Scheduled",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Confirmed: {
    label: "Confirmed",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Rescheduled: {
    label: "Rescheduled",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  // Lead-task status — Open already exists above.
  Done: {
    label: "Done",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },

  // ── Closing the remaining gaps the CRM/SA UI/UX audits found unmigrated
  // (money-collection milestone status, refund/credit-note pipelines, loan
  // lifecycle, document/checklist verification, handover snag states).
  Overdue: {
    label: "Overdue",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  Waived: {
    label: "Waived",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Bounced: {
    label: "Bounced",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  FinanceApproved: {
    label: "Finance Approved",
    icon: PackageCheck,
    classes:
      "bg-teal-500/10 text-teal-600 border-teal-500/25 dark:bg-teal-500/10 dark:text-teal-400 dark:border-teal-500/25",
  },
  TimeBarred: {
    label: "Time-Barred",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Applied: {
    label: "Applied",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  PartiallyApplied: {
    label: "Partially Applied",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  Unapplied: {
    label: "Unapplied",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  NotApplied: {
    label: "Not Applied",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Sanctioned: {
    label: "Sanctioned",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Disbursed: {
    label: "Disbursed",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  QueryRaised: {
    label: "Query Raised",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Requested: {
    label: "Requested",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Uploaded: {
    label: "Uploaded",
    icon: SendHorizonal,
    classes:
      "bg-blue-500/10 text-blue-500 border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/25",
  },
  Verified: {
    label: "Verified",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Checked: {
    label: "Checked",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  NeedsRecheck: {
    label: "Needs Recheck",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Review: {
    label: "Under Review",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Deleted: {
    label: "Deleted",
    icon: XCircle,
    classes:
      "bg-slate-500/10 text-slate-500 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
  Ready: {
    label: "Ready",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Disputed: {
    label: "Disputed",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
  Reopened: {
    label: "Reopened",
    icon: PackageSearch,
    classes:
      "bg-orange-500/10 text-orange-500 border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/25",
  },
  SnagInspection: {
    label: "Snag Inspection",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  SnagPending: {
    label: "Snag Pending",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Drafted: {
    label: "Drafted",
    icon: FileEdit,
    classes:
      "bg-slate-500/10 text-slate-400 border-slate-500/25 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/25",
  },
};

// Unit Master / Unit Matrix domain statuses — mirrors unitMatrix.js's
// live-derived Status (Blocked/Booked/OnHold/Available) exactly.
// Kept in a separate constant to avoid static-analysis duplicate-property
// warnings (the amber/emerald classes appear on generic statuses above too).
const UNIT_STATUS_CONFIG: typeof STATUS_CONFIG = {
  "On Hold": {
    label: "On Hold",
    icon: Clock,
    classes:
      "bg-[#ffe2021a] text-amber-600 border-amber-500/25 dark:bg-[#ffe2021a] dark:text-amber-400 dark:border-amber-500/25",
  },
  Available: {
    label: "Available",
    icon: CheckCircle2,
    classes:
      "bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  Blocked: {
    label: "Blocked",
    icon: XCircle,
    classes:
      "bg-red-500/10 text-red-500 border-red-500/25 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/25",
  },
};

// Merged lookup — unit statuses override generics when keys collide.
const ALL_STATUS_CONFIG: typeof STATUS_CONFIG = {
  ...STATUS_CONFIG,
  ...UNIT_STATUS_CONFIG,
};


// Fallback for unknown statuses
const FALLBACK = {
  label: "Unknown",
  icon: FileEdit,
  classes: "bg-gray-100 text-gray-500 border-gray-200",
};

interface StatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

// For the rare case where a caller needs the color classes without the full
// badge markup — e.g. an interactive selectable-pill control (not a static
// display badge), which still shouldn't invent its own color-per-status map.
export function getStatusClasses(status: string | null | undefined): string {
  return ((status && ALL_STATUS_CONFIG[status]) || FALLBACK).classes;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = (status && ALL_STATUS_CONFIG[status]) || FALLBACK;
  const Icon = config.icon;

  // A page that prints its live DOM (window.print() on a preview modal, e.g.
  // ExpenseBookingPreviewModal.tsx) has no separate print HTML to intercept
  // — whatever's on screen prints as-is. "Pending" is a live system state,
  // not something to hand someone as paperwork, so a printed copy reads
  // "Provisional" instead via a print-only swap; the on-screen badge (and
  // every other status) is unaffected.
  const isPending = status === "Pending";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium",
        config.classes,
        className,
      )}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {isPending ? (
        <>
          <span className="print:hidden">{config.label}</span>
          <span className="hidden print:inline">Provisional</span>
        </>
      ) : (
        config.label
      )}
    </span>
  );
}