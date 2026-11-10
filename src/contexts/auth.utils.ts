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
// FULL ACCESS: the one place on the page side (the server's is backend/middleware/role.js). Decided 2026-11-10:
// super_admin, admin and dba keep full access in code; every other role gets what Role Rights and Approval Setup give.
// ======================
export const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "admin", "dba"];
/** A role name as one slug: "Super Admin" / "super-admin" -> "super_admin" (and "sa" / "superadmin"). */
const roleSlug = (role: unknown): string => {
  const r = String(role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return r === "sa" || r === "superadmin" ? "super_admin" : r;
};
/** Full access to every page (super_admin, admin, dba). */
export const isPrivilegedRole = (role: unknown): boolean => (PRIVILEGED_ROLES as string[]).includes(roleSlug(role));
/** The super admin: in parallel on every approval, and the few super-admin-only tools. */
export const isSuperAdminRole = (role: unknown): boolean => roleSlug(role) === "super_admin";

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

// Every role other than the full-access ones gets exactly what Role Rights (and the user's own rights) give it,
// from the server (decided 2026-11-10): no role has pages written in code, and a role with no rights sees nothing.
export const getPermissionsByRole = (role: UserRole): PagePermission[] => (isPrivilegedRole(role) ? FULL_ACCESS : []);

export const getInitials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

export const ADMIN_ONLY_PAGES: PageKey[] = [
  "menu-rights", "widget-rights", "fin-year-rights",
  "approval-setup", "post-approval-rights", "project-access", "page-definitions",
  "users", "role-master",
  "dba-control-panel", "dba-ads", "dba-reminders",
  "dba-payment-logs", "dba-dashboard", "dba-profile",
  "dba-gl-posting-failures",
];


// A page made of several steps: open to anyone with a right on any one of them. Each step keeps its own right.
const PAGE_GROUPS: Record<string, PageKey[]> = { "crm-possession": ["crm-pre-possession", "crm-possession-notice", "crm-handover"] };

export const createPermissionCheckers = (currentUser: AppUser | null) => {
  const canAccessPage = (page: PageKey): boolean => {
    if (!currentUser) return false;
    if (PAGE_GROUPS[page]) return PAGE_GROUPS[page].some(canAccessPage);
    if (isPrivilegedRole(currentUser.role)) return true;
    // Still in code (open decision): Marketing Head reaches the Role-wise tab of Menu Rights (MenuRights.tsx limits it).
    if (page === "menu-rights" && currentUser.role === "marketing_head") return true;
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view"),
    );
  };

  const canDoAction = (page: PageKey, action: PageAction): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (page === "menu-rights" && currentUser.role === "marketing_head") return action === "view" || action === "edit";
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes(action),
    );
  };

  return { canAccessPage, canDoAction };
};