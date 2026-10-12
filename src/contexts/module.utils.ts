// Non-component exports for ModuleContext, split out so ModuleContext.tsx
// only exports the provider/hook — mixing component and non-component
// exports in one file breaks Vite's Fast Refresh (forces a full page reload
// on every edit instead of hot-patching).

export type Module =
  | "finance"
  | "material"
  | "fixed-asset"
  | "followup"
  | "engineering"
  | "ticket"
  | "sales"
  | "records"
  | "civilworkdpr"
  | "sales-automation"
  | "crm"
  | "loan"
  | "maintenance"
  | "hr-payroll"
  | "admin"
  | null;

// Single source of truth for module dashboard routes
export const MODULE_DASHBOARD_ROUTES: Record<NonNullable<Module>, string> = {
  finance: "/finance",
  material: "/material",
  "fixed-asset": "/fixed-asset",
  followup: "/followup",
  engineering: "/engineering",
  ticket: "/ticket",
  sales: "/sales",
  records: "/records",
  civilworkdpr: "/civilworkdpr",
  "sales-automation": "/sales-automation/social-media",
  crm: "/crm/dashboard",
  loan: "/loan",
  maintenance: "/maintenance",
  "hr-payroll": "/hr-payroll",
  admin: "/admin/dashboard",
};

// ── Admin pages and the page right each one is shown under ──────────────────────────────────────────────────
// Admin pages are open to admin-tier roles (super_admin / admin / dba) always. Any other role gets exactly the Admin
// pages that are ticked for it in Menu Rights - the same key the page is listed under there. Pages with no key
// here (APK Manager, ticket panels, the profile pages, Super Admin / DBA screens) stay admin-tier only.
export const ADMIN_PATH_PAGE_KEYS: Record<string, string> = {
  "/admin": "admin-dashboard",
  "/admin/dashboard": "admin-dashboard",
  "/users": "users",
  "/admin/activity-browser": "activity-browser",
  "/admin/masters/business-unit": "business-unit-master",
  "/admin/masters/company": "company-master",
  "/admin/masters/project": "project-master",
  "/admin/masters/role-master": "role-master",
  "/admin/masters/menu-types": "menu-types",
  "/admin/masters/contractor-categories": "contractor-categories",
  "/admin/masters/godowns": "godowns",
  "/admin/masters/integration-channels": "integration-channels",
  "/admin/page-definitions": "page-definitions",
  "/admin/widget-catalog": "widget-catalog",
  "/admin/approval/inbox": "approval-inbox",
  "/admin/approval/setup": "approval-setup",
  "/admin/approval/post-rights": "post-approval-rights",
  "/admin/security/password-reset": "password-reset",
  "/admin/rights/menu": "menu-rights",
  "/admin/rights/widgets": "widget-rights",
  "/admin/rights/fin-year": "fin-year-rights",
  "/admin/rights/project-access": "project-access",
  "/admin/communicator/sms-setup": "sms-setup",
  "/admin/communicator/email-setup": "email-setup",
  "/admin/communicator/whatsapp-setup": "whatsapp-setup",
  "/admin/api-integration": "api-integration",
  "/admin/metrics": "metrics-dashboard",
  "/admin/signature": "signature",
  "/admin/control-panel": "admin-control-panel",
};

export const ADMIN_PAGE_KEYS: string[] = [...new Set(Object.values(ADMIN_PATH_PAGE_KEYS))];

/** Whether the person has the right for at least one Admin page (so the Admin module is theirs to open). */
export const hasAnyAdminPageRight = (canAccessPage: (pageKey: string) => boolean): boolean =>
  ADMIN_PAGE_KEYS.some((pk) => canAccessPage(pk));

/** Where to send a non-admin-tier person who opens the Admin module: the first page they hold the right for. */
export function firstAccessibleAdminPath(canAccessPage: (pageKey: string) => boolean): string | null {
  const first = Object.entries(ADMIN_PATH_PAGE_KEYS).find(([path, key]) => path !== "/admin" && canAccessPage(key));
  return first ? first[0] : null;
}

// Map each module to a representative page key that signals access. A user
// with ANY view right in a module's page definitions can see/reach that
// module. Shared by ModuleStrip.tsx (which icons render) and
// useGlobalShortcuts.ts's module-switch hotkeys (which Shift+key can jump
// to) — one source of truth so they can never drift apart.
export const MODULE_SAMPLE_PAGES: Record<string, string[]> = {
  finance:     ["finance-dashboard", "new-payment", "received-payment", "brs", "transactions", "expense-booking"],
  material:    ["material-dashboard", "purchase-orders", "grn-master", "material-request", "material-issues", "stock-ledger"],
  "fixed-asset": ["fixed-asset-dashboard", "fixed-asset-record", "fixed-asset-tagging", "asset-transfer", "depreciation-setup", "id-template-master"],
  followup:    ["followup-dashboard", "followup-applications", "followup-bookings", "followup-agreements", "followup-demands"],
  engineering: ["engineering-dashboard", "boq", "engineering-work-order", "work-done", "dpr"],
  ticket:      ["ticket-dashboard", "tickets"],
  sales:       ["sale-order", "sale-invoice", "sales-payment"],
  // Every page of the module, so a user granted only e.g. Quality Check still sees (and can reach) it.
  civilworkdpr: ["civilworkdpr-dashboard", "civilworkdpr-dependency", "civilworkdpr-work-done", "civilworkdpr-activity-reporting", "civilworkdpr-quality-check", "civilworkdpr-work-transfer", "civilworkdpr-worker-attendance", "civilworkdpr-daily-labour", "civilworkdpr-amendment", "civilworkdpr-room-master"],
  "sales-automation": ["sa-social-media", "sa-campaigns", "sa-ads", "sa-leads", "sa-lead-distribution", "sa-inquiry", "sa-site-visits", "sa-marketing-invoices"],
  maintenance: ["maintenance-dashboard"],
  admin:       ADMIN_PAGE_KEYS,
  loan:        ["loan-dashboard", "loan-sanction"],
  "hr-payroll": ["hr-payroll-dashboard"],
  records:     ["records"],
  crm:         ["crm-dashboard", "crm-bookings", "crm-applications", "crm-agreements", "crm-sales-deed"],
};

/** Admin-tier roles see every module regardless of individual page rights. */
export const isAdminTierRole = (role: string): boolean =>
  ["super_admin", "admin", "dba"].includes(role);

export function userHasModuleAccess(
  moduleId: string,
  isAdminTier: boolean,
  canAccessPage: (pageKey: string) => boolean,
): boolean {
  if (isAdminTier) return true;
  const pages = MODULE_SAMPLE_PAGES[moduleId] ?? [];
  return pages.some((pk) => canAccessPage(pk));
}
