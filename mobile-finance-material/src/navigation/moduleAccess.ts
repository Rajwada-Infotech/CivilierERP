// Shared by DashboardScreen (module cards) and NavSheet (module strip) so
// the two "which modules can this user see" computations can't drift apart.
// Mirrors src/pages/Home.tsx's MODULE_PAGES / hasModuleAccess.
import { useMemo } from "react";
import {
  BarChart3, Package, Wrench, Pickaxe, Users, FileCheck, ShoppingCart,
  Megaphone, Ticket, ShieldCheck, Database,
} from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { moduleAccents } from "@/theme/colors";

export const PRIVILEGED_ROLES = ["super_admin", "admin", "dba"];

export const MODULE_PAGES: Record<string, string[]> = {
  finance: ["finance-dashboard", "new-payment", "on-account-adjustment", "received-payment", "brs", "transactions"],
  material: ["material-dashboard", "purchase-orders", "grn-master", "material-request", "material-issues", "material-issue-return", "short-close", "l1-chart", "stock-ledger", "stock-transfers", "debit-note", "fixed-asset-record", "vehicle-in-out"],
  followup: ["followup-dashboard", "followup-applications", "followup-bookings", "followup-agreements", "followup-demands"],
  engineering: ["engineering-dashboard", "boq", "engineering-work-order", "work-done", "dpr"],
  ticket: ["ticket-dashboard", "tickets"],
  sales: ["sale-order", "sale-invoice", "sales-payment"],
  salesAutomation: ["sa-leads", "sa-inquiry", "sa-site-visits", "sa-campaigns", "sa-ads"],
  // All 9 real Civil Work DPR page keys (was missing work-done/
  // activity-reporting/quality-check/room-master/amendment/daily-labour) —
  // a role whose only granted DPR page is e.g. Reporting still needs this
  // list to include it, or hasModuleAccess() never finds a match and hides
  // the Civil DPR dashboard card entirely despite the user having real
  // access underneath. See backend/scripts/stripJrCivilEngDprRights.js /
  // stripSrCivilEngDprRights.js for the page-key convention this mirrors.
  civilworkdpr: [
    "civilworkdpr-dashboard",
    "civilworkdpr-dependency",
    "civilworkdpr-work-done",
    "civilworkdpr-quality-check",
    "civilworkdpr-worker-attendance",
    "civilworkdpr-activity-reporting",
    "civilworkdpr-room-master",
    "civilworkdpr-amendment",
    "civilworkdpr-daily-labour",
  ],
};

export interface ModuleAccess {
  finance: boolean;
  material: boolean;
  engineering: boolean;
  followup: boolean;
  ticket: boolean;
  sales: boolean;
  salesAutomation: boolean;
  civilworkdpr: boolean;
  approvals: boolean;
  admin: boolean;
  dba: boolean;
}

export function useModuleAccess() {
  const { currentUser, canAccessPage } = useAuth();
  const role = currentUser?.role ?? "";
  const privileged = PRIVILEGED_ROLES.includes(role);
  const isDba = role === "dba";

  const hasModuleAccess = (moduleId: string): boolean => {
    if (privileged) return true;
    return (MODULE_PAGES[moduleId] ?? []).some((pk) => canAccessPage(pk));
  };

  const access: ModuleAccess = useMemo(
    () => ({
      finance: hasModuleAccess("finance"),
      material: hasModuleAccess("material"),
      engineering: hasModuleAccess("engineering"),
      followup: hasModuleAccess("followup"),
      ticket: hasModuleAccess("ticket"),
      sales: hasModuleAccess("sales"),
      salesAutomation: hasModuleAccess("salesAutomation"),
      civilworkdpr: hasModuleAccess("civilworkdpr"),
      approvals: privileged,
      admin: privileged && !isDba,
      dba: isDba,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, privileged, isDba],
  );

  return { role, privileged, isAdmin: privileged, isDba, access };
}

export const MODULE_LIST: Array<{
  id: keyof ModuleAccess;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  accent: string;
}> = [
  { id: "finance", label: "Finance", icon: BarChart3, accent: moduleAccents.finance },
  { id: "material", label: "Material", icon: Package, accent: moduleAccents.material },
  { id: "engineering", label: "Engineering", icon: Wrench, accent: moduleAccents.engineering },
  { id: "civilworkdpr", label: "Civil DPR", icon: Pickaxe, accent: moduleAccents.civilworkdpr },
  { id: "followup", label: "Follow-Up", icon: Users, accent: moduleAccents.followup },
  { id: "approvals", label: "Approvals", icon: FileCheck, accent: moduleAccents.approvals },
  { id: "sales", label: "Sales", icon: ShoppingCart, accent: moduleAccents.sales },
  { id: "salesAutomation", label: "Sales Auto", icon: Megaphone, accent: moduleAccents.salesAutomation },
  { id: "ticket", label: "Tickets", icon: Ticket, accent: moduleAccents.ticket },
  { id: "admin", label: "Admin", icon: ShieldCheck, accent: moduleAccents.admin },
  { id: "dba", label: "DBA Console", icon: Database, accent: moduleAccents.dba },
];
