import { BarChart3, GitBranch, HardHat, Users2 } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const civilWorkDprNavItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: BarChart3,
    path: "/civilworkdpr",
    pageKey: "civilworkdpr-dashboard",
    isDashboard: true,
  },
  {
    label: "Dependency",
    icon: GitBranch,
    path: "/civilworkdpr/dependency",
    pageKey: "civilworkdpr-dependency",
  },
  {
    label: "Contractor Register",
    icon: HardHat,
    path: "/civilworkdpr/contractor-register",
    pageKey: "civilworkdpr-contractor-register",
  },
  {
    label: "Worker Attendance",
    icon: Users2,
    path: "/civilworkdpr/worker-attendance",
    pageKey: "civilworkdpr-worker-attendance",
  },
];
