import { Profile2User, UserSquare, MoneyRecive } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// New module - Employee Master is the first real page; Attendance lands
// under its own section as it is built.
export const hrPayrollNavItems: NavItem[] = [
  { label: "Dashboard", icon: Profile2User, path: "/hr-payroll", isDashboard: true },

  // Payroll section
  {
    label: "Payroll",
    icon: MoneyRecive,
    children: [
      { label: "Employee Master", path: "/hr-payroll/employees", pageKey: "employee-master" },
      { label: "Salary Structure", path: "/hr-payroll/setup/salary-structure", pageKey: "salary-structure" },
      { label: "Attendance / Leave / Overtime", path: "/hr-payroll/attendance-leave-overtime", pageKey: "attendance-leave-overtime" },
      { label: "Salary Calculation", path: "/hr-payroll/salary-calculation", pageKey: "salary-calculation" },
      { label: "Incentive", path: "/hr-payroll/incentive", pageKey: "incentive" },
      { label: "Payroll Run", path: "/hr-payroll/payroll-run", pageKey: "payroll-run" },
    ],
  },

  // HR section
  {
    label: "HR",
    icon: UserSquare,
    children: [
      { label: "Interview", path: "/hr-payroll/interviews", pageKey: "interview" },
      { label: "Offer Letter & Joining", path: "/hr-payroll/offer-letter-joining", pageKey: "offer-letter-joining" },
    ],
  },
];
