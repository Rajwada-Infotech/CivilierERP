export type UserRole = "super_admin" | "admin" | "user" | "dba" | "engineer" | "customer";

export type PageKey =
  | "dashboard"
  | "transactions"
  | "reports"
  | "widgets"
  | "tasks"
  | "payments"
  | "master_contractors"
  | "master_suppliers"
  | "master_customers"
  | "master_banks"
  | "master_expenses"
  | "master_items"
  | "master_item_groups"
  | "master_hsn"
  | "admin_menu_rights"
  | "admin_widgets_rights"
  | "admin_fin_year_rights"
  | "admin_approval_setup"
  | "admin_post_approval_rights";

export type PageAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "print"
  | "preview"
  | "export"
  | "approve"
  | "reject";

export interface PagePermission {
  page: PageKey;
  actions: PageAction[];
}

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  initials: string;
  avatarUrl?: string | null;
  can_accept_tickets?: boolean;
  pagePermissions: PagePermission[];
  isActive: boolean;
}

export interface PageDefinition {
  key: PageKey;
  label: string;
  path: string;
  group: string;
  availableActions: PageAction[];
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: UserRole;
    can_accept_tickets?: boolean;
    discontinue: boolean;
  };
}
