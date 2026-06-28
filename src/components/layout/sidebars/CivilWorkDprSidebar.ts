import { BarChart3, GitBranch, HardHat } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const civilWorkDprNavItems: NavItem[] = [
  {
    label: "Dashboard",
    icon: BarChart3,
    path: "/civilworkdpr",
    pageKey: "civilworkdpr-dashboard",
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
];
