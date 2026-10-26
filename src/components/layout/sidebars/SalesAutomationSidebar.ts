import { VideoPlay, Profile2User, Receipt21, Category2, Chart2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Masters/config pages (Social Media, Distribution Rules, Teams) live only
// in the per-module Setup dropdown (src/components/layout/setupMenus.ts ->
// salesAutomationSetupItems) — same convention every other module follows
// (operational workflow screens in the sidebar, masters/config in Setup).
// This file used to also list "Distribution Rules" in the Leads group,
// duplicating its Setup entry - removed.
export const salesAutomationNavItems: NavItem[] = [
  // ── Dashboard ──────────────────────────────────────────────────────────────
  // Was 3 separate entries (Marketing/Sales/Team Lead) pointing at 3
  // separate pages - now one page with the 3 scopes as tabs inside it.
  { label: "Dashboard", icon: Category2, path: "/sales-automation/dashboard", pageKey: "sa-leads", isDashboard: true },

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
  // Split from one 11-item flat list into two groups by what staff actually
  // do: find/track a lead vs. act on one.
  {
    label: "Leads",
    icon: Profile2User,
    children: [
      { label: "All Leads",    path: "/sales-automation/leads",          pageKey: "sa-leads"              },
      { label: "Pipeline",     path: "/sales-automation/pipeline",       pageKey: "sa-leads"              },
      { label: "Inquiry",      path: "/sales-automation/inquiry",        pageKey: "sa-inquiry"            },
      { label: "Transfers",    path: "/sales-automation/lead-transfers",  pageKey: "sa-lead-transfers"    },
      { label: "Channel Partners", path: "/sales-automation/channel-partners", pageKey: "sa-channel-partners" },
    ],
  },
  {
    label: "Engagement",
    icon: Profile2User,
    children: [
      { label: "Follow-Up",    path: "/sales-automation/followups",      pageKey: "sa-followups"          },
      { label: "Site Visits",  path: "/sales-automation/site-visits",    pageKey: "sa-site-visits"        },
      { label: "Activities",   path: "/sales-automation/lead-activities", pageKey: "sa-lead-activities"   },
      { label: "Tasks",        path: "/sales-automation/lead-tasks",     pageKey: "sa-lead-tasks"         },
      { label: "Distribution", path: "/sales-automation/distribution",   pageKey: "sa-lead-distribution"  },
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
