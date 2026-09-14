import { Profile2User, UserSquare, MoneyRecive } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// New module - Employee Master is the first real page; Payroll Run and
// Attendance land under their respective sections as they are built.
export const hrPayrollNavItems: NavItem[] = [
  { label: "Dashboard", icon: Profile2User, path: "/hr-payroll", isDashboard: true },

  // Payroll section
  {
    label: "Payroll",
    icon: MoneyRecive,
    children: [],
  },

  // HR section
  {
    label: "HR",
    icon: UserSquare,
    children: [
      { label: "Employee Master", path: "/hr-payroll/employees", pageKey: "employee-master" },
    ],
  },
];
