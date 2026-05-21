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
export const PAGE_DEFINITIONS: PageDefinition[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    path: "/",
    group: "Main",
    availableActions: ["view", "print", "export"],
  },
  {
    key: "transactions",
    label: "Transactions",
    path: "/transactions",
    group: "Main",
    availableActions: [
      "view",
      "create",
      "edit",
      "delete",
      "print",
      "export",
      "approve",
      "reject",
    ],
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    group: "Main",
    availableActions: ["view", "print", "preview", "export"],
  },
  {
    key: "widgets",
    label: "Widgets",
    path: "/widgets",
    group: "Main",
    availableActions: ["view", "print", "export"],
  },
  {
    key: "tasks",
    label: "Tasks",
    path: "/tasks",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete", "print"],
  },
  {
    key: "payments",
    label: "Payments",
    path: "/payments",
    group: "Main",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_contractors",
    label: "Contractors",
    path: "/masters/contractors",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_suppliers",
    label: "Suppliers",
    path: "/masters/suppliers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_customers",
    label: "Customers",
    path: "/masters/customers",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_banks",
    label: "Banks",
    path: "/masters/banks",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_expenses",
    label: "Expenses",
    path: "/masters/expenses",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_items",
    label: "Items",
    path: "/masters/items",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "master_item_groups",
    label: "Item Groups",
    path: "/masters/item-groups",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "master_hsn",
    label: "HSN",
    path: "/masters/hsn",
    group: "Masters",
    availableActions: ["view", "create", "edit", "delete", "print", "export"],
  },
  {
    key: "admin_menu_rights",
    label: "Menu Rights",
    path: "/admin/rights/menu",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_widgets_rights",
    label: "Widgets Rights",
    path: "/admin/rights/widgets",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_fin_year_rights",
    label: "Fin Year",
    path: "/admin/rights/fin-year",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
  {
    key: "admin_approval_setup",
    label: "Approval Setup",
    path: "/admin/approval/setup",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"],
  },
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

export const DEFAULT_USER_ACCESS: PagePermission[] = [
  { page: "dashboard", actions: ["view"] },
  { page: "reports", actions: ["view"] },
];

// Updated to use centralized PRIVILEGED_ROLES
export const getPermissionsByRole = (role: UserRole): PagePermission[] => {
  if (PRIVILEGED_ROLES.includes(role)) return FULL_ACCESS;
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
  "admin_menu_rights",
  "admin_widgets_rights",
  "admin_fin_year_rights",
  "admin_approval_setup",
  "admin_post_approval_rights",
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
