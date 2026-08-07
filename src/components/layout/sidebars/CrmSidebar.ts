import { ClipboardList, FileText, IndianRupee, Wrench, Scale, HardHat, LayoutDashboard, Grid3x3, Users } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

export const crmNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/crm/dashboard", pageKey: "crm-dashboard" },

  // ── CRM Leads (SA handoff pool) ──────────────────────────────────────────────
  // Converted leads from Sales Automation land here first — they are NOT
  // CrmApplications yet. Staff pick from this pool when they start a New
  // Application (see CrmApplication.tsx's lead picker).
  {
    label: "Leads",
    icon: Users,
    children: [
      { label: "All Leads", path: "/crm/leads", pageKey: "crm-leads" },
    ],
  },

  // ── CRM Pipeline ────────────────────────────────────────────────────────────
  {
    label: "Pipeline",
    icon: ClipboardList,
    children: [
      { label: "Customers",      path: "/crm/customers",      pageKey: "crm-customers"     },
      { label: "Applications",   path: "/crm/applications",   pageKey: "crm-applications"  },
      { label: "Applications and Bookings", path: "/crm/bookings", pageKey: "crm-bookings" },
      { label: "Welcome Calls",  path: "/crm/welcome-calls",  pageKey: "crm-welcome-calls" },
      { label: "Communication Log", path: "/crm/communication", pageKey: "crm-communication" },
      { label: "Customer Bank & Nominee", path: "/crm/customer-bank-details", pageKey: "crm-customer-bank-details" },
    ],
  },

  // ── CRM Inventory Matrix ────────────────────────────────────────────────────
  {
    label: "Matrix",
    icon: Grid3x3,
    children: [
      { label: "Unit Matrix",    path: "/crm/unit-matrix",    pageKey: "crm-unit-matrix"    },
      { label: "Parking Matrix", path: "/crm/parking-matrix", pageKey: "crm-parking-matrix" },
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
      // Order follows the real post-agreement sequence: the Sale Deed must
      // exist before Query Payment (which reads its stamp duty/reg fee) or
      // Bank NOC (which releases the bank's charge against the unit).
      { label: "Sale Deed",        path: "/crm/sales-deed",       pageKey: "crm-sales-deed"       },
      { label: "Query Payment",    path: "/crm/query-payment",    pageKey: "crm-query-payment"    },
      { label: "Registry",         path: "/crm/registry",         pageKey: "crm-registry"         },
      { label: "NOC (Org & Bank)", path: "/crm/noc",              pageKey: "crm-noc"              },
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
      { label: "Home Loan Tracking", path: "/crm/loan-details",   pageKey: "crm-loan-details"  },
      { label: "Demands",            path: "/crm/demands",        pageKey: "crm-payments"      },
      { label: "Parking Booking",    path: "/crm/parking-booking",pageKey: "crm-parking-booking" },
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