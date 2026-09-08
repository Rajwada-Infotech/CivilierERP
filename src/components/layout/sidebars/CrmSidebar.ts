import { ClipboardList, FileText, IndianRupee, Wrench, Scale, HardHat, LayoutDashboard, Grid3x3, Users, Key, Building2 } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

// Sidebar groups follow the real legal workflow sequence per Transfer of
// Property Act 1882 (s.54) and Indian Sub-Registrar practice:
//
//   Pipeline → Pre-Sale Docs → Sub-Registrar Visit 1 (AFS Reg) →
//   Sub-Registrar Visit 2 (Sale Deed → QP → Registry → Mutation) →
//   NOC (bank lien released after deed; org no-dues confirmed) →
//   Possession (OC/CC → Pre-Possession → Notice → Handover) →
//   Finance → After-Sales
//
export const crmNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/crm/dashboard", pageKey: "crm-dashboard" },

  // ── Leads (SA handoff pool) ──────────────────────────────────────────────────
  {
    label: "Leads",
    icon: Users,
    children: [
      { label: "All Leads", path: "/crm/leads", pageKey: "crm-leads" },
    ],
  },

  // ── Pipeline ─────────────────────────────────────────────────────────────────
  {
    label: "Pipeline",
    icon: ClipboardList,
    children: [
      { label: "Customers",               path: "/crm/customers",             pageKey: "crm-customers"           },
      { label: "Applications",            path: "/crm/applications",          pageKey: "crm-applications"        },
      { label: "Applications & Bookings", path: "/crm/bookings",              pageKey: "crm-bookings"            },
      { label: "Welcome Calls",           path: "/crm/welcome-calls",         pageKey: "crm-welcome-calls"       },
      { label: "Booking Amendments",       path: "/crm/booking-amendments",    pageKey: "crm-bookings"            },
      { label: "Communication Log",       path: "/crm/communication",         pageKey: "crm-communication"       },
      { label: "Customer Bank & Nominee", path: "/crm/customer-bank-details", pageKey: "crm-customer-bank-details" },
    ],
  },

  // ── Inventory Matrix ─────────────────────────────────────────────────────────
  {
    label: "Matrix",
    icon: Grid3x3,
    children: [
      { label: "Unit Matrix",    path: "/crm/unit-matrix",    pageKey: "crm-unit-matrix"    },
      { label: "Parking Matrix", path: "/crm/parking-matrix", pageKey: "crm-parking-matrix" },
    ],
  },

  // ── Pre-Sale Documents ───────────────────────────────────────────────────────
  // Allotment Letter → Agreement (internal legal steps) → Executed
  {
    label: "Pre-Sale",
    icon: FileText,
    children: [
      { label: "Allotment Letter",  path: "/crm/allotment-letter",  pageKey: "crm-allotment-letter" },
      { label: "Agreements",        path: "/crm/agreements",        pageKey: "crm-agreements"       },
      { label: "Agreement Papers",  path: "/crm/agreement-papers",  pageKey: "crm-documents"        },
      { label: "Legal Milestones",  path: "/crm/legal-milestones",  pageKey: "crm-legal-milestones" },
    ],
  },

  // ── Sub-Registrar Visit 1 — AFS Registration ─────────────────────────────────
  // Gate: Agreement Executed. Outcome: Agreement status → Registered
  {
    label: "AFS Registration",
    icon: Scale,
    children: [
      { label: "AFS Query Payment", path: "/crm/afs-query-payment", pageKey: "crm-afs-query-payment" },
      { label: "AFS Registry",      path: "/crm/afs-registry",      pageKey: "crm-afs-registry"      },
    ],
  },

  // ── Sub-Registrar Visit 2 — Sale Deed ────────────────────────────────────────
  // Legal ownership vests on execution of the Sale Deed (s.54 TPA 1882).
  // Gate: AFS Registered. Sale Deed → Query Payment (stamp duty) → Registry →
  // Mutation (revenue records updated to new owner name).
  {
    label: "Sale Deed",
    icon: Key,
    children: [
      { label: "Sale Deed",     path: "/crm/sales-deed",    pageKey: "crm-sales-deed"    },
      { label: "Query Payment", path: "/crm/query-payment", pageKey: "crm-query-payment" },
      { label: "Registry",      path: "/crm/registry",      pageKey: "crm-registry"      },
      { label: "Mutation",      path: "/crm/mutation",      pageKey: "crm-mutation"      },
    ],
  },

  // ── NOC ──────────────────────────────────────────────────────────────────────
  // Gate: Sale Deed registered. Bank NOC: lender releases charge on unit after
  // loan is cleared post-deed. Organisation NOC: developer confirms no dues.
  {
    label: "NOC",
    icon: Building2,
    children: [
      { label: "NOC (Org & Bank)", path: "/crm/noc", pageKey: "crm-noc" },
    ],
  },

  // ── Possession ───────────────────────────────────────────────────────────────
  // Gate: Sale Deed executed (ownership secured before handing keys).
  // OC/CC → Pre-Possession inspection → Possession Notice → Handover.
  {
    label: "Possession",
    icon: HardHat,
    children: [
      { label: "OC / CC",              path: "/crm/oc-cc",              pageKey: "crm-oc-cc"              },
      { label: "Pre-Possession Check", path: "/crm/pre-possession",     pageKey: "crm-pre-possession"     },
      { label: "Possession Notice",    path: "/crm/possession-notice",  pageKey: "crm-possession-notice"  },
      { label: "Handover",             path: "/crm/handover",           pageKey: "crm-handover"           },
    ],
  },

  // ── Finance ──────────────────────────────────────────────────────────────────
  {
    label: "Finance",
    icon: IndianRupee,
    children: [
      { label: "Payment Milestones", path: "/crm/payments",        pageKey: "crm-payments"        },
      { label: "Home Loan Tracking", path: "/crm/loan-details",    pageKey: "crm-loan-details"    },
      { label: "Demands",            path: "/crm/demands",         pageKey: "crm-payments"        },
      { label: "Money Receipts",     path: "/crm/money-receipts",  pageKey: "crm-money-receipts"  },
      { label: "On Account",         path: "/crm/on-account",      pageKey: "crm-payments"        },
      { label: "Invoices",           path: "/crm/invoices",        pageKey: "crm-invoices"        },
      { label: "Parking Booking",    path: "/crm/parking-booking", pageKey: "crm-parking-booking" },
      { label: "Brokerage",          path: "/crm/brokerage",       pageKey: "crm-brokerage"       },
      { label: "Broker Payment",     path: "/crm/broker-payments", pageKey: "crm-brokerage"       },
    ],
  },

  // ── After-Sales ──────────────────────────────────────────────────────────────
  {
    label: "After-Sales",
    icon: Wrench,
    children: [
      { label: "Service Tickets",    path: "/crm/service-tickets",    pageKey: "crm-service-tickets"    },
      { label: "Cancellations",      path: "/crm/cancellations",      pageKey: "crm-cancellations"      },
      { label: "Customer 360",       path: "/crm/customer-360",       pageKey: "crm-customer-360"       },
      { label: "Construction Updates", path: "/crm/construction-updates", pageKey: "crm-construction-updates" },
    ],
  },
];