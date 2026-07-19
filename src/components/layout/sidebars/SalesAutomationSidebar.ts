import { VideoPlay, Profile2User, Receipt21, Category2, Chart2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

export const salesAutomationNavItems: NavItem[] = [
  // ── Dashboards ─────────────────────────────────────────────────────────────
  {
    label: "Dashboards",
    icon: Category2,
    children: [
      { label: "Marketing",  path: "/sales-automation/dashboard/marketing" },
      { label: "Sales",      path: "/sales-automation/dashboard/sales"     },
      { label: "Team Lead",  path: "/sales-automation/dashboard/team-lead" },
    ],
  },

  // ── Campaigns ──────────────────────────────────────────────────────────────
  {
    label: "Campaigns",
    icon: VideoPlay,
    children: [
      { label: "Campaigns", path: "/sales-automation/campaigns", pageKey: "sa-campaigns" },
      { label: "Ads",       path: "/sales-automation/ads",       pageKey: "sa-ads"       },
    ],
  },

  // ── Leads ──────────────────────────────────────────────────────────────────
  {
    label: "Leads",
    icon: Profile2User,
    children: [
      { label: "All Leads",    path: "/sales-automation/leads",          pageKey: "sa-leads"              },
      { label: "Inquiry",      path: "/sales-automation/inquiry",        pageKey: "sa-inquiry"            },
      { label: "Follow-Up",    path: "/sales-automation/followups",      pageKey: "sa-followups"          },
      { label: "Site Visits",  path: "/sales-automation/site-visits",    pageKey: "sa-site-visits"        },
      { label: "Activities",   path: "/sales-automation/lead-activities", pageKey: "sa-lead-activities"   },
      { label: "Tasks",        path: "/sales-automation/lead-tasks",     pageKey: "sa-lead-tasks"         },
      { label: "Distribution", path: "/sales-automation/distribution",   pageKey: "sa-lead-distribution"  },
      { label: "Transfers",    path: "/sales-automation/lead-transfers",  pageKey: "sa-lead-transfers"    },
      { label: "Channel Partners", path: "/sales-automation/channel-partners", pageKey: "sa-channel-partners" },
    ],
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  {
    label: "Finance",
    icon: Receipt21,
    children: [
      { label: "Invoices", path: "/sales-automation/invoices", pageKey: "sa-marketing-invoices" },
      { label: "Commissions", path: "/sales-automation/commissions", pageKey: "sa-commissions" },
    ],
  },

  // ── Reports ────────────────────────────────────────────────────────────────
  { label: "Reports", icon: Chart2, path: "/sales-automation/reports", pageKey: "sa-reports" },
];
