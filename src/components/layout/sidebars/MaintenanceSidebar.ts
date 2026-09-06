import { Wrench } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

// Just the dashboard for now — real Maintenance pages get added here as
// they're built.
export const maintenanceNavItems: NavItem[] = [
  { label: "Dashboard", icon: Wrench, path: "/maintenance", isDashboard: true },
];
