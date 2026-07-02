import { Chart2, Profile2User, Shield, TickCircle, ShieldTick, Message2, Building, TrendUp, DocumentText, Ticket, Cpu, Layer } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const buildAdminNavItems = (pendingCount: number): NavItem[] => [
  // ── 1. Dashboard ───────────────────────────────────────────────────────────
  { label: "Control Center", icon: Chart2, path: "/admin/dashboard", isDashboard: true },

  // ── 2. Master Setup ────────────────────────────────────────────────────────
  {
    label: "Enterprise",
    icon: Building,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  {
    label: "Masters",
    icon: Layer,
    children: [
      { label: "Contractor Categories", path: "/admin/masters/contractor-categories" },
      { label: "Godowns", path: "/admin/masters/godowns" },
      { label: "Page Definitions", path: "/admin/page-definitions" },
    ],
  },
  {
    label: "User Control",
    icon: Profile2User,
    children: [
      { label: "Manage Users", path: "/users" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
    ],
  },

  // ── 3. Approval & Access ───────────────────────────────────────────────────
  {
    label: "Approval",
    icon: TickCircle,
    children: [
      {
        label: "Inbox",
        path: "/admin/approval/inbox",
        badge: pendingCount > 0 ? pendingCount : undefined,
      },
      { label: "Approval Setup", path: "/admin/approval/setup" },
      { label: "Post Approval Rights", path: "/admin/approval/post-rights" },
    ],
  },
  {
    label: "Security",
    icon: ShieldTick,
    children: [
      { label: "Password Reset", path: "/admin/security/password-reset" },
    ],
  },
  {
    label: "Tickets",
    icon: Ticket,
    children: [{ label: "Resolution", path: "/admin/tickets/resolution" }],
  },

  // ── 4. Rights, Integrations & Misc ────────────────────────────────────────
  {
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", path: "/admin/rights/menu" },
      { label: "Widgets", path: "/admin/rights/widgets" },
      { label: "Financial Year", path: "/admin/rights/fin-year" },
    ],
  },
  {
    label: "Communicator",
    icon: Message2,
    children: [
      { label: "SMS Setup", path: "/admin/communicator/sms-setup" },
      { label: "Email Setup", path: "/admin/communicator/email-setup" },
      { label: "WhatsApp Setup", path: "/admin/communicator/whatsapp-setup" },
      { label: "Integration Channels", path: "/admin/masters/integration-channels" },
    ],
  },
  { label: "Integrations", icon: Cpu, path: "/admin/api-integration" },
  { label: "Live Metrics", icon: TrendUp, path: "/admin/metrics" },
  { label: "Signature", icon: DocumentText, path: "/admin/signature" },
];
