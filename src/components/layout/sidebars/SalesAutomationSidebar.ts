import { VideoPlay, Profile2User, Message2, Routing, Receipt21, Category2, Chart2 } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// ── Sales Automation Workflow Lifecycle ──────────────────────────────────────
// The sidebar strictly follows the natural sales funnel from inception to close:
//
//   1. Dashboard     → Operational overview (Sales, Marketing, Team Lead tabs)
//   2. Campaigns     → Lead Generation / Sourcing (Campaigns & Ads)
//   3. Leads         → Inflow & Allocation (Inquiries → Distribution → All Leads)
//   4. Engagement    → Daily Sales Work (Follow-Up calls → Site Visits → Activities → Tasks)
//   5. Pipeline      → Deal Closing (Stage Kanban → Transfers / Reassignment)
//   6. Finance       → Commercials (Marketing Invoices, Sales & Partner Commissions)
//   7. Reports       → Analytics & Performance Metrics
//
// Masters & Config (Social Media, Distribution Rules, Teams, Channel Partners)
// live exclusively in the Setup dropdown (setupMenus.ts → salesAutomationSetupItems).

export const salesAutomationNavItems: NavItem[] = [
  // ── 01. Single Unified Dashboard ───────────────────────────────────────────
  { label: "Dashboard", icon: Category2, path: "/sales-automation", pageKey: "sa-leads", isDashboard: true },

  // ── 02. Acquisition (Sourcing Leads) ───────────────────────────────────────
  {
    label: "Campaigns",
    icon: VideoPlay,
    children: [
      { label: "Campaigns", path: "/sales-automation/campaigns", pageKey: "sa-campaigns" },
      { label: "Ads",       path: "/sales-automation/ads",       pageKey: "sa-ads"       },
    ],
  },

  // ── 03. Inflow & Allocation (Raw Inflow to Assigned Leads) ─────────────────
  {
    label: "Leads",
    icon: Profile2User,
    children: [
      { label: "Inquiries",    path: "/sales-automation/inquiry",        pageKey: "sa-inquiry"           },
      { label: "Distribution", path: "/sales-automation/distribution",   pageKey: "sa-lead-distribution" },
      { label: "All Leads",    path: "/sales-automation/leads",          pageKey: "sa-leads"             },
    ],
  },

  // ── 04. Engagement (Daily Sales Rep Workbench) ─────────────────────────────
  {
    label: "Engagement",
    icon: Message2,
    children: [
      { label: "Follow-Up",   path: "/sales-automation/followups",       pageKey: "sa-followups"         },
      { label: "Site Visits", path: "/sales-automation/site-visits",     pageKey: "sa-site-visits"       },
      { label: "Activities",  path: "/sales-automation/lead-activities", pageKey: "sa-lead-activities"   },
      { label: "Tasks",       path: "/sales-automation/lead-tasks",      pageKey: "sa-lead-tasks"        },
    ],
  },

  // ── 05. Pipeline & Closing (Stage Progression & Transfers) ─────────────────
  {
    label: "Pipeline",
    icon: Routing,
    children: [
      { label: "Stage Board", path: "/sales-automation/pipeline",        pageKey: "sa-leads"             },
      { label: "Transfers",   path: "/sales-automation/lead-transfers",  pageKey: "sa-lead-transfers"    },
    ],
  },

  // ── 06. Commercials (Expenditure & Payouts) ────────────────────────────────
  {
    label: "Finance",
    icon: Receipt21,
    children: [
      { label: "Invoices",    path: "/sales-automation/invoices",        pageKey: "sa-marketing-invoices" },
      { label: "Commissions", path: "/sales-automation/commissions",     pageKey: "sa-commissions"        },
    ],
  },

  // ── 07. Reporting ──────────────────────────────────────────────────────────
  { label: "Reports", icon: Chart2, path: "/sales-automation/reports", pageKey: "sa-reports" },
];
