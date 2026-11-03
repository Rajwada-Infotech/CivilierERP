import { Judge, Global, Note1, DocumentText, Chart, MessageQuestion, MoneySend, ClipboardTick } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// Company Land Record Management System navigation:
// - Dashboard
// - Land Enquiries (prospects & leads)
// - Land Register (all company properties)
// - Pending Approvals (Land Verification & Two-Level L1/L2 Approvals)
// - Register Existing / Backlog Land
// - Land Sales (sale/disposal transactions)
// - Registers of RS & LR records
// - Reports & Registers across the company land portfolio
// - Masters & Setup live in the TopNavbar "Setup" dropdown
export const legalNavItems: NavItem[] = [
  { label: "Dashboard", icon: Judge, path: "/legal", isDashboard: true, pageKey: "legal-dashboard" },

  // ── Company Land Records & Verification / Approvals ───────────────────────
  { label: "Land Enquiries", icon: MessageQuestion, path: "/legal/land/enquiries", pageKey: "legal-land-enquiry" },
  { label: "Land Register", icon: Global, path: "/legal/land/properties", pageKey: "legal-land-master" },
  { label: "Pending Approvals", icon: ClipboardTick, path: "/legal/approvals", pageKey: "legal-approvals" },
  { label: "Land Sales", icon: MoneySend, path: "/legal/land/sales", pageKey: "legal-land-master" },
  { label: "RS Record Register", icon: Note1, path: "/legal/land/rs-register", pageKey: "legal-land-master" },
  { label: "LR RoR Register", icon: DocumentText, path: "/legal/land/lr-register", pageKey: "legal-land-master" },
  { label: "Land Reports", icon: Chart, path: "/legal/land/reports", pageKey: "legal-land-reports" },
];
