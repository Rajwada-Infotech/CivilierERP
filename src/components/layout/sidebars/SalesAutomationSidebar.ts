import { Megaphone, MonitorPlay, ImagePlay, Users, GitBranch, Phone, MapPin, Receipt, LayoutDashboard, BarChart3 } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const salesAutomationNavItems: NavItem[] = [
  { label: "Social Media",  icon: Megaphone,   path: "/sales-automation/social-media", pageKey: "sa-social-media" },
  { label: "Campaigns",     icon: MonitorPlay, path: "/sales-automation/campaigns",    pageKey: "sa-campaigns"    },
  { label: "Ads",           icon: ImagePlay,   path: "/sales-automation/ads",          pageKey: "sa-ads"          },
  { label: "Leads",         icon: Users,       path: "/sales-automation/leads",         pageKey: "sa-leads"                 },
  { label: "Distribution",   icon: GitBranch,   path: "/sales-automation/distribution",  pageKey: "sa-lead-distribution"     },
  { label: "Inquiry",         icon: Phone,       path: "/sales-automation/inquiry",       pageKey: "sa-inquiry"               },
  { label: "Site Visits",     icon: MapPin,      path: "/sales-automation/site-visits",   pageKey: "sa-site-visits"           },
  { label: "Invoices",        icon: Receipt,     path: "/sales-automation/invoices",      pageKey: "sa-marketing-invoices"    },
  { label: "Marketing Dashboard", icon: LayoutDashboard, path: "/sales-automation/dashboard/marketing", pageKey: "sa-campaigns" },
  { label: "Sales Dashboard",     icon: LayoutDashboard, path: "/sales-automation/dashboard/sales",     pageKey: "sa-leads" },
  { label: "Team Lead Dashboard", icon: LayoutDashboard, path: "/sales-automation/dashboard/team-lead", pageKey: "sa-lead-distribution" },
  { label: "Reports",             icon: BarChart3,       path: "/sales-automation/reports",             pageKey: "sa-leads" },
];