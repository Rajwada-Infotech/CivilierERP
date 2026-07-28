// RN port of src/components/layout/sidebars/AdminSidebar.ts's buildAdminNavItems
// (web) — same grouping, same order. Only "Control Center" (the dashboard)
// navigates for real; every other leaf alerts "not built yet" until it gets
// its own screen, same convention as mobile/'s NavSheet.tsx for
// unbuilt module leaves.
import {
  LayoutDashboard, Building, Layers, Users, CheckCircle2, ShieldCheck,
  Ticket, Shield, MessageSquare, Cpu, TrendingUp, FileText,
} from "lucide-react-native";
import type { MainStackParamList } from "./MainStack";

export type NavLeaf = { kind: "leaf"; label: string; icon: React.ComponentType<{ size?: number; color?: string }>; nav?: keyof MainStackParamList };
export type NavGroup = {
  kind: "group";
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  children: Array<{ label: string; icon: React.ComponentType<{ size?: number; color?: string }>; nav?: keyof MainStackParamList }>;
};
export type NavTree = Array<NavLeaf | NavGroup>;

export const ADMIN_NAV_TREE: NavTree = [
  { kind: "leaf", label: "Control Center", icon: LayoutDashboard, nav: "Dashboard" },
  {
    kind: "group",
    label: "Enterprise",
    icon: Building,
    children: [
      { label: "Enterprise", icon: Building },
      { label: "Company", icon: Building },
      { label: "Project", icon: Building },
    ],
  },
  {
    kind: "group",
    label: "Masters",
    icon: Layers,
    children: [
      { label: "Contractor Categories", icon: Layers },
      { label: "Godowns", icon: Layers },
      { label: "Page Definitions", icon: Layers },
    ],
  },
  {
    kind: "group",
    label: "User Control",
    icon: Users,
    children: [
      { label: "Manage Users", icon: Users },
      { label: "Activity Browser", icon: Users },
    ],
  },
  {
    kind: "group",
    label: "Approval",
    icon: CheckCircle2,
    children: [
      { label: "Inbox", icon: CheckCircle2 },
      { label: "Approval Setup", icon: CheckCircle2 },
      { label: "Post Approval Rights", icon: CheckCircle2 },
    ],
  },
  {
    kind: "group",
    label: "Security",
    icon: ShieldCheck,
    children: [{ label: "Password Reset", icon: ShieldCheck }],
  },
  {
    kind: "group",
    label: "Tickets",
    icon: Ticket,
    children: [{ label: "Resolution", icon: Ticket }],
  },
  {
    kind: "group",
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", icon: Shield },
      { label: "Widgets", icon: Shield },
      { label: "Financial Year", icon: Shield },
    ],
  },
  {
    kind: "group",
    label: "Communicator",
    icon: MessageSquare,
    children: [
      { label: "SMS Setup", icon: MessageSquare },
      { label: "Email Setup", icon: MessageSquare },
      { label: "WhatsApp Setup", icon: MessageSquare },
      { label: "Integration Channels", icon: MessageSquare },
    ],
  },
  { kind: "leaf", label: "Integrations", icon: Cpu },
  { kind: "leaf", label: "Live Metrics", icon: TrendingUp },
  { kind: "leaf", label: "Signature", icon: FileText },
];
