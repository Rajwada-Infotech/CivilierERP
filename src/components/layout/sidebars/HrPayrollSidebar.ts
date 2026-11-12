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
      // Employees and Salary Structures are setup records — they live in the Setup dropdown (hrPayrollSetupItems).
      { label: "My Attendance", path: "/hr-payroll/attendance", pageKey: "employee-attendance" },
      { label: "Attendance Records", path: "/hr-payroll/attendance-leave-overtime", pageKey: "attendance-leave-overtime" },
      { label: "Salary Calculation", path: "/hr-payroll/salary-calculation", pageKey: "salary-calculation" },
      { label: "Incentives", path: "/hr-payroll/incentive", pageKey: "incentive" },
      { label: "Payroll Run", path: "/hr-payroll/payroll-run", pageKey: "payroll-run" },
    ],
  },

  // HR section
  {
    label: "HR",
    icon: UserSquare,
    children: [
      { label: "Interviews", path: "/hr-payroll/interviews", pageKey: "interview" },
      { label: "Offers & Joining", path: "/hr-payroll/offer-letter-joining", pageKey: "offer-letter-joining" },
      { label: "Team Attendance", path: "/hr-payroll/hr-attendance", pageKey: "hr-attendance-management" },
    ],
  },
];
