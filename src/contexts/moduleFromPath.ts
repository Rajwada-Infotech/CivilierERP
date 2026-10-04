import type { Module } from "@/contexts/module.utils";

/** What the URL alone says about the active module.
 *  - a Module id: the path belongs to that module
 *  - "none": neutral landing page (/, /home) — clear the module
 *  - "keep": ambiguous path (/masters/*, /reports, …) — keep whatever is remembered */
export type PathModule = NonNullable<Module> | "none" | "keep";

// Order matters: "/sales-automation" must be tested before "/sales".
const PREFIX_MODULES: [string, NonNullable<Module>][] = [
  ["/admin", "admin"],
  ["/users", "admin"],
  ["/followup", "followup"],
  ["/material", "material"],
  ["/fixed-asset", "fixed-asset"],
  ["/engineering", "engineering"],
  ["/ticket", "ticket"],
  ["/sales-automation", "sales-automation"],
  ["/crm", "crm"],
  ["/sales", "sales"],
  ["/records", "records"],
  ["/civilworkdpr", "civilworkdpr"],
  ["/loan", "loan"],
  ["/maintenance", "maintenance"],
  ["/hr-payroll", "hr-payroll"],
  ["/finance", "finance"],
  ["/brs", "finance"],
  ["/payments", "finance"],
  ["/received-payments", "finance"],
  ["/journal-voucher", "finance"],
  ["/trial-balance", "finance"],
  // Finance pages that don't live under /finance — without these, opening one by
  // link/bookmark/Compass left the sidebar on whatever module was remembered.
  ["/on-account-adjustment", "finance"],
  ["/fund-transfer", "finance"],
  ["/balance-sheet", "finance"],
  ["/profit-and-loss", "finance"],
];

export function moduleFromPath(pathname: string): PathModule {
  for (const [prefix, mod] of PREFIX_MODULES) {
    if (pathname.startsWith(prefix)) return mod;
  }
  if (pathname === "/home" || pathname === "/") return "none";
  return "keep";
}

const MODULE_IDS = new Set<string>([
  "finance", "material", "fixed-asset", "followup", "engineering", "ticket", "sales",
  "records", "civilworkdpr", "sales-automation", "crm", "loan", "maintenance", "hr-payroll", "admin",
]);

/** Ids that ModuleContext accepts as an active module (Compass also has dba/super_admin). */
export const isModuleId = (id: string): id is NonNullable<Module> => MODULE_IDS.has(id);

/**
 * Before navigating to a route whose URL doesn't name its module (/masters/*),
 * remember which module it belongs to. ModuleContext reads this on the next
 * navigation ("ambiguous path — trust localStorage"), so the right sidebar
 * shows even when the link was followed from a different module.
 */
export function rememberModuleForRoute(route: string, moduleId: string) {
  if (moduleFromPath(route) !== "keep" || !isModuleId(moduleId)) return;
  try {
    sessionStorage.setItem("activeModule", moduleId);
  } catch {
    /* storage blocked — the sidebar just keeps the previous module */
  }
}
