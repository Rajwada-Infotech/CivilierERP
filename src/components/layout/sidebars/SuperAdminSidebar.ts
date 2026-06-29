import {
  Crown,
  Building2,
  ShieldCheck,
  Globe,
  Shield,
  Settings,
  TrendingUp,
  FileText,
  Users,
  Database,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const superAdminNavItems: NavItem[] = [
  { label: "Control Panel", icon: Crown, path: "/superadmin", isDashboard: true },
  {
    label: "Tenant Management",
    icon: Building2,
    children: [
      { label: "All Tenants", path: "/superadmin" },
      { label: "Admin Control", path: "/admin/control-panel" },
    ],
  },
  {
    label: "User Control",
    icon: Users,
    children: [
      { label: "Manage Users", path: "/users" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
      { label: "Password Reset", path: "/admin/security/password-reset" },
    ],
  },
  {
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu Rights", path: "/admin/rights/menu" },
      { label: "Widgets Rights", path: "/admin/rights/widgets" },
      { label: "Financial Year", path: "/admin/rights/fin-year" },
      { label: "Approval Setup", path: "/admin/approval/setup" },
    ],
  },
  {
    label: "Enterprise",
    icon: Globe,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  {
    label: "System Config",
    icon: Settings,
    children: [
      { label: "API Integration", path: "/admin/api-integration" },
      { label: "Role Master", path: "/admin/masters/role-master" },
      { label: "Menu Types", path: "/admin/masters/menu-types" },
      { label: "Signature", path: "/admin/signature" },
    ],
  },
  { label: "Live Metrics", icon: TrendingUp, path: "/admin/metrics" },
  { label: "DBA Console", icon: Database, path: "/dba" },
];
