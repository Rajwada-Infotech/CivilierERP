import { Profile2User, UserSquare } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// New module — Employee Master is the first real page; Attendance/Payroll
// Run land here as they're built.
export const hrPayrollNavItems: NavItem[] = [
  { label: "Dashboard", icon: Profile2User, path: "/hr-payroll", isDashboard: true },
  { label: "Employee Master", icon: UserSquare, path: "/hr-payroll/employees", pageKey: "employee-master" },
];
