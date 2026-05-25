import {
  BarChart3,
  Users,
  Shield,
  CheckCircle2,
  ShieldCheck,
  MessageSquare,
  Building2,
  TrendingUp,
  FileText,
  Ticket,
  Plug,
  Layers,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const buildAdminNavItems = (pendingCount: number): NavItem[] => [
  { label: "Control Center", icon: BarChart3, path: "/admin/dashboard" },
  {
    label: "User Control",
    icon: Users,
    children: [
      { label: "Manage Users", path: "/users" },
      { label: "Activity Browser", path: "/admin/activity-browser" },
    ],
  },
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
    label: "Enterprise",
    icon: Building2,
    children: [
      { label: "Enterprise", path: "/admin/masters/business-unit" },
      { label: "Company", path: "/admin/masters/company" },
      { label: "Project", path: "/admin/masters/project" },
    ],
  },
  {
    label: "Approval",
    icon: CheckCircle2,
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
    icon: ShieldCheck,
    children: [
      { label: "Password Reset", path: "/admin/security/password-reset" },
    ],
  },
  {
    label: "Communicator",
    icon: MessageSquare,
    children: [
      { label: "SMS Setup", path: "/admin/communicator/sms-setup" },
      { label: "Email Setup", path: "/admin/communicator/email-setup" },
      { label: "WhatsApp Setup", path: "/admin/communicator/whatsapp-setup" },
      { label: "Integration Channels", path: "/admin/masters/integration-channels" },
    ],
  },
  {
    label: "Masters",
    icon: Layers,
    children: [
      { label: "Contractor Categories", path: "/admin/masters/contractor-categories" },
      { label: "Godowns", path: "/admin/masters/godowns" },
      { label: "Page Definitions", path: "/admin/page-definitions" },
    ],
  },
  {
    label: "Support Tickets",
    icon: Ticket,
    children: [{ label: "Resolution", path: "/admin/tickets/resolution" }],
  },
  { label: "API Integration", icon: Shield, path: "/admin/api-integration" },
  { label: "Live Metrics", icon: TrendingUp, path: "/admin/metrics" },
  { label: "Signature", icon: FileText, path: "/admin/signature" },
];