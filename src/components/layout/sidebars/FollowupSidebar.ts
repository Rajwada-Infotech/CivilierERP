import {
  LayoutDashboard,
  Users,
  FileText,
  IndianRupee,
  HardHat,
  CheckCircle2,
  MessageSquare,
  BellRing,
  Settings2,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const followupNavItems: NavItem[] = [
  // ── 0. Dashboard ──────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    path: "/followup",
  },

  // ── 1. Sales Pipeline ─────────────────────────────────────────────────────
  //   Applications → Bookings → Unit Selection → Welcome Calls
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

  // ── 2. Agreement ──────────────────────────────────────────────────────────
  //   Agreements → Workflow → Legal Milestones → Document Vault → Communicator
  {
    label: "Agreement",
    icon: FileText,
    children: [
      { label: "Agreements", path: "/followup/agreement/agreements" },
      { label: "Agreement Workflow", path: "/followup/agreement/workflow" },
      { label: "Legal Milestones", path: "/followup/legal/milestones" },
      { label: "Document Vault", path: "/followup/agreement/document-vault" },
      { label: "Communicator", path: "/followup/agreement/communicator" },
    ],
  },

  // ── 3. Finance ────────────────────────────────────────────────────────────
  //   Demands → Payments
  {
    label: "Finance",
    icon: IndianRupee,
    children: [
      { label: "Demands", path: "/followup/finance/demands" },
      { label: "Payments", path: "/followup/finance/payments" },
    ],
  },

  // ── 4. Construction ───────────────────────────────────────────────────────
  {
    label: "Construction",
    icon: HardHat,
    children: [{ label: "Updates", path: "/followup/construction/updates" }],
  },

  // ── 5. Closure ────────────────────────────────────────────────────────────
  //   NOC → Bank NOC → Sales Deed → Pre-Possession → Possession Notice → Handover
  {
    label: "Closure",
    icon: CheckCircle2,
    children: [
      { label: "NOC", path: "/followup/closure/noc" },
      { label: "Bank NOC", path: "/followup/closure/bank-noc" },
      { label: "Sales Deed", path: "/followup/closure/sales-deed" },
      { label: "Pre-Possession", path: "/followup/closure/pre-possession" },
      {
        label: "Possession Notice",
        path: "/followup/closure/possession-notice",
      },
      { label: "Handover", path: "/followup/closure/handover" },
    ],
  },

  // ── 6. CRM ────────────────────────────────────────────────────────────────
  {
    label: "CRM",
    icon: MessageSquare,
    children: [
      { label: "Tasks", path: "/followup/follow-ups/tasks" },
      { label: "Follow-Up Log", path: "/followup/follow-ups/log" },
    ],
  },

  // ── 7. Reminders ─────────────────────────────────────────────────────────
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

  // ── 8. Setup ─────────────────────────────────────────────────────────────
  {
    label: "Setup",
    icon: Settings2,
    children: [
      {
        label: "Payment Plan Master",
        path: "/followup/setup/payment-plan-master",
      },
      { label: "Unit Master", path: "/followup/setup/unit-master" },
      { label: "Block Master", path: "/followup/setup/block-master" },
      { label: "Customer Master", path: "/followup/setup/customer-master" },
      { label: "Pending Tasks", path: "/followup/setup/pending-tasks" },
    ],
  },
];
