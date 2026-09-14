import { Data, Code, Activity, ShieldTick, Volume, Receipt21, Notification } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const dbaNavItems: NavItem[] = [
  { label: "DB Console", icon: Data, path: "/dba", isDashboard: true },
  {
    label: "Migrations",
    icon: Code,
    children: [
      { label: "Overview", path: "/dba" },
      { label: "Control Panel", path: "/dba/control-panel" },
    ],
  },
  {
    label: "DB Health",
    icon: Activity,
    children: [{ label: "System Metrics", path: "/admin/metrics" }],
  },
  {
    label: "Role Master",
    icon: ShieldTick,
    children: [
      { label: "Roles", path: "/admin/masters/role-master" },
      { label: "Manage Users", path: "/users" },
    ],
  },
  {
    label: "Ads",
    icon: Volume,
    children: [{ label: "Campaigns", path: "/dba/ads" }],
  },
  {
    label: "Logs",
    icon: Receipt21,
    children: [{ label: "Payment Logs", path: "/dba/payment-logs" }],
  },
  {
    label: "Reminders",
    icon: Notification,
    children: [{ label: "Payment Reminders", path: "/dba/reminders" }],
  },
];
