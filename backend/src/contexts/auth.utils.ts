export type { PageKey, PageAction, PagePermission } from "./types";

import type {
  UserRole,
  PageKey,
  PageAction,
  PagePermission,
  AppUser,
  PageDefinition,
} from "./types";

// ======================
// CENTRALIZED PRIVILEGED ROLES (Fix 3)
// ======================
export const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "admin", "dba"];

// Pages the marketing_head role controls as an admin (full CRUD, no restrictions).
// Backend mirrors this in requirePageRight.js → isMarketingHeadAllowed(), which
// matches by "sa-"/"crm-" PREFIX rather than an explicit list — this Set used
// to be a hand-maintained explicit list too and silently drifted out of sync
// every time a new crm-* page was added (e.g. crm-communication, crm-noc,
// crm-unit-matrix were all missing, blocking marketing_head from pages the
// backend already allowed). isMarketingHeadPage() below now mirrors the
// backend's prefix logic so no page can ever be missed here again; this Set
// only needs to keep the non-prefixed Sales-module page keys.
export const MARKETING_HEAD_SALES_PAGES = new Set<string>([
  "sale-order", "sale-invoice", "sales-payment",
]);

export const isMarketingHeadPage = (page: string): boolean =>
  page.startsWith("sa-") || page.startsWith("crm-") || MARKETING_HEAD_SALES_PAGES.has(page);

// ======================
// PAGE DEFINITIONS
// ======================
// PAGE_DEFINITIONS: used only to derive FULL_ACCESS for privileged roles.
// Keys must match dbo.PageDefinitions (DB-style kebab-case).
// This list intentionally covers only the core pages; the DB is the real source of truth.
export const PAGE_DEFINITIONS: PageDefinition[] = [
  { key: "dashboard",            label: "Dashboard",         path: "/",                       group: "Main",    availableActions: ["view","print","export"] },
  { key: "transactions",         label: "Transactions",      path: "/transactions",            group: "Finance", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "reports",              label: "Reports",           path: "/reports",                 group: "Main",    availableActions: ["view","print","preview","export"] },
  { key: "widgets",              label: "Widgets",           path: "/widgets",                 group: "Main",    availableActions: ["view","print","export"] },
  { key: "tasks",                label: "Tasks",             path: "/tasks",                   group: "Main",    availableActions: ["view","create","edit","delete","print"] },
  { key: "records",              label: "Records",           path: "/records",                 group: "Main",    availableActions: ["view","print","export"] },
  { key: "contractor-master",    label: "Contractors",       path: "/masters/contractors",     group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "supplier-master",      label: "Suppliers",         path: "/masters/suppliers",       group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "customer-master",      label: "Customers",         path: "/masters/customers",       group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "bank-master",          label: "Banks",             path: "/masters/banks",           group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "expenses-master",      label: "Expenses",          path: "/masters/expenses",        group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "item-master",          label: "Items",             path: "/masters/items",           group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "item-group",           label: "Item Groups",       path: "/masters/item-groups",     group: "Masters", availableActions: ["view","create","edit","delete"] },
  { key: "hsn-master",           label: "HSN",               path: "/masters/hsn",             group: "Masters", availableActions: ["view","create","edit","delete","print","export"] },
  { key: "menu-rights",          label: "Menu Rights",       path: "/admin/rights/menu",       group: "Admin",   availableActions: ["view","create","edit","delete"] },
  { key: "widget-rights",        label: "Widget Rights",     path: "/admin/rights/widgets",    group: "Admin",   availableActions: ["view","create","edit","delete"] },
  { key: "fin-year-rights",      label: "Fin Year Rights",   path: "/admin/rights/fin-year",   group: "Admin",   availableActions: ["view","create","edit","delete"] },
  { key: "approval-setup",       label: "Approval Setup",    path: "/admin/approval/setup",    group: "Admin",   availableActions: ["view","create","edit","delete"] },
  {
    key: "admin_post_approval_rights",
    label: "Post Approval",
    path: "/admin/approval/post-rights",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete", "approve", "reject"],
  },
];

export const FULL_ACCESS: PagePermission[] = PAGE_DEFINITIONS.map((p) => ({
  page: p.key as PageKey,
  actions: [...p.availableActions] as PageAction[],
}));

export const ENGINEER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view", "print", "export"] },
  { page: "widgets", actions: ["view"] },
  { page: "tasks", actions: ["view", "create", "edit"] },
  { page: "transactions", actions: ["view", "create"] },
  { page: "payments", actions: ["view"] },
  // Masters — DB-style keys
  { page: "contractor-master", actions: ["view"] },
  { page: "supplier-master", actions: ["view"] },
  { page: "item-master", actions: ["view"] },
  { page: "item-group", actions: ["view"] },
  // Engineering
  { page: "engineering-dashboard", actions: ["view"] },
  { page: "engineering-work-order", actions: ["view", "create", "edit"] },
  { page: "boq", actions: ["view"] },
  { page: "dpr", actions: ["view", "create"] },
  { page: "work-done", actions: ["view", "create"] },
  { page: "tickets", actions: ["view", "create", "edit"] },
  { page: "ticket-dashboard", actions: ["view"] },
];

export const DEFAULT_USER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view"] },
];

// Customer portal: can only access the ticket system
export const CUSTOMER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
];

// Supplier portal: can only submit quotation prices and manage their rate catalog
export const SUPPLIER_ACCESS: PagePermission[] = [
  { page: "supplier-quotations", actions: ["view", "create", "edit"] },
  { page: "supplier-catalog", actions: ["view", "create", "edit"] },
];

// Sales Team Lead: view+edit leads/visits/inquiry, view-only marketing, view+create distribution/transfers
export const SALES_TEAM_LEAD_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "sa-leads", actions: ["view", "edit"] },
  { page: "sa-inquiry", actions: ["view", "create", "edit"] },
  { page: "sa-site-visits", actions: ["view", "create", "edit"] },
  { page: "sa-campaigns", actions: ["view"] },
  { page: "sa-ads", actions: ["view"] },
  { page: "sa-marketing-invoices", actions: ["view"] },
  { page: "sa-social-media", actions: ["view"] },
  { page: "sa-teams", actions: ["view"] },
  { page: "sa-lead-distribution", actions: ["view", "create"] },
  { page: "sa-lead-transfers", actions: ["view", "create"] },
  { page: "sa-distribution-rules", actions: ["view"] },
];

// Sales Person: view+edit own leads, log calls, schedule site visits
export const SALES_PERSON_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "sa-leads", actions: ["view", "edit"] },
  { page: "sa-inquiry", actions: ["view", "create", "edit"] },
  { page: "sa-site-visits", actions: ["view", "create", "edit"] },
];

// Legal Head: oversees the full legal pipeline on an Agreement — drafting,
// senior approval (see approvalService.js CRM_APPROVER_ROLES override for
// crm-agreements), NOC, and Sale Deed. Scoped strictly to CRM's legal-facing
// pages, not the whole CRM module (unlike marketing_head's full CRM prefix).
export const LEGAL_HEAD_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "crm-dashboard", actions: ["view"] },
  { page: "crm-bookings", actions: ["view"] },
  { page: "crm-agreements", actions: ["view", "create", "edit"] },
  { page: "crm-documents", actions: ["view", "create", "edit", "delete"] },
  { page: "crm-legal-milestones", actions: ["view", "create", "edit"] },
  { page: "crm-noc", actions: ["view", "create", "edit"] },
  { page: "crm-sales-deed", actions: ["view", "create", "edit"] },
];

// Legal Person: the drafter/preparer — "arranges/prepares the papers work"
// per the workflow spec. Can create and edit agreements/documents but has no
// approve rights (approvalService.js's role check on crm-agreements only
// allows legal_head, not legal_person) and no NOC/Sale Deed access (that's
// the head's closure-stage oversight).
export const LEGAL_PERSON_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "crm-dashboard", actions: ["view"] },
  { page: "crm-bookings", actions: ["view"] },
  { page: "crm-agreements", actions: ["view", "create", "edit"] },
  { page: "crm-documents", actions: ["view", "create", "edit"] },
  { page: "crm-legal-milestones", actions: ["view", "create", "edit"] },
];

// marketing_head: full CRUD on all SA + Sales pages, plus dashboard access.
// This populates currentUser.pagePermissions for any code that reads that
// array directly instead of going through canAccessPage/canDoAction (which
// gate marketing_head via isMarketingHeadPage()'s prefix match and don't
// depend on this list being exhaustive). Kept as an explicit enumeration
// only because pagePermissions needs concrete {page, actions} entries, not
// a predicate — every sa-/crm- page key actually routed in App.tsx should
// appear here.
const MARKETING_HEAD_KNOWN_PAGES = [
  // Sales Automation
  "sa-leads", "sa-inquiry", "sa-campaigns", "sa-ads", "sa-marketing-invoices",
  "sa-site-visits", "sa-social-media", "sa-teams", "sa-lead-distribution",
  "sa-distribution-rules", "sa-lead-transfers", "sa-role-master",
  "sa-channel-partners", "sa-lead-activities", "sa-lead-tasks", "sa-commissions",
  // CRM module
  "crm-dashboard", "crm-applications", "crm-bookings", "crm-welcome-calls",
  "crm-communication", "crm-customer-bank-details", "crm-agreements", "crm-documents",
  "crm-unit-matrix", "crm-parking-matrix",
  "crm-legal-milestones", "crm-noc", "crm-sales-deed",
  "crm-pre-possession", "crm-possession-notice", "crm-construction-updates",
  "crm-payments", "crm-payment-plans", "crm-brokerage", "crm-parking-booking",
  "crm-handover", "crm-service-tickets", "crm-cancellations", "crm-customer-360", "crm-loan-details",
  // Sales module
  "sale-order", "sale-invoice", "sales-payment",
] as const;

export const MARKETING_HEAD_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  ...MARKETING_HEAD_KNOWN_PAGES.map((page) => ({
    page,
    actions: ["view", "create", "edit", "delete", "print", "export"] as PageAction[],
  })),
];

// Updated to use centralized PRIVILEGED_ROLES
export const getPermissionsByRole = (role: UserRole): PagePermission[] => {
  if (PRIVILEGED_ROLES.includes(role)) return FULL_ACCESS;
  if (role === "engineer") return ENGINEER_ACCESS;
  if (role === "customer") return CUSTOMER_ACCESS;
  if (role === "supplier") return SUPPLIER_ACCESS;
  if (role === "marketing_head") return MARKETING_HEAD_ACCESS;
  if (role === "sales_team_lead") return SALES_TEAM_LEAD_ACCESS;
  if (role === "sales_person") return SALES_PERSON_ACCESS;
  if (role === "legal_head") return LEGAL_HEAD_ACCESS;
  if (role === "legal_person") return LEGAL_PERSON_ACCESS;
  return DEFAULT_USER_ACCESS;
};

export const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const ADMIN_ONLY_PAGES: PageKey[] = [
  "menu-rights", "widget-rights", "fin-year-rights",
  "approval-setup", "post-approval-rights", "page-definitions",
  "users", "role-master",
  "dba-control-panel", "dba-ads", "dba-reminders",
  "dba-payment-logs", "dba-dashboard", "dba-profile",
];

// Updated to use centralized PRIVILEGED_ROLES
export const isPrivilegedRole = (role: UserRole): boolean =>
  PRIVILEGED_ROLES.includes(role);

export const createPermissionCheckers = (currentUser: AppUser | null) => {
  const canAccessPage = (page: PageKey): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    // marketing_head: full access within their scope, no access outside it
    if (currentUser.role === "marketing_head") {
      if (ADMIN_ONLY_PAGES.includes(page)) return false;
      return isMarketingHeadPage(page) || page === "dashboard" || page === "reports" || page === "widgets";
    }
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view"),
    );
  };

  const canDoAction = (page: PageKey, action: PageAction): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    // marketing_head: all actions on their scoped pages
    if (currentUser.role === "marketing_head") {
      if (ADMIN_ONLY_PAGES.includes(page)) return false;
      return isMarketingHeadPage(page) || page === "dashboard" || page === "reports" || page === "widgets";
    }
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes(action),
    );
  };

  return { canAccessPage, canDoAction };
};