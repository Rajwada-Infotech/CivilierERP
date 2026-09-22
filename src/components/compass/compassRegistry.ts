import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { NavItem } from "@/components/layout/sidebars/SidebarPrimitives";
import { buildAdminNavItems } from "@/components/layout/sidebars/AdminSidebar";
import { civilWorkDprNavItems } from "@/components/layout/sidebars/CivilWorkDprSidebar";
import { crmNavItems } from "@/components/layout/sidebars/CrmSidebar";
import { dbaNavItems } from "@/components/layout/sidebars/DbaSidebar";
import { engineeringNavItems } from "@/components/layout/sidebars/EngineeringSidebar";
import { buildFinanceNavItems } from "@/components/layout/sidebars/FinanceSidebar";
import { fixedAssetNavItems } from "@/components/layout/sidebars/FixedAssetSidebar";
import { followupNavItems } from "@/components/layout/sidebars/FollowupSidebar";
import { hrPayrollNavItems } from "@/components/layout/sidebars/HrPayrollSidebar";
import { loanNavItems } from "@/components/layout/sidebars/LoanSidebar";
import { maintenanceNavItems } from "@/components/layout/sidebars/MaintenanceSidebar";
import { materialNavItems } from "@/components/layout/sidebars/MaterialSidebar";
import { recordsNavItems } from "@/components/layout/sidebars/RecordsSidebar";
import { salesAutomationNavItems } from "@/components/layout/sidebars/SalesAutomationSidebar";
import { salesNavItems } from "@/components/layout/sidebars/SalesSidebar";
import { superAdminNavItems } from "@/components/layout/sidebars/SuperAdminSidebar";
import { buildTicketNavItems } from "@/components/layout/sidebars/TicketSidebar";
import {
  type SetupItem,
  adminSetupItems,
  civilWorkDprSetupItems,
  crmSetupItems,
  engineeringSetupItems,
  financeSetupItems,
  fixedAssetSetupItems,
  followupSetupItems,
  hrPayrollSetupItems,
  maintenanceSetupItems,
  materialSetupItems,
  salesAutomationSetupItems,
  salesSetupItems,
} from "@/components/layout/setupMenus";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CompassEntry {
  /** Literal React Router path — also the unique id. */
  route: string;
  label: string;
  moduleId: string;
  /** Display name of the module, used for grouping. */
  module: string;
  /** Sidebar section (e.g. "Pipeline") or "Setup" for navbar Setup-menu pages. */
  group?: string;
  pageKey?: string;
  /** Aliases the user may type instead of the label (e.g. "BRS" → reconciliation). */
  keywords: string[];
  /** The module's primary landing entry. */
  isDashboard?: boolean;
  state?: Record<string, unknown>;
}

export interface CompassAccess {
  role: string;
  canAccessPage: (pageKey: string) => boolean;
}

// ─── Aliases ──────────────────────────────────────────────────────────────────
// Keyed by route. There's deliberately no place for these in the sidebars, so
// they live here; registry tests fail if a key stops matching a real route.

export const COMPASS_KEYWORDS: Record<string, string[]> = {
  "/brs": ["bank reconciliation", "reconciliation", "bank rec"],
  "/trial-balance": ["tb"],
  "/balance-sheet": ["bs"],
  "/profit-and-loss": ["pnl", "p&l", "income statement"],
  "/journal-voucher": ["jv"],
  "/payments": ["new payment", "pay"],
  "/received-payments": ["receipt", "rp"],
  "/on-account-adjustment": ["oa", "advance adjustment"],
  "/fund-transfer": ["bank transfer"],
  "/finance/invoice": ["expense booking", "bill", "purchase invoice"],
  "/finance/cheque-cancellation": ["cheque", "check cancel"],
  "/finance/balance-enquiry": ["ledger balance", "party balance"],
  "/finance/year-end-close": ["fy close", "closing"],
  "/material/grn": ["goods receipt", "goods receipt note"],
  "/material/purchase-order": ["po"],
  "/material/material-request": ["mr", "indent"],
  "/material/l1-chart": ["l1", "comparative", "lowest quote"],
  "/material/vehicle-in-out": ["gate entry", "truck", "vehicle entry"],
  "/material/issues": ["material issue", "consumption"],
  "/material/issue-return": ["material return"],
  "/material/stock": ["inventory", "stock ledger"],
  "/material/stock-transfer": ["godown transfer", "ict", "inter company transfer"],
  "/engineering/boq": ["bill of quantities"],
  "/engineering/dpr": ["daily progress report"],
  "/engineering/work-order": ["wo"],
  "/crm/oc-cc": ["occupancy certificate", "completion certificate"],
  "/crm/noc": ["no objection certificate"],
  "/crm/sales-deed": ["registry", "registration"],
  "/crm/customer-360": ["360", "customer profile"],
  "/crm/loan-details": ["home loan", "bank loan"],
  "/hr-payroll/payroll-run": ["salary run", "payslip"],
  "/hr-payroll/attendance-leave-overtime": ["ot", "leave", "overtime"],
  "/masters/customers": ["customer master", "debtor"],
  "/masters/suppliers": ["vendor", "supplier master", "creditor"],
  "/masters/contractors": ["contractor master"],
  "/masters/account-group": ["ac group", "chart of accounts"],
  "/masters/general-ledger": ["ledger", "gl", "coa"],
};

// ─── Sources ──────────────────────────────────────────────────────────────────

interface ModuleSource {
  id: string;
  label: string;
  nav: (ctx: { isAdminTier: boolean }) => NavItem[];
  setup?: SetupItem[];
}

// Order matters: it decides which module "owns" a route that appears in more
// than one sidebar (first wins) and the fallback group order.
const SOURCES: ModuleSource[] = [
  { id: "finance", label: "Finance", nav: () => buildFinanceNavItems(0), setup: financeSetupItems },
  { id: "material", label: "Material", nav: () => materialNavItems, setup: materialSetupItems },
  { id: "engineering", label: "Engineering", nav: () => engineeringNavItems, setup: engineeringSetupItems },
  { id: "crm", label: "CRM", nav: () => crmNavItems, setup: crmSetupItems },
  { id: "sales", label: "Sales", nav: () => salesNavItems, setup: salesSetupItems },
  { id: "sales-automation", label: "Sales Automation", nav: () => salesAutomationNavItems, setup: salesAutomationSetupItems },
  { id: "followup", label: "Follow-Up", nav: () => followupNavItems, setup: followupSetupItems },
  // Ticket's builder adds "Pending Tickets" for admin-tier only.
  { id: "ticket", label: "Ticket", nav: ({ isAdminTier }) => buildTicketNavItems(isAdminTier) },
  { id: "records", label: "Records", nav: () => recordsNavItems },
  { id: "civilworkdpr", label: "Civil Work DPR", nav: () => civilWorkDprNavItems, setup: civilWorkDprSetupItems },
  { id: "loan", label: "Loan", nav: () => loanNavItems },
  { id: "fixed-asset", label: "Fixed Asset", nav: () => fixedAssetNavItems, setup: fixedAssetSetupItems },
  { id: "maintenance", label: "Maintenance", nav: () => maintenanceNavItems, setup: maintenanceSetupItems },
  { id: "hr-payroll", label: "HR and Payroll", nav: () => hrPayrollNavItems, setup: hrPayrollSetupItems },
  { id: "admin", label: "Admin", nav: () => buildAdminNavItems(0), setup: adminSetupItems },
  { id: "dba", label: "DBA", nav: () => dbaNavItems },
  { id: "super_admin", label: "Super Admin", nav: () => superAdminNavItems },
];

const ADMIN_TIER = new Set(["super_admin", "admin", "dba"]);
// Mirrors AppSidebar: marketing_head acts as admin inside these two modules.
const MARKETING_HEAD_MODULES = new Set(["sales", "sales-automation"]);
const ADMIN_INBOX_ROUTE = "/admin/approval/inbox";

// ─── Flatten ──────────────────────────────────────────────────────────────────

/** Parameterized routes can't be navigated to without a record — v1 skips them. */
const isNavigable = (route: string | undefined): route is string =>
  !!route && route.startsWith("/") && !/[:*]/.test(route);

function collect(src: ModuleSource, isAdminTier: boolean): CompassEntry[] {
  const out: CompassEntry[] = [];
  const push = (
    route: string | undefined,
    label: string,
    extra: Partial<CompassEntry> = {},
  ) => {
    if (!isNavigable(route)) return;
    out.push({
      route,
      label,
      moduleId: src.id,
      module: src.label,
      keywords: COMPASS_KEYWORDS[route] ?? [],
      ...extra,
    });
  };

  for (const item of src.nav({ isAdminTier })) {
    push(item.path, item.label, { pageKey: item.pageKey, isDashboard: item.isDashboard });
    for (const c of item.children ?? []) {
      push(c.path, c.label, { group: item.label, pageKey: c.pageKey, state: c.state });
    }
    for (const s of item.sections ?? []) {
      for (const c of s.items) {
        push(c.path, c.label, { group: s.label, pageKey: c.pageKey, state: c.state });
      }
    }
  }
  for (const s of src.setup ?? []) {
    push(s.path, s.label, { group: "Setup", pageKey: s.pageKey });
  }
  return out;
}

/**
 * Builds the flat, deduped, permission-filtered page list. Pure (no React) so
 * it's unit-testable. The rules deliberately mirror AppSidebar/ModuleStrip so
 * Compass never lists a page the sidebar wouldn't show:
 *  - admin-tier sees everything (super_admin-only and DBA sections excepted)
 *  - marketing_head is admin-tier inside Sales and Sales Automation
 *  - everyone else: keyed entries need canAccessPage(pageKey); un-keyed
 *    entries (a few dashboards) show only if the user can open at least one
 *    keyed page in that same module.
 */
export function buildCompassEntries(access: CompassAccess): CompassEntry[] {
  const role = (access.role ?? "").toLowerCase();
  const isAdminTier = ADMIN_TIER.has(role);
  const seen = new Set<string>();
  const result: CompassEntry[] = [];

  for (const src of SOURCES) {
    if (src.id === "super_admin" && role !== "super_admin") continue;
    if (src.id === "dba" && !isAdminTier) continue;

    const raw = collect(src, isAdminTier);
    let allowed: CompassEntry[];

    if (src.id === "admin" && !isAdminTier) {
      // Non-admin roles with approval-inbox rights only ever see the Inbox.
      allowed = access.canAccessPage("approval-inbox")
        ? raw.filter((e) => e.route === ADMIN_INBOX_ROUTE)
        : [];
    } else if (isAdminTier || (role === "marketing_head" && MARKETING_HEAD_MODULES.has(src.id))) {
      allowed = raw;
    } else {
      const moduleReachable = raw.some((e) => e.pageKey && access.canAccessPage(e.pageKey));
      allowed = raw.filter((e) => (e.pageKey ? access.canAccessPage(e.pageKey) : moduleReachable));
    }

    for (const e of allowed) {
      if (seen.has(e.route)) continue;
      seen.add(e.route);
      result.push(e);
    }
  }
  return result;
}

/** One landing page per module, for the empty-state "Jump to a module" list. */
export function moduleLandings(entries: CompassEntry[]): CompassEntry[] {
  const byModule = new Map<string, CompassEntry>();
  for (const e of entries) {
    const cur = byModule.get(e.moduleId);
    if (!cur) byModule.set(e.moduleId, e);
    else if (!cur.isDashboard && e.isDashboard) byModule.set(e.moduleId, e);
  }
  return [...byModule.values()];
}

/**
 * Hook wrapper. Memoized on `currentUser`: canAccessPage is rebuilt on every
 * auth render but only ever depends on currentUser, so keying on it filters
 * once per login/rights change instead of on every keystroke or re-render.
 */
export function useCompassRegistry(): CompassEntry[] {
  const { currentUser, canAccessPage } = useAuth();
  return useMemo(
    () =>
      buildCompassEntries({
        role: currentUser?.role ?? "",
        canAccessPage: (k) => canAccessPage(k as never),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentUser],
  );
}
