// src/constants/askCivilierQueries.ts
//
// Route-aware and module-aware suggested queries for the AskCivilierAI
// floating assistant. The assistant is mounted once, globally, in
// AppLayout — so instead of one static list (which only ever made sense
// on the home page) we resolve a relevant set of prompts based on where
// the user actually is:
//
//   1. PAGE_QUERIES   — exact-page overrides for the pages people live in
//                        day to day (GRN, Purchase Order, Bookings, etc).
//   2. MODULE_QUERIES — fallback for any page inside a module that
//                        doesn't have its own override yet.
//   3. DEFAULT_QUERIES — final fallback (home page / no module detected).
//
// `route` is always a real route — it's where the underlying data lives
// today, so "Open <module>" never points at a dead end even before the
// in-house LLM is wired up.
import {
  Package,
  BarChart3,
  Wrench,
  Users,
  FileCheck,
  Ticket,
  Receipt,
  Banknote,
  Boxes,
  ArrowLeftRight,
  ClipboardList,
  Building2,
  Hammer,
  Landmark,
  ClipboardCheck,
  ShieldCheck,
  History,
  ShelvingUnit,
} from "lucide-react";
import type { Module } from "@/contexts/module.utils";

export interface SuggestedQuery {
  id: string;
  label: string;
  module: string;
  route: string;
  icon: React.ElementType;
  accent: string;
}

// ─── Per-page overrides ─────────────────────────────────────────────────
// Keyed by route prefix. Matching is exact-or-nested (see matchesPath
// below), so "/material/stock" never accidentally matches
// "/material/stock-transfer".
export const PAGE_QUERIES: Record<string, SuggestedQuery[]> = {
  "/material/grn": [
    {
      id: "grn-pending",
      label: "Show pending GRNs awaiting invoice this week",
      module: "GRN",
      route: "/material/grn",
      icon: Package,
      accent: "#8b5cf6",
    },
    {
      id: "grn-godown",
      label: "Which GRNs failed to resolve a Main Godown?",
      module: "GRN",
      route: "/material/grn",
      icon: Package,
      accent: "#8b5cf6",
    },
    {
      id: "grn-unlinked",
      label: "List GRNs not yet linked to an expense booking",
      module: "GRN",
      route: "/material/grn",
      icon: Package,
      accent: "#8b5cf6",
    },
  ],
  "/material/purchase-order": [
    {
      id: "po-pending",
      label: "List purchase orders pending approval",
      module: "Purchase Orders",
      route: "/material/purchase-order",
      icon: ClipboardList,
      accent: "#6366f1",
    },
    {
      id: "po-draft",
      label: "Show POs still stuck in Draft status",
      module: "Purchase Orders",
      route: "/material/purchase-order",
      icon: ClipboardList,
      accent: "#6366f1",
    },
    {
      id: "po-from-mr",
      label: "Which material requests haven't converted to a PO yet?",
      module: "Purchase Orders",
      route: "/material/purchase-order",
      icon: ClipboardList,
      accent: "#6366f1",
    },
  ],
  "/material/material-request": [
    {
      id: "mr-pending",
      label: "Show material requests pending approval",
      module: "Material Requests",
      route: "/material/material-request",
      icon: ClipboardList,
      accent: "#6366f1",
    },
    {
      id: "mr-draft",
      label: "List MRs still in Draft status",
      module: "Material Requests",
      route: "/material/material-request",
      icon: ClipboardList,
      accent: "#6366f1",
    },
  ],
  "/material/issues": [
    {
      id: "issues-low-stock",
      label: "Show material issues short on available stock",
      module: "Material Issues",
      route: "/material/issues",
      icon: Boxes,
      accent: "#0ea5e9",
    },
    {
      id: "issues-today",
      label: "List today's material issue entries",
      module: "Material Issues",
      route: "/material/issues",
      icon: Boxes,
      accent: "#0ea5e9",
    },
  ],
  "/material/expense-booking": [
    {
      id: "exp-pending-payment",
      label: "List expense bookings pending payment",
      module: "Expense Booking",
      route: "/material/expense-booking",
      icon: Receipt,
      accent: "#f59e0b",
    },
    {
      id: "exp-draft",
      label: "Which expense bookings are still in Draft?",
      module: "Expense Booking",
      route: "/material/expense-booking",
      icon: Receipt,
      accent: "#f59e0b",
    },
    {
      id: "exp-gst",
      label: "Summarize this week's GST breakdown on bookings",
      module: "Expense Booking",
      route: "/material/expense-booking",
      icon: Receipt,
      accent: "#f59e0b",
    },
  ],
  "/material/stock": [
    {
      id: "stock-by-godown",
      label: "What's the current stock level by godown?",
      module: "Stock",
      route: "/material/stock",
      icon: Boxes,
      accent: "#0ea5e9",
    },
    {
      id: "stock-low",
      label: "List items below reorder level",
      module: "Stock",
      route: "/material/stock",
      icon: Boxes,
      accent: "#0ea5e9",
    },
  ],
  "/material/stock-transfer": [
    {
      id: "stock-transfer-recent",
      label: "Show recent stock transfers between godowns",
      module: "Stock Transfer",
      route: "/material/stock-transfer",
      icon: ArrowLeftRight,
      accent: "#0ea5e9",
    },
    {
      id: "stock-transfer-pending",
      label: "Which stock transfers are still in transit?",
      module: "Stock Transfer",
      route: "/material/stock-transfer",
      icon: ArrowLeftRight,
      accent: "#0ea5e9",
    },
  ],
  "/payments": [
    {
      id: "pay-by-mode",
      label: "Summarize today's payments by mode",
      module: "Payments",
      route: "/payments",
      icon: Banknote,
      accent: "#3b82f6",
    },
    {
      id: "pay-pending-approval",
      label: "List payments pending approval",
      module: "Payments",
      route: "/payments",
      icon: Banknote,
      accent: "#3b82f6",
    },
  ],
  "/received-payments": [
    {
      id: "recv-unallocated",
      label: "List received payments still unallocated",
      module: "Received Payments",
      route: "/received-payments",
      icon: Banknote,
      accent: "#3b82f6",
    },
    {
      id: "recv-month",
      label: "Summarize received payments this month",
      module: "Received Payments",
      route: "/received-payments",
      icon: Banknote,
      accent: "#3b82f6",
    },
  ],
  "/brs": [
    {
      id: "brs-pending",
      label: "Show pending bank reconciliation entries",
      module: "BRS",
      route: "/brs",
      icon: Landmark,
      accent: "#3b82f6",
    },
    {
      id: "brs-unmatched",
      label: "List unmatched bank statement lines",
      module: "BRS",
      route: "/brs",
      icon: Landmark,
      accent: "#3b82f6",
    },
  ],
  "/engineering/work-order": [
    {
      id: "wo-open",
      label: "List open work orders on active projects",
      module: "Work Orders",
      route: "/engineering/work-order",
      icon: Wrench,
      accent: "#ec4899",
    },
    {
      id: "wo-overdue",
      label: "Which work orders are overdue?",
      module: "Work Orders",
      route: "/engineering/work-order",
      icon: Wrench,
      accent: "#ec4899",
    },
  ],
  "/engineering/boq": [
    {
      id: "boq-variance",
      label: "Show BOQ items with quantity variance",
      module: "BOQ",
      route: "/engineering/boq",
      icon: Hammer,
      accent: "#ec4899",
    },
    {
      id: "boq-unlinked",
      label: "List BOQ activities not yet linked to a work order",
      module: "BOQ",
      route: "/engineering/boq",
      icon: Hammer,
      accent: "#ec4899",
    },
  ],
  "/engineering/work-done": [
    {
      id: "wd-pending",
      label: "List work done entries pending approval",
      module: "Work Done",
      route: "/engineering/work-done",
      icon: Hammer,
      accent: "#ec4899",
    },
    {
      id: "wd-this-week",
      label: "Show this week's work done by project",
      module: "Work Done",
      route: "/engineering/work-done",
      icon: Hammer,
      accent: "#ec4899",
    },
  ],
  "/followup/sales/bookings": [
    {
      id: "bookings-month",
      label: "How many bookings were confirmed this month?",
      module: "Bookings",
      route: "/followup/sales/bookings",
      icon: Users,
      accent: "#6366f1",
    },
    {
      id: "bookings-pending-agreement",
      label: "List bookings pending agreement",
      module: "Bookings",
      route: "/followup/sales/bookings",
      icon: Users,
      accent: "#6366f1",
    },
  ],
  "/followup/sales/applications": [
    {
      id: "apps-stuck",
      label: "List applications stuck in the pipeline",
      module: "Applications",
      route: "/followup/sales/applications",
      icon: Users,
      accent: "#6366f1",
    },
    {
      id: "apps-docs",
      label: "Show applications pending document verification",
      module: "Applications",
      route: "/followup/sales/applications",
      icon: Users,
      accent: "#6366f1",
    },
  ],
  "/followup/sales/pipeline/applicants": [
    {
      id: "pipeline-stuck",
      label: "Which applicants need a follow-up call?",
      module: "Applicants Pipeline",
      route: "/followup/sales/pipeline/applicants",
      icon: Users,
      accent: "#6366f1",
    },
  ],
  "/followup/agreement/agreements": [
    {
      id: "agr-pending-signature",
      label: "List agreements pending signature",
      module: "Agreements",
      route: "/followup/agreement/agreements",
      icon: ClipboardCheck,
      accent: "#6366f1",
    },
    {
      id: "agr-missing-docs",
      label: "Which agreements are missing documents?",
      module: "Agreements",
      route: "/followup/agreement/agreements",
      icon: ClipboardCheck,
      accent: "#6366f1",
    },
  ],
  "/followup/finance/demands": [
    {
      id: "demands-overdue",
      label: "Show overdue finance demand reminders",
      module: "Finance Demands",
      route: "/followup/finance/demands",
      icon: Receipt,
      accent: "#f59e0b",
    },
    {
      id: "demands-unpaid",
      label: "List unpaid finance demands by project",
      module: "Finance Demands",
      route: "/followup/finance/demands",
      icon: Receipt,
      accent: "#f59e0b",
    },
  ],
  "/followup/finance/payments": [
    {
      id: "fup-pay-month",
      label: "Summarize followup payments received this month",
      module: "Finance Payments",
      route: "/followup/finance/payments",
      icon: Banknote,
      accent: "#f59e0b",
    },
    {
      id: "fup-pay-plan",
      label: "Show payment plan compliance by customer",
      module: "Finance Payments",
      route: "/followup/finance/payments",
      icon: Banknote,
      accent: "#f59e0b",
    },
  ],
  "/followup/closure/handover": [
    {
      id: "handover-pending",
      label: "List units pending handover",
      module: "Handover",
      route: "/followup/closure/handover",
      icon: Building2,
      accent: "#6366f1",
    },
  ],
  "/admin/approval/inbox": [
    {
      id: "approval-waiting",
      label: "What's waiting in my approval inbox right now?",
      module: "Approvals",
      route: "/admin/approval/inbox",
      icon: FileCheck,
      accent: "#f59e0b",
    },
    {
      id: "approval-stale",
      label: "Show approvals pending more than 3 days",
      module: "Approvals",
      route: "/admin/approval/inbox",
      icon: FileCheck,
      accent: "#f59e0b",
    },
  ],
  "/admin/activity-browser": [
    {
      id: "activity-recent",
      label: "Show recent user activity logs",
      module: "Activity Browser",
      route: "/admin/activity-browser",
      icon: History,
      accent: "#f59e0b",
    },
    {
      id: "activity-top-users",
      label: "Which users made the most changes this week?",
      module: "Activity Browser",
      route: "/admin/activity-browser",
      icon: History,
      accent: "#f59e0b",
    },
  ],
  "/ticket/pending": [
    {
      id: "tickets-urgent",
      label: "Show urgent tickets still unresolved",
      module: "Tickets",
      route: "/ticket/pending",
      icon: Ticket,
      accent: "#f97316",
    },
    {
      id: "tickets-stale",
      label: "List tickets pending more than 2 days",
      module: "Tickets",
      route: "/ticket/pending",
      icon: Ticket,
      accent: "#f97316",
    },
  ],
  "/ticket/my-tickets": [
    {
      id: "my-tickets-open",
      label: "List my open tickets",
      module: "My Tickets",
      route: "/ticket/my-tickets",
      icon: Ticket,
      accent: "#f97316",
    },
  ],
  "/ticket/resolved": [
    {
      id: "tickets-resolved-week",
      label: "What tickets were resolved this week?",
      module: "Resolved Tickets",
      route: "/ticket/resolved",
      icon: ShieldCheck,
      accent: "#f97316",
    },
  ],
};

// ─── Module-level fallback ──────────────────────────────────────────────
// Used whenever the current page has no PAGE_QUERIES entry of its own,
// but the URL still falls inside a known module.
export const MODULE_QUERIES: Record<NonNullable<Module>, SuggestedQuery[]> = {
  finance: [
    {
      id: "mod-fin-payments",
      label: "Summarize today's payments by mode",
      module: "Finance",
      route: "/payments",
      icon: BarChart3,
      accent: "#3b82f6",
    },
    {
      id: "mod-fin-brs",
      label: "Show pending bank reconciliation entries",
      module: "Finance",
      route: "/brs",
      icon: Landmark,
      accent: "#3b82f6",
    },
  ],
  material: [
    {
      id: "mod-mat-grn",
      label: "Show pending GRNs awaiting invoice this week",
      module: "Material",
      route: "/material/grn",
      icon: Package,
      accent: "#8b5cf6",
    },
    {
      id: "mod-mat-stock",
      label: "What's the current stock level by godown?",
      module: "Material",
      route: "/material/stock",
      icon: Boxes,
      accent: "#8b5cf6",
    },
  ],
  followup: [
    {
      id: "mod-fup-bookings",
      label: "How many bookings were confirmed this month?",
      module: "Followup",
      route: "/followup/sales/bookings",
      icon: Users,
      accent: "#6366f1",
    },
    {
      id: "mod-fup-demands",
      label: "Show overdue finance demand reminders",
      module: "Followup",
      route: "/followup/finance/demands",
      icon: Receipt,
      accent: "#6366f1",
    },
  ],
  engineering: [
    {
      id: "mod-eng-wo",
      label: "List open work orders on active projects",
      module: "Engineering",
      route: "/engineering/work-order",
      icon: Wrench,
      accent: "#ec4899",
    },
    {
      id: "mod-eng-boq",
      label: "Show BOQ items with quantity variance",
      module: "Engineering",
      route: "/engineering/boq",
      icon: Hammer,
      accent: "#ec4899",
    },
  ],
  ticket: [
    {
      id: "mod-ticket-urgent",
      label: "Show urgent tickets still unresolved",
      module: "Tickets",
      route: "/ticket",
      icon: Ticket,
      accent: "#f97316",
    },
  ],
  sales: [
    {
      id: "mod-sales-orders",
      label: "Show recent sale orders",
      module: "Sales",
      route: "/sales/sale-order",
      icon: ShelvingUnit,
      accent: "#a855f7",
    },
  ],
  admin: [
    {
      id: "mod-admin-approvals",
      label: "What's waiting in my approval inbox right now?",
      module: "Approvals",
      route: "/admin/approval/inbox",
      icon: FileCheck,
      accent: "#f59e0b",
    },
    {
      id: "mod-admin-activity",
      label: "Show recent user activity logs",
      module: "Admin",
      route: "/admin/activity-browser",
      icon: History,
      accent: "#f59e0b",
    },
  ],
  records: [],
  civilworkdpr: [],
  "sales-automation": [],
  crm: [],
  loan: [],
};

// ─── Final fallback ─────────────────────────────────────────────────────
// Home page, or anywhere a module can't be determined.
export const DEFAULT_QUERIES: SuggestedQuery[] = [
  {
    id: "default-grn",
    label: "Show pending GRNs awaiting invoice this week",
    module: "Material",
    route: "/material/grn",
    icon: Package,
    accent: "#8b5cf6",
  },
  {
    id: "default-payments",
    label: "Summarize today's payments by mode",
    module: "Finance",
    route: "/payments",
    icon: BarChart3,
    accent: "#3b82f6",
  },
  {
    id: "default-wo",
    label: "List open work orders on active projects",
    module: "Engineering",
    route: "/engineering/work-order",
    icon: Wrench,
    accent: "#ec4899",
  },
  {
    id: "default-bookings",
    label: "How many bookings were confirmed this month?",
    module: "Followup",
    route: "/followup/sales/bookings",
    icon: Users,
    accent: "#6366f1",
  },
  {
    id: "default-approvals",
    label: "What's waiting in my approval inbox right now?",
    module: "Approvals",
    route: "/admin/approval/inbox",
    icon: FileCheck,
    accent: "#f59e0b",
  },
  {
    id: "default-tickets",
    label: "Show urgent tickets still unresolved",
    module: "Tickets",
    route: "/ticket",
    icon: Ticket,
    accent: "#f97316",
  },
];

// ─── Friendly context labels ────────────────────────────────────────────
// Short human-readable label for the page the user is currently on, used
// in the assistant's teaser copy ("...about your live X data"). Falls
// back to the module name, then to nothing (generic home copy).
const PAGE_LABELS: Record<string, string> = {
  "/material/grn": "GRN",
  "/material/purchase-order": "Purchase Order",
  "/material/material-request": "Material Request",
  "/material/issues": "Material Issues",
  "/material/expense-booking": "Expense Booking",
  "/material/stock": "Stock",
  "/material/stock-transfer": "Stock Transfer",
  "/payments": "Payments",
  "/received-payments": "Received Payments",
  "/brs": "Bank Reconciliation",
  "/engineering/work-order": "Work Order",
  "/engineering/boq": "BOQ",
  "/engineering/work-done": "Work Done",
  "/followup/sales/bookings": "Bookings",
  "/followup/sales/applications": "Applications",
  "/followup/sales/pipeline/applicants": "Applicants Pipeline",
  "/followup/agreement/agreements": "Agreements",
  "/followup/finance/demands": "Finance Demands",
  "/followup/finance/payments": "Finance Payments",
  "/followup/closure/handover": "Handover",
  "/admin/approval/inbox": "Approval Inbox",
  "/admin/activity-browser": "Activity Browser",
  "/ticket/pending": "Pending Tickets",
  "/ticket/my-tickets": "My Tickets",
  "/ticket/resolved": "Resolved Tickets",
};

const MODULE_LABELS: Record<NonNullable<Module>, string> = {
  finance: "Finance",
  material: "Material",
  followup: "Followup",
  engineering: "Engineering",
  ticket: "Tickets",
  sales: "Sales",
  records: "Records",
  civilworkdpr: "Civil Work DPR",
  "sales-automation": "Sales Automation",
  admin: "Admin",
  crm: "CRM",
  loan: "Loan",
};

// A route matches a config key if it IS that key, or is nested under it
// ("/material/grn/123" matches "/material/grn", but "/material/stock-transfer"
// does NOT match "/material/stock").
function matchesPath(pathname: string, key: string): boolean {
  return pathname === key || pathname.startsWith(`${key}/`);
}

function findByPath<T>(
  pathname: string,
  map: Record<string, T>,
): T | undefined {
  // Longest key first so a more specific page wins over a shorter
  // ancestor path if both happen to be registered.
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (matchesPath(pathname, key)) return map[key];
  }
  return undefined;
}

export function getSuggestedQueries(
  pathname: string,
  activeModule: Module,
): SuggestedQuery[] {
  const pageMatch = findByPath(pathname, PAGE_QUERIES);
  if (pageMatch) return pageMatch;

  if (activeModule && MODULE_QUERIES[activeModule]) {
    return MODULE_QUERIES[activeModule];
  }

  return DEFAULT_QUERIES;
}

export function getContextLabel(
  pathname: string,
  activeModule: Module,
): string | null {
  const pageLabel = findByPath(pathname, PAGE_LABELS);
  if (pageLabel) return pageLabel;

  if (activeModule && MODULE_LABELS[activeModule]) {
    return MODULE_LABELS[activeModule];
  }

  return null;
}
