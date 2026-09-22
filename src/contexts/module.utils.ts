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
  civilworkdpr: ["civilworkdpr-dashboard"],
  "sales-automation": ["sa-social-media", "sa-campaigns", "sa-ads", "sa-leads", "sa-lead-distribution", "sa-inquiry", "sa-site-visits", "sa-marketing-invoices"],
  maintenance: ["maintenance-dashboard"],
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
