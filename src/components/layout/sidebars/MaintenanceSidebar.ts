import { Wrench, Users, Receipt, ShieldCheck, Zap, Ticket } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const maintenanceNavItems: NavItem[] = [
  { label: "Dashboard", icon: Wrench, path: "/maintenance", isDashboard: true },
  { label: "Customer Directory", icon: Users, path: "/maintenance/directory", pageKey: "maintenance-directory" },
  { label: "Bills", icon: Receipt, path: "/maintenance/bills", pageKey: "maintenance-bills" },
  { label: "Service Requests", icon: Ticket, path: "/maintenance/service-requests", pageKey: "crm-service-tickets" },
  { label: "Security Attendance", icon: ShieldCheck, path: "/maintenance/security-attendance", pageKey: "maintenance-security-attendance" },
  { label: "Electricity Maintenance", icon: Zap, path: "/maintenance/electricity", pageKey: "maintenance-electricity" },
];
