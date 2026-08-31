import { ClipboardList, FileText, IndianRupee, Wrench, Scale, HardHat, LayoutDashboard, Grid3x3, Users, Key, Building2 } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

// Sidebar groups follow the real workflow sequence:
//
//   Pipeline (pre-sale) → Pre-Sale Docs → Sub-Registrar Visit 1 (AFS) →
//   NOC → Possession (OC/CC → Pre-Possession → Notice → Handover) →
//   Sub-Registrar Visit 2 (Sale Deed → QP → Registry → Mutation) →
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
  // Steps 1–4: Allotment Letter → Agreement (Executed)
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

  // ── Sub-Registrar Visit 1 — AFS ──────────────────────────────────────────────
  // Steps 3–4: AFS Query Payment → AFS Registry → Agreement becomes Registered
  // Gate: Agreement Executed
  {
    label: "AFS Registration",
    icon: Scale,
    children: [
      { label: "AFS Query Payment", path: "/crm/afs-query-payment", pageKey: "crm-afs-query-payment" },
      { label: "AFS Registry",      path: "/crm/afs-registry",      pageKey: "crm-afs-registry"      },
    ],
  },

  // ── NOC ──────────────────────────────────────────────────────────────────────
  // Step 5: Bank NOC + Organisation NOC
  // Gate: Agreement Registered (AFS physically registered at Sub-Registrar)
  {
    label: "NOC",
    icon: Building2,
    children: [
      { label: "NOC (Org & Bank)", path: "/crm/noc", pageKey: "crm-noc" },
    ],
  },

  // ── Possession ───────────────────────────────────────────────────────────────
  // Steps 6–9: OC/CC → Pre-Possession → Possession Notice → Handover
  // Gate: Agreement Registered (+ OC/CC for Pre-Possession onward)
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

  // ── Sub-Registrar Visit 2 — Sale Deed ────────────────────────────────────────
  // Steps 10–13: Sale Deed → Query Payment → Registry → Mutation
  // Gate: Handover Completed + Agreement Registered
  {
    label: "Sale Deed",
    icon: Key,
    children: [
      { label: "Sale Deed",     path: "/crm/sales-deed",   pageKey: "crm-sales-deed"   },
      { label: "Query Payment", path: "/crm/query-payment", pageKey: "crm-query-payment" },
      { label: "Registry",      path: "/crm/registry",      pageKey: "crm-registry"      },
      { label: "Mutation",      path: "/crm/mutation",      pageKey: "crm-mutation"      },
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