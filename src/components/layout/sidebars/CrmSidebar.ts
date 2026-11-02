import { ClipboardList, Inbox, FileText, IndianRupee, Wrench, LayoutDashboard, Grid3x3, Users, Key, ArrowRightLeft } from "lucide-react";
import { NavItem } from "./SidebarPrimitives";

// Sidebar groups follow the work, not the document type. One group holds the
// whole legal and possession path in its real order (Transfer of Property Act
// 1882 s.54 and Sub-Registrar practice):
//
//   Agreement (AFS registry) -> Legal Milestones -> Sale Deed (QP -> Registry)
//   -> Mutation -> NOC (bank lien / org no-dues) -> OC/CC -> Pre-Possession
//   -> Possession Notice -> Handover
//
// Every page keeps its own address; only where it sits in the menu changed.
export const crmNavItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, path: "/crm/dashboard", pageKey: "crm-dashboard" },
  // Everything waiting on the signed-in person; the server picks the queues.
  { label: "My Work", icon: Inbox, path: "/crm/my-work" },

  // ── Leads (SA handoff pool) ──────────────────────────────────────────────────
  { label: "Leads", icon: Users, path: "/crm/leads", pageKey: "crm-leads" },

  // ── Sales: from buyer to confirmed booking ───────────────────────────────────
  {
    label: "Sales",
    icon: ClipboardList,
    children: [
      { label: "Customers",               path: "/crm/customers",             pageKey: "crm-customers"           },
      { label: "Applications",            path: "/crm/applications",          pageKey: "crm-applications"        },
      { label: "Bookings",                path: "/crm/bookings",              pageKey: "crm-bookings"            },
      { label: "Welcome Calls",           path: "/crm/welcome-calls",         pageKey: "crm-welcome-calls"       },
      { label: "Booking Amendments",      path: "/crm/booking-amendments",    pageKey: "crm-bookings"            },
      { label: "Customer Bank Details",   path: "/crm/customer-bank-details", pageKey: "crm-customer-bank-details" },
    ],
  },

  // ── Inventory: units and parking ─────────────────────────────────────────────
  {
    label: "Inventory",
    icon: Grid3x3,
    children: [
      { label: "Unit Matrix",     path: "/crm/unit-matrix",     pageKey: "crm-unit-matrix"     },
      { label: "Parking Matrix",  path: "/crm/parking-matrix",  pageKey: "crm-parking-matrix"  },
      { label: "Parking Booking", path: "/crm/parking-booking", pageKey: "crm-parking-booking" },
    ],
  },

  // ── Legal & Possession, in legal order ───────────────────────────────────────
  // Agreement workspace (draft -> approve -> send -> execute -> AFS Query
  // Payment -> AFS Registry, all tabs on one page). Sale Deed carries its
  // Query Payment (stamp duty) and Registry as tabs. Gates are enforced by
  // each page's own route, not by this order.
  {
    label: "Legal & Possession",
    icon: FileText,
    children: [
      { label: "Agreement",            path: "/crm/agreements",         pageKey: "crm-agreements"         },
      { label: "Legal Milestones",     path: "/crm/legal-milestones",   pageKey: "crm-legal-milestones"   },
      { label: "Sale Deed",            path: "/crm/sales-deed",         pageKey: "crm-sales-deed"         },
      { label: "Mutation",             path: "/crm/mutation",           pageKey: "crm-mutation"           },
      { label: "NOC (Org & Bank)",     path: "/crm/noc",                pageKey: "crm-noc"                },
      { label: "OC / CC",              path: "/crm/oc-cc",              pageKey: "crm-oc-cc"              },
      { label: "Pre-Possession Check", path: "/crm/pre-possession",     pageKey: "crm-pre-possession"     },
      { label: "Possession Notice",    path: "/crm/possession-notice",  pageKey: "crm-possession-notice"  },
      { label: "Handover",             path: "/crm/handover",           pageKey: "crm-handover"           },
    ],
  },

  // ── Payments: the buyer's money ──────────────────────────────────────────────
  {
    label: "Payments",
    icon: IndianRupee,
    children: [
      { label: "Payment Milestones", path: "/crm/payments",        pageKey: "crm-payments"        },
      { label: "Demands",            path: "/crm/demands",         pageKey: "crm-payments"        },
      { label: "Money Receipts",     path: "/crm/money-receipts",  pageKey: "crm-money-receipts"  },
      { label: "On Account",         path: "/crm/on-account",      pageKey: "crm-payments"        },
      { label: "Invoices",           path: "/crm/invoices",        pageKey: "crm-invoices"        },
      { label: "Credit Notes",       path: "/crm/credit-notes",    pageKey: "crm-refunds"         },
      { label: "Refunds",            path: "/crm/refunds",         pageKey: "crm-refunds"         },
      { label: "Home Loan Tracking", path: "/crm/loan-details",    pageKey: "crm-loan-details"    },
    ],
  },

  // ── Brokers ──────────────────────────────────────────────────────────────────
  {
    label: "Brokers",
    icon: Key,
    children: [
      { label: "Brokerage",      path: "/crm/brokerage",       pageKey: "crm-brokerage" },
      { label: "Broker Payment", path: "/crm/broker-payments", pageKey: "crm-brokerage" },
    ],
  },

  // ── After-Sales ──────────────────────────────────────────────────────────────
  {
    label: "After-Sales",
    icon: Wrench,
    children: [
      { label: "Customer 360",         path: "/crm/customer-360",         pageKey: "crm-customer-360"         },
      { label: "Service Tickets",      path: "/crm/service-tickets",      pageKey: "crm-service-tickets"      },
      { label: "Construction Updates", path: "/crm/construction-updates", pageKey: "crm-construction-updates" },
      { label: "Cancellations",        path: "/crm/cancellations",        pageKey: "crm-cancellations"        },
    ],
  },

  // ── Resale ────────────────────────────────────────────────────────────────────
  // A sold property passing to a new buyer (seller clearance → NOC → buyer →
  // approval → fee → registered deed of assignment → transfer) or bought back
  // (→ cancellation deed → payout); after the sale deed, a new owner is only
  // recorded (Ownership Changes). Each case links out to the existing pages
  // that do their part (Applications, Received Payments, Approval Inbox).
  {
    label: "Resale",
    icon: ArrowRightLeft,
    children: [
      { label: "Resale Cases",     path: "/crm/resales",                      pageKey: "crm-resales"        },
      { label: "Transfer Deeds",   path: "/crm/transfer-deeds",               pageKey: "crm-transfer-deeds" },
      { label: "Ownership Changes", path: "/crm/ownership-changes",          pageKey: "crm-ownership-changes" },
    ],
  },
];
