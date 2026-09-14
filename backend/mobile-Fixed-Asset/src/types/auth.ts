// Ported from src/contexts/types.ts (web). Kept in sync by hand for now —
// if this drifts, RBAC checks here can silently diverge from the backend's
// real source of truth (dbo.PageDefinitions / roles.js ROLE_RIGHTS_PAGE_MAP).
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
  | "sales_person";

// Matches the web app's PageKey = string (see src/contexts/types.ts) — the
// real constraint lives in the DB, not the type system.
export type PageKey = string;

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
  pagePermissions: PagePermission[];
  isActive: boolean;
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
    pagePermissions?: PagePermission[];
  };
}
