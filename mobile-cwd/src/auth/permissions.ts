// Ported from src/contexts/auth.utils.ts (web) — same RBAC rules, same
// PRIVILEGED_ROLES/ADMIN_ONLY_PAGES bypass logic, so a permission check
// behaves identically on mobile and web for the same user/role. The web
// file is the source of truth; if ADMIN_ONLY_PAGES grows there, mirror it
// here too.
import type { AppUser, PageAction, PageKey, UserRole } from "@/types/auth";

export const PRIVILEGED_ROLES: UserRole[] = ["super_admin", "admin", "dba"];

export const isPrivilegedRole = (role: UserRole): boolean =>
  PRIVILEGED_ROLES.includes(role);

export const MARKETING_HEAD_SALES_PAGES = new Set<string>([
  "sale-order",
  "sale-invoice",
  "sales-payment",
]);

export const isMarketingHeadPage = (page: string): boolean =>
  page.startsWith("sa-") ||
  page.startsWith("crm-") ||
  MARKETING_HEAD_SALES_PAGES.has(page);

export const ADMIN_ONLY_PAGES: PageKey[] = [
  "menu-rights",
  "widget-rights",
  "fin-year-rights",
  "approval-setup",
  "post-approval-rights",
  "page-definitions",
  "users",
  "role-master",
  "dba-control-panel",
  "dba-ads",
  "dba-reminders",
  "dba-payment-logs",
  "dba-dashboard",
  "dba-profile",
];

export function getInitials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export const createPermissionCheckers = (currentUser: AppUser | null) => {
  const canAccessPage = (page: PageKey): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (currentUser.role === "marketing_head") {
      if (ADMIN_ONLY_PAGES.includes(page)) return false;
      return isMarketingHeadPage(page) || page === "dashboard";
    }
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes("view"),
    );
  };

  const canDoAction = (page: PageKey, action: PageAction): boolean => {
    if (!currentUser) return false;
    if (isPrivilegedRole(currentUser.role)) return true;
    if (currentUser.role === "marketing_head") {
      if (ADMIN_ONLY_PAGES.includes(page)) return false;
      return isMarketingHeadPage(page) || page === "dashboard";
    }
    if (ADMIN_ONLY_PAGES.includes(page)) return false;
    return currentUser.pagePermissions.some(
      (p) => p.page === page && p.actions.includes(action),
    );
  };

  return { canAccessPage, canDoAction };
};
