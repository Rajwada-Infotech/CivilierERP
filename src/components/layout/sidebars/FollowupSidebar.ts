import {
  BarChart3,
  Users,
  FileText,
  IndianRupee,
  HardHat,
  CheckCircle2,
  ListTodo,
  BellRing,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  { label: "Dashboard", icon: BarChart3, path: "/followup" },

  // ── Stage 1-3: Sales pipeline ─────────────────────────────────────────────
  {
    label: "Sales",
    icon: Users,
    children: [
      { label: "Applications", path: "/followup/sales/applications" },
      { label: "Bookings", path: "/followup/sales/bookings" },
      { label: "Unit Selection", path: "/followup/sales/unit-selection" },
      { label: "Welcome Calls", path: "/followup/sales/welcome-calls" },
    ],
  },

  // ── Stage 4: Agreement ────────────────────────────────────────────────────
  {
    label: "Agreement",
    icon: FileText,
    children: [{ label: "Agreements", path: "/followup/agreement/agreements" }],
  },

  // ── Track C: Finance / Payments ───────────────────────────────────────────
  {
    label: "Finance",
    icon: IndianRupee,
    children: [
      { label: "Demands", path: "/followup/finance/demands" },
      { label: "Payments", path: "/followup/finance/payments" },
    ],
  },

  // ── Construction progress ─────────────────────────────────────────────────
  {
    label: "Construction",
    icon: HardHat,
    children: [{ label: "Updates", path: "/followup/construction/updates" }],
  },

  // ── Stage 5-6: Closure ────────────────────────────────────────────────────
  {
    label: "Closure",
    icon: CheckCircle2,
    children: [
      { label: "NOC", path: "/followup/closure/noc" },
      { label: "Bank NOC", path: "/followup/closure/bank-noc" },
      { label: "Sales Deed", path: "/followup/closure/sales-deed" },
      { label: "Handover", path: "/followup/closure/handover" },
    ],
  },

  // ── Admin / CRM ───────────────────────────────────────────────────────────
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
      { label: "PO Reminders", path: "/followup/follow-ups/po-reminders" },
      { label: "WO Reminders", path: "/followup/follow-ups/wo-reminders" },
      { label: "CHQ Reminders", path: "/followup/follow-ups/chq-reminders" },
      { label: "TDS Reminders", path: "/followup/follow-ups/tds-reminders" },
      { label: "GRN Reminders", path: "/followup/follow-ups/grn-reminders" },
    ],
  },
];
