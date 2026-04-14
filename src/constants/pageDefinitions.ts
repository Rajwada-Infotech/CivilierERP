// src/constants/pageDefinitions.ts

export const PAGE_DEFINITIONS = [
  // ==================== CORE ====================
  {
    key: "dashboard",
    label: "Dashboard",
    group: "Core",
    availableActions: ["view"] as const,
  },

  // ==================== ADMINISTRATION ====================
  {
    key: "users",
    label: "Users",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  {
    key: "menu-rights",
    label: "Menu Rights",
    group: "Admin",
    availableActions: ["view", "edit"] as const,
  },
  {
    key: "roles",
    label: "Roles & Permissions",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  {
    key: "company-settings",
    label: "Company Settings",
    group: "Admin",
    availableActions: ["view", "edit"] as const,
  },

  // ==================== HR & EMPLOYEES ====================
  {
    key: "employees",
    label: "Employees",
    group: "HR",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  {
    key: "attendance",
    label: "Attendance",
    group: "HR",
    availableActions: ["view", "create", "edit"] as const,
  },
  {
    key: "payroll",
    label: "Payroll",
    group: "HR",
    availableActions: ["view", "create", "edit", "export"] as const,
  },
  {
    key: "leave-management",
    label: "Leave Management",
    group: "HR",
    availableActions: ["view", "create", "approve", "reject"] as const,
  },

  // ==================== INVENTORY & PRODUCTS ====================
  {
    key: "products",
    label: "Products",
    group: "Inventory",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  {
    key: "inventory",
    label: "Inventory",
    group: "Inventory",
    availableActions: ["view", "create", "edit"] as const,
  },
  {
    key: "suppliers",
    label: "Suppliers",
    group: "Inventory",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },

  // ==================== SALES ====================
  {
    key: "customers",
    label: "Customers",
    group: "Sales",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  {
    key: "sales-orders",
    label: "Sales Orders",
    group: "Sales",
    availableActions: ["view", "create", "edit", "delete", "approve"] as const,
  },
  {
    key: "invoices",
    label: "Invoices",
    group: "Sales",
    availableActions: ["view", "create", "edit", "export", "print"] as const,
  },
  {
    key: "quotations",
    label: "Quotations",
    group: "Sales",
    availableActions: ["view", "create", "edit", "convert"] as const,
  },

  // ==================== PURCHASES ====================
  {
    key: "purchase-orders",
    label: "Purchase Orders",
    group: "Purchases",
    availableActions: ["view", "create", "edit", "delete", "approve"] as const,
  },
  {
    key: "bills",
    label: "Bills & Payments",
    group: "Purchases",
    availableActions: ["view", "create", "edit", "pay"] as const,
  },

  // ==================== FINANCE & ACCOUNTS ====================
  {
    key: "accounts",
    label: "Chart of Accounts",
    group: "Finance",
    availableActions: ["view", "create", "edit"] as const,
  },
  {
    key: "journal-voucher",
    label: "Journal Voucher",
    group: "Finance",
    availableActions: ["view", "create", "edit"] as const,
  },
  {
    key: "banking",
    label: "Banking",
    group: "Finance",
    availableActions: ["view", "create", "edit"] as const,
  },
  {
    key: "financial-reports",
    label: "Financial Reports",
    group: "Finance",
    availableActions: ["view", "export", "print"] as const,
  },

  // ==================== REPORTS ====================
  {
    key: "reports",
    label: "All Reports",
    group: "Reports",
    availableActions: ["view", "export", "print"] as const,
  },

  // ==================== MATERIALS ====================
  {
    key: "grn-master",
    label: "GRN Master",
    group: "Materials",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
  // Role Master
  {
    key: "role-master",
    label: "Role Master",
    group: "Admin",
    availableActions: ["view", "create", "edit", "delete"] as const,
  },
] as const;

// ==================== TYPES ====================
export type PageKey = (typeof PAGE_DEFINITIONS)[number]["key"];

export type PageAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "reject"
  | "export"
  | "print"
  | "pay"
  | "convert";

export type PageDefinition = (typeof PAGE_DEFINITIONS)[number];

export type PagePermission = {
  page: PageKey;
  actions: PageAction[];
};
