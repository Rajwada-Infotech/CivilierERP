import { Judge, SearchStatus, DocumentUpload, ClipboardTick, Clock, MessageQuestion, Global, Note1, DocumentText, Chart, MoneySend } from "iconsax-react";
import { NavItem } from "./SidebarPrimitives";

// In accordance with ERP conventions:
// - Reference Masters & Configuration live in the TopNavbar "Setup" dropdown (legalSetupItems).
// - Sidebar is dedicated to daily operational workflow and tasks.
export const legalNavItems: NavItem[] = [
  { label: "Dashboard", icon: Judge, path: "/legal", isDashboard: true, pageKey: "legal-dashboard" },

  // ── Land Management ──────────────────────────────────────────────────────
  { label: "Land Enquiries", icon: MessageQuestion, path: "/legal/land/enquiries", pageKey: "legal-land-enquiry" },
  { label: "Land Properties", icon: Global, path: "/legal/land/properties", pageKey: "legal-land-master" },
  { label: "Land Sales", icon: MoneySend, path: "/legal/land/sales", pageKey: "legal-land-master" },
  { label: "Land Reports", icon: Chart, path: "/legal/land/reports", pageKey: "legal-land-reports" },
  // Registers of every land's RS / LR records (each row has its Land ID; entered on the land's step 4).
  { label: "RS Record Register", icon: Note1, path: "/legal/land/rs-register", pageKey: "legal-land-master" },
  { label: "LR RoR Register", icon: DocumentText, path: "/legal/land/lr-register", pageKey: "legal-land-master" },

  // ── Operations & Workflow ──────────────────────────────────────────────────
  { label: "Registration Search", icon: SearchStatus, path: "/legal/search", pageKey: "legal-registration-search" },
  { label: "Deed Registrations", icon: DocumentUpload, path: "/legal/deeds", pageKey: "legal-deed-registrations" },
  { label: "Pending Approvals", icon: ClipboardTick, path: "/legal/approvals", pageKey: "legal-approvals" },
  { label: "Pending & Overdue", icon: Clock, path: "/legal/pending-queue", pageKey: "legal-pending-queue" },
];
