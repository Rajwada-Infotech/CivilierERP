import {
  BarChart3,
  ListTodo,
  BellRing,
  Users,
  FileText,
  CheckCircle2,
  HardHat,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/followup" },
  {
    label: "Tasks",
    icon: ListTodo,
    children: [
      { label: "Tasks", path: "/followup/follow-ups/tasks" },
      { label: "Follow-Up Log", path: "/followup/follow-ups/log" },
    ],
  },
  {
    label: "Reminders",
    icon: BellRing,
    children: [
      {
        label: "PO Reminders",
        path: "/followup/follow-ups/po-reminders",
      },
      {
        label: "WO Reminders",
        path: "/followup/follow-ups/wo-reminders",
      },
      {
        label: "CHQ Reminders",
        path: "/followup/follow-ups/chq-reminders",
      },
      {
        label: "TDS Reminders",
        path: "/followup/follow-ups/tds-reminders",
      },
      {
        label: "GRN Reminders",
        path: "/followup/follow-ups/grn-reminders",
      },
    ],
  },
  {
    label: "Sales",
    icon: Users,
    children: [
      { label: "Applicants", path: "/followup/sales/applicants" },
      { label: "Bookings", path: "/followup/sales/bookings" },
      { label: "Unit Selection", path: "/followup/sales/unit-selection" },
      { label: "Welcome Calls", path: "/followup/sales/welcome-calls" },
    ],
  },
  {
    label: "Agreement",
    icon: FileText,
    children: [{ label: "Agreements", path: "/followup/agreement/agreements" }],
  },
  {
    label: "Closure",
    icon: CheckCircle2,
    children: [
      { label: "NOC", path: "/followup/closure/noc" },
      { label: "Sales Deed", path: "/followup/closure/sales-deed" },
      { label: "Handover", path: "/followup/closure/handover" },
    ],
  },
  {
    label: "Construction",
    icon: HardHat,
    children: [{ label: "Updates", path: "/followup/construction/updates" }],
  },
];
