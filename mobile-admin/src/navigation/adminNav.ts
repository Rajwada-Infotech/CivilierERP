// RN port of src/components/layout/sidebars/AdminSidebar.ts's buildAdminNavItems
// (web) — trimmed to just the sections this app actually covers: Approval,
// Security, and Rights — every leaf in all three groups now navigates to a
// real screen.
import {
  LayoutDashboard, CheckCircle2, ShieldCheck, Shield,
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
    label: "Approval",
    icon: CheckCircle2,
    children: [
      { label: "Inbox", icon: CheckCircle2, nav: "ApprovalInbox" },
      { label: "Approval Setup", icon: CheckCircle2, nav: "ApprovalSetup" },
      { label: "Post Approval Rights", icon: CheckCircle2, nav: "PostApprovalRights" },
    ],
  },
  {
    kind: "group",
    label: "Security",
    icon: ShieldCheck,
    children: [{ label: "Password Reset", icon: ShieldCheck, nav: "PasswordReset" }],
  },
  {
    kind: "group",
    label: "Rights",
    icon: Shield,
    children: [
      { label: "Menu", icon: Shield, nav: "MenuRights" },
      { label: "Widgets", icon: Shield, nav: "WidgetRights" },
      { label: "Financial Year", icon: Shield, nav: "FinYearRights" },
    ],
  },
];
