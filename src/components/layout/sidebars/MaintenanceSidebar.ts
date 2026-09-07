import { Wrench, Users, Receipt } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const maintenanceNavItems: NavItem[] = [
  { label: "Dashboard", icon: Wrench, path: "/maintenance", isDashboard: true },
  { label: "Customer Directory", icon: Users, path: "/maintenance/directory", pageKey: "maintenance-directory" },
  { label: "Bills", icon: Receipt, path: "/maintenance/bills", pageKey: "maintenance-bills" },
];
