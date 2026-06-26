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
  { page: "amendments", actions: ["view", "create", "edit"] },
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

// Updated to use centralized PRIVILEGED_ROLES
export const getPermissionsByRole = (role: UserRole): PagePermission[] => {
  if (PRIVILEGED_ROLES.includes(role)) return FULL_ACCESS;
  if (role === "engineer") return ENGINEER_ACCESS;
  if (role === "customer") return CUSTOMER_ACCESS;
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
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view"),
    );
  };

  const canDoAction = (page: PageKey, action: PageAction): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes(action),
    );
  };

  return { canAccessPage, canDoAction };
};