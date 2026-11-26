import { Wrench, Users, Receipt, ShieldCheck, Zap, Ticket, KeyRound, Radar, Megaphone } from "lucide-react";

// Security Gates, Security Guards, Residents and Geofences (the Civilier Security app's set-up) are in the top bar's
// Setup menu (setupMenus.ts maintenanceSetupItems), not repeated here.
import { NavItem } from "./SidebarPrimitives";

export const maintenanceNavItems: NavItem[] = [
  { label: "Dashboard", icon: Wrench, path: "/maintenance", isDashboard: true },
  { label: "Customer Directory", icon: Users, path: "/maintenance/directory", pageKey: "maintenance-directory" },
  { label: "Bills", icon: Receipt, path: "/maintenance/bills", pageKey: "maintenance-bills" },
  { label: "Service Requests", icon: Ticket, path: "/maintenance/service-requests", pageKey: "crm-service-tickets" },
  { label: "Security Attendance", icon: ShieldCheck, path: "/maintenance/security-attendance", pageKey: "maintenance-security-attendance" },
  { label: "Security Live", icon: Radar, path: "/maintenance/security-live", pageKey: "security-live" },
  { label: "Electricity Maintenance", icon: Zap, path: "/maintenance/electricity", pageKey: "maintenance-electricity" },
  { label: "Key Custodian", icon: KeyRound, path: "/maintenance/key-custodian", pageKey: "maintenance-key-custodian" },
];

/** Maintenance → Ads (Civilier Security app's video ads): super admins only, so it isn't in the list above. */
export const maintenanceAdsItem: NavItem = { label: "Ads", icon: Megaphone, path: "/maintenance/ads" };
/** The Maintenance menu for this role: with Ads for super admins. */
export const maintenanceNavFor = (superAdmin: boolean): NavItem[] => (superAdmin ? [...maintenanceNavItems, maintenanceAdsItem] : maintenanceNavItems);
