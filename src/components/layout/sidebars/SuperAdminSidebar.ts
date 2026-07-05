import { Crown, Building, Global, Shield, Setting, TrendUp, Profile2User, Data } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const superAdminNavItems: NavItem[] = [
  { label: "Control Panel", icon: Crown, path: "/superadmin", isDashboard: true },
  {
    label: "Tenants",
    icon: Building,
    children: [
      { label: "All Tenants", path: "/superadmin" },
      { label: "Admin Control", path: "/admin/control-panel" },
    ],
  },
  {
    label: "User Control",
    icon: Profile2User,
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
    icon: Global,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  {
    label: "Config",
    icon: Setting,
    children: [
      { label: "API Integration", path: "/admin/api-integration" },
      { label: "Role Master", path: "/admin/masters/role-master" },
      { label: "Menu Types", path: "/admin/masters/menu-types" },
      { label: "Signature", path: "/admin/signature" },
    ],
  },
  { label: "Live Metrics", icon: TrendUp, path: "/admin/metrics" },
  { label: "DBA Console", icon: Data, path: "/dba" },
];
