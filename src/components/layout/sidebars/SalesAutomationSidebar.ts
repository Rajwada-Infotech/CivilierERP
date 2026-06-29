import { Volume, VideoPlay, Gallery, Profile2User, Hierarchy, Call, Location, Receipt21, Category2, Chart2, ArrowSwapHorizontal, UserOctagon, Setting4 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const salesAutomationNavItems: NavItem[] = [
  { label: "Social Media",  icon: Volume,   path: "/sales-automation/social-media", pageKey: "sa-social-media" },
  { label: "Campaigns",     icon: VideoPlay, path: "/sales-automation/campaigns",    pageKey: "sa-campaigns"    },
  { label: "Ads",           icon: Gallery,   path: "/sales-automation/ads",          pageKey: "sa-ads"          },
  { label: "Leads",         icon: Profile2User,       path: "/sales-automation/leads",         pageKey: "sa-leads"                 },
  { label: "Distribution",   icon: Hierarchy,   path: "/sales-automation/distribution",  pageKey: "sa-lead-distribution"     },
  { label: "Transfers",       icon: ArrowSwapHorizontal, path: "/sales-automation/lead-transfers", pageKey: "sa-lead-transfers" },
  { label: "Inquiry",         icon: Call,       path: "/sales-automation/inquiry",       pageKey: "sa-inquiry"               },
  { label: "Site Visits",     icon: Location,      path: "/sales-automation/site-visits",   pageKey: "sa-site-visits"           },
  { label: "Invoices",        icon: Receipt21,     path: "/sales-automation/invoices",      pageKey: "sa-marketing-invoices"    },
  { label: "Marketing",  icon: Category2, path: "/sales-automation/dashboard/marketing", pageKey: "sa-campaigns" },
  { label: "Sales",      icon: Category2, path: "/sales-automation/dashboard/sales",     pageKey: "sa-leads" },
  { label: "Team Lead",  icon: Category2, path: "/sales-automation/dashboard/team-lead", pageKey: "sa-lead-distribution" },
  { label: "Reports",             icon: Chart2,       path: "/sales-automation/reports",             pageKey: "sa-leads" },
  { label: "Teams",       icon: UserOctagon, path: "/sales-automation/teams",        pageKey: "sa-teams" },
  { label: "Dist. Rules", icon: Setting4,    path: "/sales-automation/distribution-rules", pageKey: "sa-distribution-rules" },
  { label: "Role Master", icon: Setting4,    path: "/sales-automation/role-master", pageKey: "sa-role-master" },
];
