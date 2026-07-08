import { ClipboardList, FileText, IndianRupee, Wrench, Scale, HardHat, LayoutDashboard } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const crmNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/crm/dashboard", pageKey: "crm-dashboard" },

  // ── CRM Pipeline ────────────────────────────────────────────────────────────
  {
    label: "Pipeline",
    icon: ClipboardList,
    children: [
      { label: "Applications",   path: "/crm/applications",   pageKey: "crm-applications"  },
      { label: "Bookings",       path: "/crm/bookings",       pageKey: "crm-bookings"      },
      { label: "Welcome Calls",  path: "/crm/welcome-calls",  pageKey: "crm-welcome-calls" },
      { label: "Communication Log", path: "/crm/communication", pageKey: "crm-communication" },
      { label: "Customer Bank & Nominee", path: "/crm/customer-bank-details", pageKey: "crm-customer-bank-details" },
    ],
  },

  // ── CRM Documents ───────────────────────────────────────────────────────────
  {
    label: "Documents",
    icon: FileText,
    children: [
      { label: "Agreements",       path: "/crm/agreements",        pageKey: "crm-agreements" },
      { label: "Agreement Papers", path: "/crm/agreement-papers",  pageKey: "crm-documents"  },
    ],
  },

  // ── CRM Legal ───────────────────────────────────────────────────────────────
  {
    label: "Legal",
    icon: Scale,
    children: [
      { label: "Legal Milestones", path: "/crm/legal-milestones", pageKey: "crm-legal-milestones" },
      { label: "NOC (Org & Bank)", path: "/crm/noc",              pageKey: "crm-noc"              },
      { label: "Sale Deed",        path: "/crm/sales-deed",       pageKey: "crm-sales-deed"       },
    ],
  },

  // ── CRM Closure ─────────────────────────────────────────────────────────────
  {
    label: "Closure",
    icon: HardHat,
    children: [
      { label: "Pre-Possession Check", path: "/crm/pre-possession",       pageKey: "crm-pre-possession"       },
      { label: "Possession Notice",    path: "/crm/possession-notice",    pageKey: "crm-possession-notice"    },
      { label: "Construction Updates", path: "/crm/construction-updates", pageKey: "crm-construction-updates" },
    ],
  },

  // ── CRM Finance ─────────────────────────────────────────────────────────────
  {
    label: "Finance",
    icon: IndianRupee,
    children: [
      { label: "Payment Milestones", path: "/crm/payments",       pageKey: "crm-payments"      },
      { label: "Brokerage",          path: "/crm/brokerage",      pageKey: "crm-brokerage"     },
      { label: "Broker Payment",     path: "/crm/broker-payments",pageKey: "crm-brokerage"     },
    ],
  },

  // ── CRM After-Sales ─────────────────────────────────────────────────────────
  {
    label: "After-Sales",
    icon: Wrench,
    children: [
      { label: "Possession & Handover", path: "/crm/handover",        pageKey: "crm-handover"        },
      { label: "Service Tickets",       path: "/crm/service-tickets", pageKey: "crm-service-tickets" },
      { label: "Cancellations",         path: "/crm/cancellations",   pageKey: "crm-cancellations"   },
      { label: "Customer 360",          path: "/crm/customer-360",    pageKey: "crm-customer-360"    },
    ],
  },
];
