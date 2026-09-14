import { Profile2User } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// New module, shell only — Employees/Attendance/Payroll Run pages land here
// as they're built. Dashboard is the only real route for now.
export const hrPayrollNavItems: NavItem[] = [
  { label: "Dashboard", icon: Profile2User, path: "/hr-payroll", isDashboard: true },
];
