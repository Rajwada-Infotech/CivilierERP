export type UserRole =
  | "super_admin"
  | "admin"
  | "user"
  | "dba"
  | "engineer"
  | "customer"
  | "supplier"
  | "marketing_head"
  | "sales_team_lead"
  | "sales_person"
  | "legal_head"
  | "legal_person";

// PageKey used to be a closed union of ~19 hardcoded keys. The real system
// (backend ROLE_RIGHTS_PAGE_MAP in roles.js, DB-driven /api/page-definitions,
// and 40+ sidebar pageKey tags across Engineering/Material/Finance/Followup)
// uses far more keys than this union ever listed, which forced `as any`
// casts everywhere a real page key was used (usePageRights.ts, AppSidebar.tsx,
// MenuRights.tsx) and silently defeated TypeScript's ability to catch typos.
// Widened to `string` so the type system stays honest about there being one
// real source of truth (the DB), not a second hardcoded list pretending to
// constrain it.
export type PageKey = string;

// Legacy keys kept only for reference / for any code still pattern-matching
// against the original hardcoded set (e.g. ADMIN_ONLY_PAGES in auth.utils.ts).
// Not used to constrain PageKey anymore.
export type LegacyPageKey =
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
  | "reject"
  | "post-approval";

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
  showLoginReminders?: boolean;
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