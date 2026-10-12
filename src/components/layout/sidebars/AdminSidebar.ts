import { Chart2, Profile2User, Shield, TickCircle, ShieldTick, Message2, Building, TrendUp, DocumentText, Ticket, Cpu, Layer, Mobile, Setting2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";
import { ADMIN_PATH_PAGE_KEYS } from "@/contexts/module.utils";

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
      { label: "Project Access", path: "/admin/rights/project-access" },
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
  { label: "APK Manager", icon: Mobile, path: "/admin/apk-manager" },
  { label: "System Maintenance", icon: Setting2, path: "/admin/system-maintenance" },
];

/**
 * The Admin menu for someone who is not admin-tier: only the pages ticked for them in Menu Rights. An item with no
 * page key (APK Manager, System Maintenance, ticket panels) is admin-tier only, so it is dropped, and a group with
 * nothing left disappears.
 */
export function filterAdminNavItems(items: NavItem[], canAccessPage: (pageKey: string) => boolean): NavItem[] {
  const allowed = (path?: string) => {
    const key = path ? ADMIN_PATH_PAGE_KEYS[path] : undefined;
    return !!key && canAccessPage(key);
  };
  return items.reduce<NavItem[]>((acc, item) => {
    if (item.children) {
      const children = item.children.filter((c) => allowed(c.path));
      if (children.length > 0) acc.push({ ...item, children });
    } else if (allowed(item.path)) {
      acc.push(item);
    }
    return acc;
  }, []);
}
