import { Category2, Profile2User, DocumentText, Wallet1, Building3, TickCircle, Message2, Notification } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Dashboard", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },

  {
    // "Applications", "Bookings", "Unit Selection", "Welcome Calls" retired from here —
    // 0 live rows each, duplicate CRM entry points that let a unit be double-booked
    // (FollowupBookings never checked UnitMaster availability the way CrmBooking does).
    // "Applicants Pipeline" / "Unit Selection Pipeline" are kept — they're read-only
    // pipeline views, not the CRUD front doors the audit flagged. See backend/server.js
    // and src/App.tsx for the matching route removals.
    label: "Sales",
    icon: Profile2User,
    children: [
      { label: "Applicants Pipeline",    path: "/followup/sales/pipeline/applicants",    pageKey: "followup-applicants" },
      { label: "Unit Selection Pipeline",path: "/followup/sales/pipeline/unit-selections",pageKey: "followup-unit-selections" },
    ],
  },

  {
    // "Agreements", "Agreement Workflow" and "Legal Milestones" retired from here —
    // all were parallel, never-actually-used systems (0 live rows in FollowupAgreements,
    // FollowupAgreementWorkflows, and FollowupLegalMilestones) sitting alongside the
    // real, actively-developed CRM equivalents (crmAgreements.js, crmLegalMilestones.js).
    // Keeping duplicate live entry points invited exactly the confusion this was retired
    // to fix. The route files/pages themselves are left on disk, just unreachable —
    // see backend/server.js and src/App.tsx for the matching removals.
    label: "Agreement",
    icon: DocumentText,
    children: [
      { label: "Document Vault",     path: "/followup/agreement/document-vault", pageKey: "followup-document-vault" },
      { label: "Communicator",       path: "/followup/agreement/communicator",   pageKey: "followup-communicator" },
    ],
  },

  {
    label: "Finance",
    icon: Wallet1,
    children: [
      { label: "Demands",  path: "/followup/finance/demands",  pageKey: "followup-demands" },
      { label: "Payments", path: "/followup/finance/payments", pageKey: "followup-payments" },
    ],
  },

  {
    label: "Construction",
    icon: Building3,
    children: [
      { label: "Updates", path: "/followup/construction/updates", pageKey: "followup-construction-updates" },
    ],
  },

  {
    label: "Closure",
    icon: TickCircle,
    children: [
      { label: "NOC",               path: "/followup/closure/noc",                pageKey: "followup-noc" },
      { label: "Bank NOC",          path: "/followup/closure/bank-noc",           pageKey: "followup-noc" },
      { label: "Sales Deed",        path: "/followup/closure/sales-deed",         pageKey: "followup-sales-deed" },
      { label: "Pre-Possession",    path: "/followup/closure/pre-possession",     pageKey: "followup-pre-possession" },
      { label: "Possession Notice", path: "/followup/closure/possession-notice",  pageKey: "followup-possession-notice" },
      { label: "Handover",          path: "/followup/closure/handover",           pageKey: "followup-handover" },
    ],
  },

  {
    label: "CRM",
    icon: Message2,
    children: [
      { label: "Tasks",        path: "/followup/follow-ups/tasks", pageKey: "followup-tasks" },
      { label: "Follow-Up Log",path: "/followup/follow-ups/log",   pageKey: "followup-log" },
    ],
  },

  {
    label: "Reminders",
    icon: Notification,
    children: [
      { label: "PO Reminders",  path: "/followup/follow-ups/po-reminders",  pageKey: "followup-reminders" },
      { label: "WO Reminders",  path: "/followup/follow-ups/wo-reminders",  pageKey: "followup-reminders" },
      { label: "CHQ Reminders", path: "/followup/follow-ups/chq-reminders", pageKey: "followup-reminders" },
      { label: "TDS Reminders", path: "/followup/follow-ups/tds-reminders", pageKey: "followup-reminders" },
      { label: "GRN Reminders", path: "/followup/follow-ups/grn-reminders", pageKey: "followup-reminders" },
    ],
  },
];
