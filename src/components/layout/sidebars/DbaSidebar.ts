import {
  Database,
  Terminal,
  HeartPulse,
  ShieldCheck,
  Megaphone,
  Receipt,
  BellRing,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const dbaNavItems: NavItem[] = [
  { label: "DB Console", icon: Database, path: "/dba", isDashboard: true },
  {
    label: "Migrations",
    icon: Terminal,
    children: [
      { label: "Overview", path: "/dba" },
      { label: "Control Panel", path: "/dba/control-panel" },
    ],
  },
  {
    label: "DB Health",
    icon: HeartPulse,
    children: [{ label: "System Metrics", path: "/admin/metrics" }],
  },
  {
    label: "Role Master",
    icon: ShieldCheck,
    children: [
      { label: "Roles", path: "/admin/masters/role-master" },
      { label: "Manage Users", path: "/users" },
    ],
  },
  {
    label: "Ads",
    icon: Megaphone,
    children: [{ label: "Campaigns", path: "/dba/ads" }],
  },
  {
    label: "Logs",
    icon: Receipt,
    children: [{ label: "Payment Logs", path: "/dba/payment-logs" }],
  },
  {
    label: "Reminders",
    icon: BellRing,
    children: [{ label: "Payment Reminders", path: "/dba/reminders" }],
  },
];
