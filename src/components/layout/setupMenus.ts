// Per-module "Setup" menu entries (masters/config pages reachable from the
// navbar Setup dropdown). Lives in its own module — not inside TopNavbar —
// so other consumers (e.g. the Compass page finder) can read the exact same
// list without importing the navbar component itself.
import type React from "react";
import {
  Activity,
  BookOpen,
  Calendar,
  CalendarClock,
  Car,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  DoorOpen,
  FileText,
  FileType2,
  Gauge,
  GitBranch,
  Handshake,
  HardHat,
  Hash,
  Landmark,
  Layers,
  LayoutGrid,
  Megaphone,
  Package,
  Percent,
  PlusCircle,
  Receipt,
  ReceiptIndianRupee,
  RotateCcw,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Target,
  TrendingUp,
  Truck,
  UserSquare,
  Users,
  UsersRound,
  Wallet,
  Wand2,
  XCircle,
  Zap,
} from "lucide-react";
import { BillingIcon } from "@/components/icons/BillingIcon";

// ─── Setup Items ──────────────────────────────────────────────────────────────
export type SetupItem = {
  icon: React.ElementType<any>;
  label: string;
  path: string;
  color: string;
  pageKey?: string;
};

export const financeSetupItems: SetupItem[] = [
  {
    icon: Layers,
    label: "AC Group",
    path: "/masters/account-group",
    color: "text-indigo-400",
    pageKey: "account-head",
  },
  {
    icon: Receipt,
    label: "General Ledger",
    path: "/masters/general-ledger",
    color: "text-orange-400",
    pageKey: "general-ledger",
  },
  {
    icon: Truck,
    label: "Vendors",
    path: "/masters/suppliers",
    color: "text-blue-400",
    pageKey: "supplier-master",
  },
  {
    icon: HardHat,
    label: "Contractors",
    path: "/masters/contractors",
    color: "text-amber-500",
    pageKey: "contractor-master",
  },
  {
    icon: Landmark,
    label: "Banks",
    path: "/masters/banks",
    color: "text-emerald-500",
    pageKey: "bank-master",
  },
  {
    icon: Handshake,
    label: "Partners",
    path: "/masters/partners",
    color: "text-orange-500",
    pageKey: "partner-master",
  },
  {
    icon: Calendar,
    label: "Fin Year",
    path: "/masters/financial-year",
    color: "text-purple-400",
    pageKey: "financial-year-master",
  },
  {
    icon: BookOpen,
    label: "Cheque",
    path: "/masters/cheque",
    color: "text-cyan-500",
    pageKey: "cheque-master",
  },
  {
    icon: CreditCard,
    label: "Card",
    path: "/masters/card",
    color: "text-rose-500",
    pageKey: "card-master",
  },
  {
    icon: FileText,
    label: "TDS",
    path: "/masters/tds",
    color: "text-green-500",
    pageKey: "tds-master",
  },
  {
    icon: Target,
    label: "Cost Center",
    path: "/masters/cost-center",
    color: "text-pink-500",
    pageKey: "cost-center",
  },
  {
    icon: TrendingUp,
    label: "Profit Center",
    path: "/masters/profit-center",
    color: "text-teal-500",
    pageKey: "profit-center",
  },
  {
    icon: RotateCcw,
    label: "Return Reason",
    path: "/masters/return-reason",
    color: "text-red-400",
    pageKey: "return-reason-master",
  },
  {
    icon: Wallet,
    label: "Payment Reason",
    path: "/masters/payment-reason",
    color: "text-lime-500",
    pageKey: "payment-reason-master",
  },
];

// Customer Master lives here, not under Finance — a customer is who a Sale
// Order/Invoice is raised against, so it belongs with the pages that
// actually use it.
export const salesSetupItems: SetupItem[] = [
  {
    icon: Users,
    label: "Customer Master",
    path: "/masters/customers",
    color: "text-violet-500",
    pageKey: "customer-master",
  },
];

export const maintenanceSetupItems: SetupItem[] = [
  {
    icon: Receipt,
    label: "Charge Head",
    path: "/masters/charge-head",
    color: "text-slate-500",
    pageKey: "charge-head-master",
  },
  {
    icon: Gauge,
    label: "Meter Reading Master",
    path: "/masters/meter-reading",
    color: "text-lime-600",
    pageKey: "meter-reading-master",
  },
  {
    icon: Zap,
    label: "Electricity Provider Master",
    path: "/masters/electricity-provider",
    color: "text-amber-500",
    pageKey: "electricity-provider-master",
  },
  {
    icon: ReceiptIndianRupee,
    label: "Electricity Tariff Master",
    path: "/masters/electricity-tariff",
    color: "text-emerald-500",
    pageKey: "electricity-tariff-master",
  },
];

export const hrPayrollSetupItems: SetupItem[] = [
  {
    icon: UserSquare,
    label: "Designation Master",
    path: "/hr-payroll/setup/designation-master",
    color: "text-yellow-500",
    pageKey: "designation-master",
  },
  {
    icon: UserSquare,
    label: "Candidate Master",
    path: "/hr-payroll/setup/candidate-master",
    color: "text-yellow-500",
    pageKey: "candidate-master",
  },
  {
    icon: UserSquare,
    label: "Shift Master",
    path: "/hr-payroll/setup/shift-master",
    color: "text-yellow-500",
    pageKey: "shift-master",
  },
  {
    icon: UserSquare,
    label: "Grace Time Master",
    path: "/hr-payroll/setup/grace-time-master",
    color: "text-yellow-500",
    pageKey: "grace-time-master",
  },
  {
    icon: UserSquare,
    label: "Holiday Master",
    path: "/hr-payroll/setup/holiday-master",
    color: "text-yellow-500",
    pageKey: "holiday-master",
  },
  {
    icon: UserSquare,
    label: "Deduction and Addition Master",
    path: "/hr-payroll/setup/deduction-addition-master",
    color: "text-yellow-500",
    pageKey: "deduction-addition-master",
  },
  {
    icon: UserSquare,
    label: "Salary Structure",
    path: "/hr-payroll/setup/salary-structure",
    color: "text-yellow-500",
    pageKey: "salary-structure",
  },
];

export const materialSetupItems: SetupItem[] = [
  {
    icon: Package,
    label: "Items",
    path: "/masters/items",
    color: "text-teal-500",
    pageKey: "item-master",
  },
  {
    icon: Layers,
    label: "Items Group",
    path: "/masters/item-groups",
    color: "text-indigo-400",
    pageKey: "item-group",
  },
  {
    icon: Hash,
    label: "Unit of Measurement",
    path: "/masters/unit-measurement",
    color: "text-orange-400",
    pageKey: "unit-of-measurement",
  },
  {
    icon: ReceiptIndianRupee,
    label: "HSN",
    path: "/masters/hsn",
    color: "text-pink-400",
    pageKey: "hsn-master",
  },
  {
    icon: BillingIcon,
    label: "Billing",
    path: "/masters/billing-terms",
    color: "text-lime-500",
    pageKey: "billing-terms",
  },
  {
    icon: FileText,
    label: "T&C",
    path: "/material/t-c-master",
    color: "text-purple-500",
    pageKey: "t-c-master",
  },
  {
    icon: CalendarClock,
    label: "Payment Terms",
    path: "/masters/payment-terms",
    color: "text-sky-500",
    pageKey: "payment-terms",
  },
  {
    icon: ClipboardList,
    label: "Inventory",
    path: "/material/inventory-master",
    color: "text-sky-400",
    pageKey: "inventory-master",
  },
];

export const fixedAssetSetupItems: SetupItem[] = [
  {
    icon: Percent,
    label: "Depreciation Setup",
    path: "/fixed-asset/depreciation-setup",
    color: "text-yellow-500",
    pageKey: "depreciation-setup",
  },
  {
    icon: Hash,
    label: "ID Template Master",
    path: "/fixed-asset/id-template-master",
    color: "text-yellow-500",
    pageKey: "id-template-master",
  },
];

export const followupSetupItems: SetupItem[] = [
  // "Task Master" was moved from here into the Follow-Up module sidebar
  // (see sidebars/FollowupSidebar.ts) — it's the module's core master list,
  // not a set-and-forget configuration. Route/pageKey unchanged.
  {
    icon: Users,
    label: "Department Master",
    path: "/followup/setup/department-master",
    color: "text-cyan-500",
    pageKey: "followup-department-master",
  },
  {
    icon: Tag,
    label: "Tag Master",
    path: "/followup/setup/tag-master",
    color: "text-pink-500",
    pageKey: "followup-tag-master",
  },
  {
    icon: XCircle,
    label: "Cancel Template",
    path: "/followup/setup/cancel-template",
    color: "text-red-500",
    pageKey: "followup-cancel-template-master",
  },
];

export const engineeringSetupItems: SetupItem[] = [
  {
    icon: Activity,
    label: "Activity Master",
    path: "/masters/activity",
    color: "text-orange-400",
    pageKey: "activity-master",
  },
  {
    icon: GitBranch,
    label: "Dependency Master",
    path: "/masters/dependency",
    color: "text-cyan-400",
    pageKey: "dependency-master",
  },
];

// Activity Master is the shared Engineering master (no separate Civil Work
// DPR-specific one) — this just gives quick access to it from this module.
export const civilWorkDprSetupItems: SetupItem[] = [
  {
    icon: ClipboardList,
    label: "Activity",
    path: "/masters/activity",
    color: "text-cyan-500",
    pageKey: "activity-master",
  },
  {
    icon: LayoutGrid,
    label: "Room Composition",
    path: "/civilworkdpr/room-composition",
    color: "text-cyan-500",
    pageKey: "room-composition-builder",
  },
  {
    icon: Tag,
    label: "Room Categories",
    path: "/civilworkdpr/room-category-master",
    color: "text-cyan-500",
    pageKey: "room-category-master",
  },
  {
    icon: DoorOpen,
    label: "Room Master",
    path: "/civilworkdpr/room-master",
    color: "text-cyan-500",
    pageKey: "civilworkdpr-room-master",
  },
  {
    icon: ClipboardCheck,
    label: "Work Checkpoints",
    path: "/civilworkdpr/work-checkpoint-master",
    color: "text-cyan-500",
    pageKey: "work-checkpoint-master",
  },
];

export const salesAutomationSetupItems: SetupItem[] = [
  {
    icon: Megaphone,
    label: "Social Media",
    path: "/sales-automation/social-media",
    color: "text-pink-500",
    pageKey: "sa-social-media",
  },
  {
    icon: SlidersHorizontal,
    label: "Distribution Rules",
    path: "/sales-automation/distribution-rules",
    color: "text-amber-500",
    pageKey: "sa-distribution-rules",
  },
  {
    icon: UsersRound,
    label: "Teams",
    path: "/sales-automation/teams",
    color: "text-purple-500",
    pageKey: "sa-teams",
  },
  {
    icon: ShieldCheck,
    label: "Role Master",
    path: "/sales-automation/role-master",
    color: "text-orange-500",
    pageKey: "sa-role-master",
  },
];

// Unit/Block/Room/Parking/Extra-Charge masters are shared with the
// Follow-Up module (same underlying data and pageKey gating), but they're
// now ALSO registered under /crm/setup/* in App.tsx so these links stay
// inside the crm module — a /followup/... URL would flip the whole app
// into Follow-Up chrome the moment it's clicked (ModuleContext derives
// activeModule purely from the path prefix). pageKey still points at the
// real (shared, followup-*) permission the route actually checks, so
// visibility for non-privileged users matches the real access gate.
export const crmSetupItems: SetupItem[] = [
  {
    icon: Wand2,
    label: "Auto Project Setup",
    path: "/crm/setup/auto-project-setup",
    color: "text-fuchsia-500",
    pageKey: "crm-auto-project-setup",
  },
  {
    icon: Ruler,
    label: "Unit Master",
    path: "/crm/setup/unit-master",
    color: "text-orange-500",
    pageKey: "followup-unit-master",
  },
  {
    icon: Layers,
    label: "Block Master",
    path: "/crm/setup/block-master",
    color: "text-cyan-500",
    pageKey: "followup-block-master",
  },
  {
    icon: HardHat,
    label: "Broker Master",
    path: "/masters/brokers",
    color: "text-amber-500",
    pageKey: "broker-master",
  },
  {
    icon: ClipboardList,
    label: "Payment Plan Master",
    path: "/crm/payment-plans",
    color: "text-emerald-500",
    pageKey: "crm-payment-plans",
  },
  {
    icon: ClipboardList,
    label: "Milestone Master",
    path: "/crm/milestone-master",
    color: "text-teal-500",
    pageKey: "crm-milestone-master",
  },
  {
    icon: Percent,
    label: "Brokerage Rate Tiers",
    path: "/crm/brokerage-rate-tiers",
    color: "text-rose-500",
    pageKey: "crm-brokerage-rate-tiers",
  },
  {
    icon: Car,
    label: "Parking Rate Master",
    path: "/crm/setup/parking-master",
    color: "text-blue-500",
    pageKey: "followup-parking-master",
  },
  {
    icon: Hash,
    label: "Parking Slot Master",
    path: "/crm/setup/parking-slot-master",
    color: "text-sky-500",
    pageKey: "followup-parking-slot-master",
  },
  {
    icon: PlusCircle,
    label: "Extra Charge Master",
    path: "/crm/setup/extra-charge-master",
    color: "text-pink-500",
    pageKey: "followup-extra-charge-master",
  },
  {
    icon: Activity,
    label: "Pending Tasks",
    path: "/crm/setup/pending-tasks",
    color: "text-purple-500",
    pageKey: "followup-pending-tasks",
  },
  {
    icon: Calendar,
    label: "Reminders",
    path: "/crm/setup/reminders",
    color: "text-indigo-500",
    pageKey: "followup-reminders",
  },
];

export const adminSetupItems: SetupItem[] = [
  {
    icon: LayoutGrid,
    label: "Menu Types",
    path: "/admin/masters/menu-types",
    color: "text-emerald-500",
  },
  {
    icon: Tag,
    label: "Entry Type",
    path: "/masters/named-entry-type",
    color: "text-purple-400",
  },
  {
    icon: FileType2,
    label: "Type of Doc",
    path: "/masters/type-of-doc",
    color: "text-sky-500",
  },
  {
    icon: Users,
    label: "Role Master",
    path: "/admin/masters/role-master",
    color: "text-blue-400",
  },
];
