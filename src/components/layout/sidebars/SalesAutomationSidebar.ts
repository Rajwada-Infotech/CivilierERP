import {
  LayoutDashboard, Users, Megaphone, Receipt,
  UsersRound, BarChart3,
} from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const salesAutomationNavItems: NavItem[] = [
  {
    label: "Dashboards",
    icon: LayoutDashboard,
    children: [
      { label: "Marketing",  path: "/sales-automation/dashboard/marketing",  pageKey: "sa-campaigns" },
      { label: "Sales",      path: "/sales-automation/dashboard/sales",      pageKey: "sa-leads" },
      { label: "Team Lead",  path: "/sales-automation/dashboard/team-lead",  pageKey: "sa-lead-distribution" },
    ],
  },

  {
    label: "Leads",
    icon: Users,
    children: [
      { label: "All Leads",    path: "/sales-automation/leads",          pageKey: "sa-leads" },
      { label: "Distribution", path: "/sales-automation/distribution",   pageKey: "sa-lead-distribution" },
      { label: "Inquiry",      path: "/sales-automation/inquiry",        pageKey: "sa-inquiry" },
      { label: "Site Visits",  path: "/sales-automation/site-visits",    pageKey: "sa-site-visits" },
      { label: "Transfers",    path: "/sales-automation/lead-transfers", pageKey: "sa-lead-transfers" },
    ],
  },

  {
    label: "Marketing",
    icon: Megaphone,
    children: [
      { label: "Social Media", path: "/sales-automation/social-media", pageKey: "sa-social-media" },
      { label: "Campaigns", path: "/sales-automation/campaigns", pageKey: "sa-campaigns" },
      { label: "Ads",       path: "/sales-automation/ads",       pageKey: "sa-ads" },
      { label: "Invoices",  path: "/sales-automation/invoices",  pageKey: "sa-marketing-invoices" },
    ],
  },

  {
    label: "Management",
    icon: UsersRound,
    children: [
      { label: "Reports",     path: "/sales-automation/reports",      pageKey: "sa-leads" },
      { label: "Teams",       path: "/sales-automation/teams",        pageKey: "sa-teams" },
      { label: "Dist. Rules", path: "/sales-automation/distribution-rules", pageKey: "sa-distribution-rules" },
      { label: "Role Master", path: "/sales-automation/role-master", pageKey: "sa-role-master" },
    ],
  },

];
