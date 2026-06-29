import { Category2, Profile2User, DocumentText, Wallet1, Building3, TickCircle, Message2, Notification } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Dashboard", icon: Category2, path: "/followup", pageKey: "followup-dashboard", isDashboard: true },

  {
    label: "Sales",
    icon: Profile2User,
    children: [
      { label: "Applications",           path: "/followup/sales/applications",           pageKey: "followup-applications" },
      { label: "Applicants Pipeline",    path: "/followup/sales/pipeline/applicants",    pageKey: "followup-applicants" },
      { label: "Bookings",               path: "/followup/sales/bookings",               pageKey: "followup-bookings" },
      { label: "Unit Selection",         path: "/followup/sales/unit-selection",         pageKey: "followup-unit-selections" },
      { label: "Unit Selection Pipeline",path: "/followup/sales/pipeline/unit-selections",pageKey: "followup-unit-selections" },
      { label: "Welcome Calls",          path: "/followup/sales/welcome-calls",          pageKey: "followup-welcome-calls" },
    ],
  },

  {
    label: "Agreement",
    icon: DocumentText,
    children: [
      { label: "Agreements",         path: "/followup/agreement/agreements",     pageKey: "followup-agreements" },
      { label: "Agreement Workflow", path: "/followup/agreement/workflow",       pageKey: "followup-agreements" },
      { label: "Legal Milestones",   path: "/followup/legal/milestones",         pageKey: "followup-legal-milestones" },
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
      { label: "Follow-Up Log",path: "/followup/follow-ups/log",   pageKey: "followup-tasks" },
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
