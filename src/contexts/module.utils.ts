// Non-component exports for ModuleContext, split out so ModuleContext.tsx
// only exports the provider/hook — mixing component and non-component
// exports in one file breaks Vite's Fast Refresh (forces a full page reload
// on every edit instead of hot-patching).

export type Module =
  | "finance"
  | "material"
  | "followup"
  | "engineering"
  | "ticket"
  | "sales"
  | "records"
  | "civilworkdpr"
  | "admin"
  | null;

// Single source of truth for module dashboard routes
export const MODULE_DASHBOARD_ROUTES: Record<NonNullable<Module>, string> = {
  finance: "/finance",
  material: "/material",
  followup: "/followup",
  engineering: "/engineering",
  ticket: "/ticket",
  sales: "/sales",
  records: "/records",
  civilworkdpr: "/civilworkdpr",
  admin: "/admin/dashboard",
};
